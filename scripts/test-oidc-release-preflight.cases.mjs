import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import {
  describeReleasePreflightFailure,
  readReleasePreflightInPage,
  requireReadonlyReleasePreflightMode,
} from "./test-oidc-release-preflight.mjs";

const origin = "https://127.0.0.1:15173";
const projectId = "water-demo";
const hash = "a".repeat(64);

function fixture({ passed = true, firstDenied = false } = {}) {
  const calls = [];
  const candidate = firstDenied ? "project-without-version-read" : projectId;
  const project = { projectId, headRevision: 3 };
  const issues = passed
    ? []
    : [
        {
          code: "UNSUPPORTED_SYMBOL_PROP",
          severity: "error",
          path: "pages[0].nodes[1].props.color",
          message: "当前 SVG 运行时不处理此图元属性",
        },
      ];
  const prefix = "/api/v1/projects/" + projectId;
  const map = new Map([
    [
      "/api/v1/projects?limit=100",
      {
        status: 200,
        body: firstDenied ? [{ projectId: candidate, headRevision: 1 }, project] : [project],
      },
    ],
    [
      prefix + "/versions?limit=1",
      {
        status: 200,
        body: [{ projectId, revision: 3, contentHash: hash }],
      },
    ],
    [
      prefix + "/versions/3/release-preflight",
      {
        status: 200,
        body: {
          projectId,
          revision: 3,
          headRevision: 3,
          contentHash: hash,
          passed,
          issues,
        },
        cache: "no-store",
      },
    ],
    [prefix + "/versions/0/release-preflight", { status: 400 }],
    [prefix + "/versions/4/release-preflight", { status: 409 }],
    [prefix, { status: 200, body: project }],
  ]);
  if (firstDenied) {
    map.set("/api/v1/projects/" + candidate + "/versions?limit=1", { status: 404 });
  }
  const runtime = {
    location: { origin },
    async fetch(path, options) {
      calls.push({ path, options });
      const result = map.get(path) ?? { status: 500 };
      return {
        status: result.status,
        redirected: result.redirected ?? false,
        url: result.url ?? origin + path,
        headers: {
          get(name) {
            if (name === "content-type") return result.type ?? "application/json";
            if (name === "cache-control") return result.cache ?? null;
            return null;
          },
        },
        async json() {
          return result.body;
        },
      };
    },
  };
  return { runtime, map, calls, prefix };
}

