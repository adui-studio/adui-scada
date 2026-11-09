import { describe, expect, it } from "vite-plus/test";
import { Test } from "@nestjs/testing";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

describe("AppController", () => {
  it("returns only the process liveness payload", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
    try {
      const controller = moduleRef.get(AppController);
      expect(controller.getHealth()).toEqual({
        status: "ok",
        service: "adui-scada-server",
      });
    } finally {
      await moduleRef.close();
    }
  });
});
