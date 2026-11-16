import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as oidc from "openid-client";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";

const TRANSACTION_DURATION_MS = 5 * 60 * 1000;
const TRANSACTION_DATABASE_TIMEOUT_MS = 5_000;
/** 仅对当前进程兜底；多实例的总配额必须由可信网关控制。 */
const START_WINDOW_MS = 60_000;
const START_LIMIT = 60;
const START_CONCURRENCY_LIMIT = 8;
const CLEANUP_INTERVAL_MS = 30_000;
const CLEANUP_BATCH_SIZE = 128;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BROWSER_BINDING_PREFIX = "scada_oidc_b_";
const BROWSER_BINDING_PATTERN = /^scada_oidc_b_[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const RETURN_PATH_BASE = "https://scada.invalid";
const TRANSACTION_CREATE_FAILURE = "OIDC 登录事务创建失败，请稍后重试";
const TRANSACTION_CONSUME_FAILURE = "OIDC 登录事务验证失败，请稍后重试";

export interface OidcLoginStartResult {
  /** 仅供服务端控制器执行 302 跳转，不得写入日志。 */
  readonly authorizationUrl: string;
  /** 仅供设置 HttpOnly 浏览器绑定 Cookie，不得返回给页面脚本。 */
  readonly browserBindingCookie: string;
  readonly expiresAt: Date;
}

export interface ConsumedOidcLoginTransaction {
  readonly issuer: string;
  readonly nonce: string;
  /** 仅供服务端向 Token Endpoint 兑换授权码，不得写入日志或返回浏览器。 */
  readonly codeVerifier: string;
  readonly returnPath: string;
}

/** 使用字符码检查控制字符，避免在正则中直接匹配控制字符。 */
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit === 127) return true;
  }
  return false;
}