void describe("真实 Keycloak 双 Origin 发布预检只读安全门禁", () => {
  void it("只接受没有附加参数的只读验收模式", () => {
    assert.equal(requireReadonlyReleasePreflightMode([]), true);
    for (const value of [
      ["--run"],
      ["--write"],
      ["--confirm-lab", "adui_scada"],
      ["--run", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => requireReadonlyReleasePreflightMode(value),
        /真实发布预检专项只允许无参数只读模式/,
      );
    }
  });

  void it("成功核对真实版本摘要、当前预检、非法版本和过期水位且只发 GET", async () => {
    const { runtime, calls } = fixture();
    const result = await readReleasePreflightInPage(origin, runtime);
    assert.deepEqual(result, {
      projectId,
      revision: 3,
      contentHash: hash,
      passed: true,
      issueCount: 0,
    });
    assert.equal(calls.length, 6);
    assert.ok(calls.every(({ options }) => options.method === "GET"));
    assert.ok(calls.every(({ options }) => options.credentials === "same-origin"));
    assert.ok(calls.every(({ options }) => options.mode === "same-origin"));
    assert.ok(calls.every(({ options }) => options.redirect === "error"));
    assert.ok(calls.every(({ options }) => options.cache === "no-store"));
    assert.ok(calls.every(({ options }) => !("body" in options)));
    assert.ok(calls.every(({ options }) => !("Authorization" in options.headers)));
    assert.ok(calls.every(({ path }) => path.startsWith("/api/v1/projects")));
  });

  void it("工程列表存在但某工程缺少 version:read 时只跳过该工程", async () => {
    const { runtime, calls } = fixture({ firstDenied: true });
    const result = await readReleasePreflightInPage(origin, runtime);
    assert.equal(result.projectId, projectId);
    assert.equal(calls.length, 7);
    assert.equal(calls[1].path, "/api/v1/projects/project-without-version-read/versions?limit=1");
  });

  void it("合法的不兼容报告只返回问题数量而不回传工程正文", async () => {
    const { runtime } = fixture({ passed: false });
    assert.deepEqual(await readReleasePreflightInPage(origin, runtime), {
      projectId,
      revision: 3,
      contentHash: hash,
      passed: false,
      issueCount: 1,
    });
  });

  void it("跨 Origin 调用必须在发出任何请求之前失败", async () => {
    const { runtime, calls } = fixture();
    await assert.rejects(
      readReleasePreflightInPage("https://127.0.0.1:15174", runtime),
      /发布预检请求不是当前可信 Origin/,
    );
    assert.equal(calls.length, 0);
  });

  void it("未认证身份或外部重定向不能伪装成有效工程列表", async () => {
    for (const change of [
      { status: 401 },
      { status: 302, redirected: true },
      { status: 200, url: "https://untrusted.example.org/" },
    ]) {
      const { runtime, map } = fixture();
      map.set("/api/v1/projects?limit=100", change);
      await assert.rejects(readReleasePreflightInPage(origin, runtime), /发布预检/);
    }
  });

  void it("没有任何 version:read 的授权工程必须明确失败", async () => {
    const { runtime, map, prefix } = fixture();
    map.set(prefix + "/versions?limit=1", { status: 404 });
    await assert.rejects(
      readReleasePreflightInPage(origin, runtime),
      /发布预检没有同时拥有版本读取权限的工程/,
    );
  });

  void it("篡改水位、摘要、正文额外字段及缺少 no-store 必须拒绝", async () => {
    for (const change of [
      { patch: { revision: 2 }, message: /报告与已保存版本不一致/ },
      { patch: { contentHash: "0".repeat(64) }, message: /报告与已保存版本不一致/ },
      { patch: { document: { tags: [] } }, message: /报告与已保存版本不一致/ },
      { cache: null, message: /未禁止 HTTP 缓存/ },
    ]) {
      const { runtime, map, prefix } = fixture();
      const path = prefix + "/versions/3/release-preflight";
      const old = map.get(path);
      map.set(path, {
        ...old,
        ...(change.cache === null ? { cache: null } : {}),
        body: { ...old.body, ...(change.patch ?? {}) },
      });
      await assert.rejects(readReleasePreflightInPage(origin, runtime), change.message);
    }
  });

  void it("过期或非法修订号返回错误状态时不能作为验收成功", async () => {
    for (const pathSuffix of ["/versions/0/release-preflight", "/versions/4/release-preflight"]) {
      const { runtime, map, prefix } = fixture();
      map.set(prefix + pathSuffix, { status: 200 });
      await assert.rejects(readReleasePreflightInPage(origin, runtime), /未受控拒绝/);
    }
  });

  void it("CDP 序列化执行时不依赖 Node 模块闭包", async () => {
    const isolated = runInNewContext("(" + readReleasePreflightInPage.toString() + ")");
    const { runtime } = fixture();
    const result = await isolated(origin, runtime);
    assert.equal(result.revision, 3);
    assert.equal(result.contentHash, hash);
  });

  void it("异常脱敏不输出 Cookie、身份或原始堆栈", () => {
    const error = new Error("Cookie=secret; access_token=private");
    const result = describeReleasePreflightFailure(error);
    assert.equal(result, "真实发布预检专项未通过，内部诊断已脱敏");
    assert.equal(result.includes("private"), false);
    assert.equal(
      describeReleasePreflightFailure(new Error("真实发布预检专项双框架摘要不一致")),
      "真实发布预检专项双框架摘要不一致",
    );
  });
});
