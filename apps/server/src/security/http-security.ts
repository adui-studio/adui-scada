import helmet from "helmet";
import type { INestApplication } from "@nestjs/common";

/**
 * 默认启用 Helmet 的完整安全响应头。
 * 仅在本机开发的 Swagger 交互界面启用时关闭 CSP，正式生产始终保持 CSP。
 */
export function applyHttpSecurityHeaders(
  app: INestApplication,
  localInteractiveDocs: boolean,
): void {
  app.use(localInteractiveDocs ? helmet({ contentSecurityPolicy: false }) : helmet());
}
