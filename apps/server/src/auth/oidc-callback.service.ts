import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import * as oidc from "openid-client";
import { PrismaService } from "../database/prisma.service.js";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { AuthSessionService } from "./auth-session.service.js";
import type { IssuedAuthSession } from "./auth-session.service.js";
import { OidcLoginTransactionService } from "./oidc-login-transaction.service.js";
import type { ConsumedOidcLoginTransaction } from "./oidc-login-transaction.service.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";

export const SCADA_OIDC_AUTHORIZATION_CODE_GRANT = Symbol("SCADA_OIDC_AUTHORIZATION_CODE_GRANT");
export type OidcAuthorizationCodeGrant = typeof oidc.authorizationCodeGrant;

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CALLBACK_CODE_MAX_LENGTH = 2048;
const SUBJECT_MAX_LENGTH = 255;
const CALLBACK_FAILURE_MESSAGE = "OIDC 登录验证失败，请重新发起登录";
const PROVIDER_FAILURE_MESSAGE = "OIDC 身份提供方暂时不可用，请稍后重试";
const IDENTITY_LOOKUP_FAILURE_MESSAGE = "本地身份映射暂时不可用，请稍后重试";
const SESSION_FAILURE_MESSAGE = "本地会话创建失败，请稍后重试";

export interface OidcAuthorizationResponse {
  readonly state: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
  readonly issuer?: unknown;
}

/**
 * 只供后续服务端 Controller 设置 HttpOnly Cookie。
 * sessionToken 不得序列化到响应 JSON、日志或 Web Storage。
 */
export interface OidcCallbackCompletion {
  readonly sessionId: string;
  readonly sessionToken: string;
  /** 仅供后续 Controller 设置可读 CSRF Cookie，不得返回给页面 JSON。 */
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly returnPath: string;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit === 127) return true;
  }
  return false;
}

function isValidSubject(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > SUBJECT_MAX_LENGTH) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 32 || codeUnit > 126) return false;
  }
  return true;
}

/** 对经过 openid-client 验签的 Claims 再执行应用边界校验。 */
function hasExpectedIdTokenClaims(
  claims: oidc.IDToken | undefined,
  startupConfig: EnabledOidcConfig,
  transaction: ConsumedOidcLoginTransaction,
): claims is oidc.IDToken {
  if (!claims) return false;

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1000);

  return (
    claims.iss === startupConfig.issuer.href &&
    isValidSubject(claims.sub) &&
    claims.nonce === transaction.nonce &&
    audiences.includes(startupConfig.clientId) &&
    (audiences.length <= 1 || claims.azp === startupConfig.clientId) &&
    (claims.azp === undefined || claims.azp === startupConfig.clientId) &&
    Number.isFinite(claims.exp) &&
    Number.isFinite(claims.iat) &&
    claims.iat <= now + 60
  );
}

/** 将已验证的授权响应参数放入固定回调地址，不信任请求 Host 或代理头。 */
function createAuthorizationResponseUrl(
  redirectUri: URL,
  code: string,
  state: string,
  issuer?: string,
): URL {
  const callbackUrl = new URL(redirectUri.href);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("state", state);
  if (issuer !== undefined) callbackUrl.searchParams.set("iss", issuer);
  return callbackUrl;
}

/**
 * 完成 OIDC 授权码兑换、ID Token 验证和预绑定身份解析。
 * 不保存或返回任何 IdP Access Token、Refresh Token 或 ID Token。
 */
@Injectable()
export class OidcCallbackService {
  constructor(
    private readonly database: PrismaService,
    private readonly discovery: OidcProviderDiscoveryService,
    private readonly transactions: OidcLoginTransactionService,
    private readonly sessions: AuthSessionService,
    @Inject(SCADA_OIDC_STARTUP_CONFIG)
    private readonly startupConfig: EnabledOidcConfig,
    @Inject(SCADA_OIDC_AUTHORIZATION_CODE_GRANT)
    private readonly authorizationCodeGrant: OidcAuthorizationCodeGrant,
  ) {}

