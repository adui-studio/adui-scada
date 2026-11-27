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

/** OIDC 登录事务端口；生命周期由原生实现管理。 */
export abstract class OidcLoginTransactionService {
  abstract cleanupExpiredTransactions(): Promise<number>;
  abstract start(
    returnPath?: unknown,
    existingBrowserBinding?: unknown,
  ): Promise<OidcLoginStartResult>;
  abstract consume(
    state: unknown,
    browserBindingCookie: unknown,
  ): Promise<ConsumedOidcLoginTransaction | null>;
}
