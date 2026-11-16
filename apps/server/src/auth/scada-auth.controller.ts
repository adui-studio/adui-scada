import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { ServerResponse } from "node:http";
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthSessionService } from "./auth-session.service.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";
import { ScadaSessionGuard } from "./scada-session.guard.js";
import { OidcCallbackService } from "./oidc-callback.service.js";
import { OidcLoginTransactionService } from "./oidc-login-transaction.service.js";
import {
  createClearedScadaSessionCookieHeaders,
  createScadaOidcBrowserBindingCookieHeader,
  createScadaSessionCookieHeaders,
  readScadaCookieValue,
  SCADA_OIDC_BROWSER_COOKIE_NAME,
} from "./scada-auth-cookie.js";

interface ScadaAuthHttpRequest extends ScadaAuthenticatedRequest {
  readonly query: Readonly<Record<string, unknown>>;
}

/**
 * 只提供 OIDC BFF 登录、最小身份上下文与本地会话注销。
 * 工程 API 由独立模块提供；本控制器不连接或写入任何工业设备。
 */
@ApiTags("身份认证")
@Controller("api/v1/auth")
export class ScadaAuthController {
  constructor(
    @Inject(OidcLoginTransactionService)
    private readonly transactions: OidcLoginTransactionService,
    @Inject(OidcCallbackService)
    private readonly callbacks: OidcCallbackService,
    @Inject(AuthSessionService)
    private readonly sessions: AuthSessionService,
  ) {}

  @Get("oidc/start")
  @ApiOperation({ summary: "发起固定身份提供方的 OIDC 登录" })
  @ApiQuery({
    name: "returnTo",
    required: false,
    description: "登录成功后的站内相对路径，服务端会再次严格校验",
  })
  @ApiResponse({ status: 302, description: "重定向至固定 OIDC 身份提供方" })
  async start(
    @Req() request: ScadaAuthHttpRequest,
    @Res() response: ServerResponse,
  ): Promise<void> {
    this.setNoStoreHeaders(response);
    const existingBinding = readScadaCookieValue(
      request.headers.cookie,
      SCADA_OIDC_BROWSER_COOKIE_NAME,
    );
    const result = await this.transactions.start(request.query.returnTo, existingBinding);

    response.setHeader(
      "Set-Cookie",
      createScadaOidcBrowserBindingCookieHeader(result.browserBindingCookie, result.expiresAt),
    );
    response.writeHead(HttpStatus.FOUND, { Location: result.authorizationUrl });
    response.end();
  }

  @Get("oidc/callback")
  @ApiOperation({ summary: "处理 OIDC 授权码回调并建立本地 BFF 会话" })
  @ApiResponse({ status: 302, description: "设置本地会话 Cookie 并跳转回站内路径" })
  async callback(
    @Req() request: ScadaAuthHttpRequest,
    @Res() response: ServerResponse,
  ): Promise<void> {
    this.setNoStoreHeaders(response);
    const browserBinding = readScadaCookieValue(
      request.headers.cookie,
      SCADA_OIDC_BROWSER_COOKIE_NAME,
    );
    const completion = await this.callbacks.complete(
      {
        state: request.query.state,
        code: request.query.code,
        error: request.query.error,
        issuer: request.query.iss,
      },
      browserBinding,
    );

    const sessionCookies = createScadaSessionCookieHeaders({
      sessionToken: completion.sessionToken,
      csrfToken: completion.csrfToken,
      expiresAt: completion.expiresAt,
    });
    response.setHeader("Set-Cookie", [...sessionCookies]);
    // 浏览器绑定 Cookie 暂不主动清除：同一浏览器允许多个标签页并行登录事务。
    response.writeHead(HttpStatus.FOUND, { Location: completion.returnPath });
    response.end();
  }

  @Get("me")
  @UseGuards(ScadaSessionGuard)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @ApiOperation({ summary: "获取当前已验证的本地身份上下文" })
  @ApiOkResponse({
    description: "仅返回服务端验证后的租户与主体标识，不返回任何会话令牌",
    schema: {
      type: "object",
      properties: {
        authenticated: { type: "boolean", example: true },
        principal: {
          type: "object",
          properties: {
            tenantId: { type: "string" },
            subjectId: { type: "string" },
          },
          required: ["tenantId", "subjectId"],
        },
      },
      required: ["authenticated", "principal"],
    },
  })
  getMe(@Req() request: ScadaAuthenticatedRequest) {
    if (!request.scadaPrincipal) {
      throw new UnauthorizedException("当前请求缺少已验证的身份上下文");
    }
    return {
      authenticated: true,
      principal: {
        tenantId: request.scadaPrincipal.tenantId,
        subjectId: request.scadaPrincipal.subjectId,
      },
    };
  }

  @Post("logout")
  @UseGuards(ScadaSessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "撤销当前 ADui SCADA 本地会话" })
  @ApiNoContentResponse({ description: "本地会话已撤销或已经失效，并清理浏览器会话 Cookie" })
  async logout(
    @Req() request: ScadaAuthenticatedRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    this.setNoStoreHeaders(response);
    const principal = request.scadaPrincipal;
    const sessionId = request.scadaSessionId;
    if (!principal || !sessionId) {
      throw new UnauthorizedException("当前请求缺少可撤销的本地会话");
    }

    try {
      await this.sessions.revokeForVerifiedSubject(principal, sessionId);
    } catch {
      // 撤销未确认时不清除客户端 Cookie，避免把仍有效的服务端会话伪装成已退出。
      throw new ServiceUnavailableException("本地会话注销失败，请稍后重试");
    }

    response.setHeader("Set-Cookie", [...createClearedScadaSessionCookieHeaders()]);
  }

  private setNoStoreHeaders(response: ServerResponse): void {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
  }
}
