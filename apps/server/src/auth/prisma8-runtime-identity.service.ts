import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { EnabledOidcConfig } from "../config/oidc-startup.config.js";
import { Prisma8Service } from "../database/prisma8.service.js";
import type { AuthSessionService } from "./auth-session.service.js";
import type { OidcLoginTransactionService } from "./oidc-login-transaction.service.js";
import {
  OidcProviderDiscoveryService,
  SCADA_OIDC_STARTUP_CONFIG,
} from "./oidc-provider-discovery.service.js";
import {
  nativeAuthTransaction,
  type Prisma8AuthTransaction,
  type Prisma8AuthTransactionPort,
} from "./prisma8-auth-transaction-port.js";
import { Prisma8OidcLoginOperations } from "./prisma8-oidc-login-operations.js";
import { Prisma8SessionOperations } from "./prisma8-session-operations.js";

/** 原生业务连接独立装配；禁止把数据库错误或参数传播到会话 HTTP 调用方。 */
function nativePort(database: Prisma8Service, timeout: 5000 | 10000): Prisma8AuthTransactionPort {
  async function sanitized<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException("本地身份事务暂时不可用，请稍后重试");
    }
  }
  return {
    assertWritable: () => database.assertWritable(),
    read: <T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>) =>
      sanitized(() => database.readTransaction((tx) => operation(nativeAuthTransaction(tx)))),
    write: <T>(operation: (tx: Prisma8AuthTransaction) => Promise<T>) =>
      sanitized(() =>
        database.writeTransaction((tx) => operation(nativeAuthTransaction(tx)), timeout),
      ),
  };
}

/** 保留既有会话公开接口，不依赖旧 PrismaService。 */
@Injectable()
export class Prisma8RuntimeAuthSessionService
  extends Prisma8SessionOperations
  implements
    Pick<
      AuthSessionService,
      | "issueForVerifiedSubject"
      | "authenticate"
      | "authenticateWithSession"
      | "authenticateCookieSession"
      | "revokeForVerifiedSubject"
    >
{
  constructor(database: Prisma8Service) {
    super(nativePort(database, 10000));
  }
}

/** 正式可写模式恢复有界过期清理，严格只读烟测不会启动定时器。 */
@Injectable()
export class Prisma8RuntimeOidcLoginTransactionService
  extends Prisma8OidcLoginOperations
  implements Pick<OidcLoginTransactionService, "start" | "consume" | "cleanupExpiredTransactions">
{
  constructor(
    database: Prisma8Service,
    discovery: OidcProviderDiscoveryService,
    @Inject(SCADA_OIDC_STARTUP_CONFIG) startupConfig: EnabledOidcConfig,
  ) {
    super(nativePort(database, 5000), discovery, startupConfig, database.writable);
  }
}