  async complete(
    response: unknown,
    browserBindingCookie: unknown,
  ): Promise<OidcCallbackCompletion> {
    if (response === null || typeof response !== "object" || Array.isArray(response)) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    const callback = response as OidcAuthorizationResponse;
    if (typeof callback.state !== "string" || !STATE_PATTERN.test(callback.state)) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }
    const state = callback.state;

    const transaction = await this.transactions.consume(state, browserBindingCookie);
    if (!transaction || transaction.issuer !== this.startupConfig.issuer.href) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    // OAuth 错误响应同样先消费 State，防止同一登录事务被重复使用。
    if (callback.error !== undefined) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    const code = callback.code;
    if (
      typeof code !== "string" ||
      code.length === 0 ||
      code.length > CALLBACK_CODE_MAX_LENGTH ||
      hasControlCharacters(code) ||
      !STATE_PATTERN.test(transaction.nonce) ||
      !CODE_VERIFIER_PATTERN.test(transaction.codeVerifier)
    ) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    let issuerParameter: string | undefined;
    if (callback.issuer !== undefined) {
      if (
        typeof callback.issuer !== "string" ||
        callback.issuer !== this.startupConfig.issuer.href ||
        hasControlCharacters(callback.issuer)
      ) {
        throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
      }
      issuerParameter = callback.issuer;
    }

    let configuration: oidc.Configuration;
    try {
      configuration = await this.discovery.getConfiguration();
    } catch {
      throw new ServiceUnavailableException(PROVIDER_FAILURE_MESSAGE);
    }

    const metadata = configuration.serverMetadata();
    if (metadata.issuer !== transaction.issuer) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }
    if (
      metadata.authorization_response_iss_parameter_supported === true &&
      issuerParameter === undefined
    ) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    const callbackUrl = createAuthorizationResponseUrl(
      this.startupConfig.redirectUri,
      code,
      state,
      issuerParameter,
    );

    let claims: oidc.IDToken | undefined;
    try {
      const tokens = await this.authorizationCodeGrant(configuration, callbackUrl, {
        expectedState: state,
        expectedNonce: transaction.nonce,
        pkceCodeVerifier: transaction.codeVerifier,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch {
      // 不记录授权码、Token 响应、回调 URL、底层异常或身份提供方返回内容。
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    if (!hasExpectedIdTokenClaims(claims, this.startupConfig, transaction)) {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    let externalIdentity: {
      readonly tenantId: string;
      readonly subjectId: string;
      readonly identity: { readonly status: string };
    } | null;
    try {
      externalIdentity = await this.database.client.scadaExternalIdentity.findUnique({
        where: {
          issuer_subject: {
            issuer: claims.iss,
            subject: claims.sub,
          },
        },
        select: {
          tenantId: true,
          subjectId: true,
          identity: { select: { status: true } },
        },
      });
    } catch {
      throw new ServiceUnavailableException(IDENTITY_LOOKUP_FAILURE_MESSAGE);
    }

    if (!externalIdentity || externalIdentity.identity.status !== "active") {
      throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
    }

    let issuedSession: IssuedAuthSession;
    try {
      issuedSession = await this.sessions.issueForVerifiedSubject({
        tenantId: externalIdentity.tenantId,
        subjectId: externalIdentity.subjectId,
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw new UnauthorizedException(CALLBACK_FAILURE_MESSAGE);
      }
      throw new ServiceUnavailableException(SESSION_FAILURE_MESSAGE);
    }

    return Object.freeze({
      sessionId: issuedSession.sessionId,
      sessionToken: issuedSession.token,
      csrfToken: issuedSession.csrfToken,
      expiresAt: issuedSession.expiresAt,
      returnPath: transaction.returnPath,
    });
  }
}
