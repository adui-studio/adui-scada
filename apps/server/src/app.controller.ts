import { Controller, Get, Inject } from "@nestjs/common";
import { AppService } from "./app.service.js";
import type { HealthResponse } from "./app.service.js";

@Controller("health")
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
