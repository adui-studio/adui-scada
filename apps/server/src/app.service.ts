import { Injectable } from "@nestjs/common";

export interface HealthResponse {
  readonly status: "ok";
  readonly service: "adui-scada-server";
}

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    // Process liveness only. Not gateway/database readiness.
    return { status: "ok", service: "adui-scada-server" };
  }
}
