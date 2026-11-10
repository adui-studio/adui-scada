import { Injectable } from "@nestjs/common";

export interface HealthResponse {
  readonly status: "ok";
  readonly service: "adui-scada-server";
}

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    // 本接口仅表示进程存活，不代表网关或数据库已经就绪。
    return { status: "ok", service: "adui-scada-server" };
  }
}
