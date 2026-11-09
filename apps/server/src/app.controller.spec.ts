import { describe, expect, it } from "vite-plus/test";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

describe("AppController", () => {
  it("returns only the process liveness payload", () => {
    // Test controller behavior directly; Nest DI and HTTP routing are covered by E2E tests.
    const controller = new AppController(new AppService());
    expect(controller.getHealth()).toEqual({
      status: "ok",
      service: "adui-scada-server",
    });
  });
});
