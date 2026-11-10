import { describe, expect, it } from "vite-plus/test";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

describe("应用控制器", () => {
  it("应用控制器仅返回进程存活状态", () => {
    // 直接验证控制器行为；依赖注入和 HTTP 路由由端到端测试覆盖。
    const controller = new AppController(new AppService());
    expect(controller.getHealth()).toEqual({
      status: "ok",
      service: "adui-scada-server",
    });
  });
});