/** 对回跳路径作严格校验，只保存站内路径，不接受外部 URL、反斜杠或片段。 */
function normalizeReturnPath(value: unknown): string {
  const candidate = value === undefined ? "/" : value;
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 1024 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("#") ||
    hasControlCharacters(candidate) ||
    /%(?:0a|0d|5c)/i.test(candidate)
  ) {
    throw new BadRequestException("OIDC 登录返回路径无效");
  }

  let target: URL;
  try {
    target = new URL(candidate, RETURN_PATH_BASE);
  } catch {
    throw new BadRequestException("OIDC 登录返回路径无效");
  }

  if (target.origin !== RETURN_PATH_BASE || target.username || target.password || target.hash) {
    throw new BadRequestException("OIDC 登录返回路径无效");
  }

  const normalized = target.pathname + target.search;
  if (normalized.length > 1024) {
    throw new BadRequestException("OIDC 登录返回路径超出长度限制");
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** AES-256-GCM 密文使用 State 摘要作为 AAD，避免密文被跨事务替换。 */
function encryptCodeVerifier(
  verifier: string,
  stateHash: string,
  key: Uint8Array<ArrayBuffer>,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  cipher.setAAD(Buffer.from(stateHash, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(verifier, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** 对格式、长度、Base64URL 规范性和 GCM 认证标签逐项校验。 */
function decryptCodeVerifier(
  value: string,
  stateHash: string,
  key: Uint8Array<ArrayBuffer>,
): string | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  const [, encodedIv, encodedTag, encodedCiphertext] = parts;
  if (!encodedIv || !encodedTag || !encodedCiphertext) return null;

  const iv = Buffer.from(encodedIv, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (
    iv.length !== 12 ||
    tag.length !== 16 ||
    ciphertext.length === 0 ||
    iv.toString("base64url") !== encodedIv ||
    tag.toString("base64url") !== encodedTag ||
    ciphertext.toString("base64url") !== encodedCiphertext
  ) {
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
    decipher.setAAD(Buffer.from(stateHash, "ascii"));
    decipher.setAuthTag(tag);
    const verifier = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    return CODE_VERIFIER_PATTERN.test(verifier) ? verifier : null;
  } catch {
    return null;
  }
}

/**
 * 创建并一次性消费 OIDC 登录事务。
 * 数据库只保存 State/浏览器绑定摘要和 AES-GCM 加密的 PKCE verifier。
 */
@Injectable()
export class OidcLoginTransactionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OidcLoginTransactionService.name);
  private windowStartedAt = 0;
  private windowCount = 0;
  private activeStarts = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;
  private cleanupPending: Promise<number> | null = null;
  constructor(
    private readonly database: PrismaService,
    private readonly discovery: OidcProviderDiscoveryService,
    @Inject(SCADA_OIDC_STARTUP_CONFIG)
    private readonly startupConfig: EnabledOidcConfig,
  ) {}

  onModuleInit(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredTransactions().catch(() => {
        this.logger.warn("OIDC 登录事务清理失败，将在下一周期重试");
      });
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    if (this.cleanupPending) {
      await this.cleanupPending.catch(() => {
        // 清理失败不阻止应用安全关闭。
      });
    }
  }

  /** 不依赖未经认证的转发 IP；按服务进程限制匿名入口速率和并发。 */
  private reserveStart(): () => void {
    const now = Date.now();
    if (now < this.windowStartedAt || now - this.windowStartedAt >= START_WINDOW_MS) {
      this.windowStartedAt = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= START_LIMIT || this.activeStarts >= START_CONCURRENCY_LIMIT) {
      throw new HttpException("OIDC 登录请求过于频繁，请稍后重试", HttpStatus.TOO_MANY_REQUESTS);
    }
    this.windowCount += 1;
    this.activeStarts += 1;
    return () => {
      this.activeStarts -= 1;
    };
  }

  /** 以固定批次清理已过期事务，不删除仍可消费的登录记录。 */
  async cleanupExpiredTransactions(): Promise<number> {
    if (this.cleanupPending) return this.cleanupPending;
    const pending = (async () => {
      const now = new Date();
      const expired = await this.database.client.scadaOidcTransaction.findMany({
        where: { expiresAt: { lte: now } },
        orderBy: { expiresAt: "asc" },
        take: CLEANUP_BATCH_SIZE,
        select: { stateHash: true },
      });
      if (expired.length === 0) return 0;
      const result = await this.database.client.scadaOidcTransaction.deleteMany({
        where: {
          stateHash: { in: expired.map((record) => record.stateHash) },
          expiresAt: { lte: now },
        },
      });
      return result.count;
    })();
    this.cleanupPending = pending;
    try {
      return await pending;
    } finally {
      if (this.cleanupPending === pending) this.cleanupPending = null;
    }
  }

  async start(
    returnPath: unknown = "/",
    existingBrowserBinding?: unknown,
  ): Promise<OidcLoginStartResult> {
    const safeReturnPath = normalizeReturnPath(returnPath);
    const releaseStart = this.reserveStart();
    try {
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      if (
        !STATE_PATTERN.test(state) ||
        !STATE_PATTERN.test(nonce) ||
        !CODE_VERIFIER_PATTERN.test(codeVerifier)
      ) {
        throw new ServiceUnavailableException("OIDC 登录随机数生成失败");
      }

      const browserBindingCookie =
        typeof existingBrowserBinding === "string" &&
        BROWSER_BINDING_PATTERN.test(existingBrowserBinding)
          ? existingBrowserBinding
          : BROWSER_BINDING_PREFIX + randomBytes(32).toString("base64url");

      const stateHash = sha256(state);
      const browserBindingHash = sha256(browserBindingCookie);
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + TRANSACTION_DURATION_MS);
      const verifierCiphertext = encryptCodeVerifier(
        codeVerifier,
        stateHash,
        this.startupConfig.transactionEncryptionKey,
      );

      try {
        const configuration = await this.discovery.getConfiguration();
        const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
        const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
          redirect_uri: this.startupConfig.redirectUri.href,
          scope: "openid",
          state,
          nonce,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        });

        await this.database.client.scadaOidcTransaction.create({
          data: {
            stateHash,
            issuer: this.startupConfig.issuer.href,
            nonce,
            verifierCiphertext,
            browserBindingHash,
            returnPath: safeReturnPath,
            createdAt,
            expiresAt,
          },
        });

        return Object.freeze({
          authorizationUrl: authorizationUrl.href,
          browserBindingCookie,
          expiresAt,
        });
      } catch {
        // 不传播数据库异常、Issuer、回调地址、客户端秘密或授权请求参数。
        throw new ServiceUnavailableException(TRANSACTION_CREATE_FAILURE);
      }
    } finally {
      releaseStart();
    }
  }

  /**
   * 在单个数据库事务内校验浏览器绑定并条件消费。
   * 并发回调只有一个能将 consumedAt 从 NULL 更新为时间戳。
   */
  async consume(
    state: unknown,
    browserBindingCookie: unknown,
  ): Promise<ConsumedOidcLoginTransaction | null> {
    if (
      typeof state !== "string" ||
      !STATE_PATTERN.test(state) ||
      typeof browserBindingCookie !== "string" ||
      !BROWSER_BINDING_PATTERN.test(browserBindingCookie)
    ) {
      return null;
    }

    const stateHash = sha256(state);
    const browserBindingHash = sha256(browserBindingCookie);
    const now = new Date();

    let consumed: {
      readonly issuer: string;
      readonly nonce: string;
      readonly verifierCiphertext: string;
      readonly returnPath: string;
    } | null;

    try {
      consumed = await this.database.client.$transaction(
        async (transaction) => {
          const where = {
            stateHash,
            issuer: this.startupConfig.issuer.href,
            browserBindingHash,
            consumedAt: null,
            expiresAt: { gt: now },
            createdAt: { lte: now },
          };
          const record = await transaction.scadaOidcTransaction.findFirst({
            where,
            select: {
              issuer: true,
              nonce: true,
              verifierCiphertext: true,
              returnPath: true,
            },
          });
          if (!record) return null;

          const result = await transaction.scadaOidcTransaction.updateMany({
            where,
            data: { consumedAt: now },
          });
          return result.count === 1 ? record : null;
        },
        {
          maxWait: TRANSACTION_DATABASE_TIMEOUT_MS,
          timeout: TRANSACTION_DATABASE_TIMEOUT_MS,
        },
      );
    } catch {
      throw new ServiceUnavailableException(TRANSACTION_CONSUME_FAILURE);
    }

    if (!consumed || !STATE_PATTERN.test(consumed.nonce)) return null;

    let returnPath: string;
    try {
      returnPath = normalizeReturnPath(consumed.returnPath);
    } catch {
      return null;
    }
    if (returnPath !== consumed.returnPath) return null;

    const verifier = decryptCodeVerifier(
      consumed.verifierCiphertext,
      stateHash,
      this.startupConfig.transactionEncryptionKey,
    );
    if (!verifier) return null;

    return Object.freeze({
      issuer: consumed.issuer,
      nonce: consumed.nonce,
      codeVerifier: verifier,
      returnPath,
    });
  }
}
