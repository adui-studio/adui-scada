import type { INestApplication } from "@nestjs/common";

export interface OpenApiAccessPolicy {
  readonly enabled: string | undefined;
  readonly nodeEnv: string | undefined;
  readonly host: string;
}

/**
 * API 文档仅能在非生产环境、显式启用且绑定本机回环监听时开放。
 * 即使 Docker 监听 0.0.0.0 且配置被错误开启，也不会发布文档。
 */
export function allowLocalOpenApi(policy: OpenApiAccessPolicy): boolean {
  return (
    policy.enabled === "true" && policy.nodeEnv !== "production" && policy.host === "127.0.0.1"
  );
}

/** 未通过访问策略时完全不注册文档路由，也不动态加载 Swagger。 */
export async function setupLocalOpenApi(app: INestApplication, enabled: boolean): Promise<void> {
  if (!enabled) return;
  const { DocumentBuilder, SwaggerModule } = await import("@nestjs/swagger");
  const options = new DocumentBuilder()
    .setTitle("ADui SCADA · 服务端 API")
    .setDescription("仅供本机开发的受控 HTTP 接口文档。健康检查不代表工业网关或数据库就绪。")
    .setVersion("0.3.0")
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "ADui SCADA · 本机 API 文档",
    swaggerOptions: { persistAuthorization: false },
  });
}
