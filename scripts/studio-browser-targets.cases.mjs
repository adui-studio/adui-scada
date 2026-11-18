import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveStudioBrowserTargets } from "./studio-browser-targets.mjs";

void describe("双框架浏览器测试协议与本机目标保护", () => {
  void it("默认 HTTP 开发服务保留两端固定回环端口", () => {
    assert.deepEqual(resolveStudioBrowserTargets({}), [
      { name: "React", url: "http://127.0.0.1:15173/" },
      { name: "Vue", url: "http://127.0.0.1:15174/" },
    ]);
  });

  void it("可信 OIDC HTTPS 开关同时切换两端协议而不修改端口", () => {
    assert.deepEqual(
      resolveStudioBrowserTargets({
        SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
        SCADA_WEB_HOST: "127.0.0.1",
        SCADA_REACT_DEV_PORT: "15173",
        SCADA_VUE_DEV_PORT: "15174",
      }),
      [
        { name: "React", url: "https://127.0.0.1:15173/" },
        { name: "Vue", url: "https://127.0.0.1:15174/" },
      ],
    );
  });

  void it("保留合法自定义 HTTPS 回环 Origin", () => {
    assert.deepEqual(
      resolveStudioBrowserTargets({
        SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
        SCADA_REACT_URL: "https://localhost:15473/",
        SCADA_VUE_URL: "https://127.0.0.1:15474/",
      }).map((entry) => entry.url),
      ["https://localhost:15473/", "https://127.0.0.1:15474/"],
    );
  });

  void it("HTTPS 模式不能通过显式覆盖降级为 HTTP", () => {
    assert.throws(
      () =>
        resolveStudioBrowserTargets({
          SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
          SCADA_REACT_URL: "http://127.0.0.1:15173/",
        }),
      /React 浏览器测试只能访问本机匹配协议的 Web 首页/,
    );
  });

  void it("拒绝外网、URL 凭据、路径及查询参数", () => {
    for (const SCADA_REACT_URL of [
      "https://example.com:15173/",
      "https://user:pass@127.0.0.1:15173/",
      "https://127.0.0.1:15173/api/v1/",
      "https://127.0.0.1:15173/?token=secret",
    ]) {
      assert.throws(
        () =>
          resolveStudioBrowserTargets({
            SCADA_OIDC_DEV_HTTPS_ENABLED: "true",
            SCADA_REACT_URL,
          }),
        /React 浏览器测试只能访问本机匹配协议的 Web 首页/,
      );
    }
  });

  void it("拒绝错误的协议开关、外部监听和非法端口", () => {
    assert.throws(
      () => resolveStudioBrowserTargets({ SCADA_OIDC_DEV_HTTPS_ENABLED: "yes" }),
      /HTTPS 开关只能为 true 或 false/,
    );
    assert.throws(
      () => resolveStudioBrowserTargets({ SCADA_WEB_HOST: "0.0.0.0" }),
      /只允许本机回环地址/,
    );
    assert.throws(
      () => resolveStudioBrowserTargets({ SCADA_REACT_DEV_PORT: "65536" }),
      /React 开发端口不合法/,
    );
  });
});
