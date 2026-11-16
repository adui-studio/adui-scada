import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import { createScadaApiClient, ScadaApiError } from "../src/index.ts";

const CSRF_TOKEN = "scada_csrf_" + "a".repeat(43);
const CSRF_COOKIE = "__Host-adui-scada-csrf=" + CSRF_TOKEN;
const PROJECT_ID = waterTreatmentDemoDocument.projectId;
const CREATED_AT = "2026-11-16T00:00:00.000Z";
const summary = {
  projectId: PROJECT_ID,
  headRevision: 1,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function createHarness(response: Response, cookie = CSRF_COOKIE) {
  const fetcher = vi.fn<typeof fetch>(async () => response);
  return {
    fetcher,
    client: createScadaApiClient({ fetcher, readCookie: () => cookie }),
  };
}

function documentCopy() {
  return JSON.parse(JSON.stringify(waterTreatmentDemoDocument));
}

describe("框架无关工程 API Client", () => {
  it("身份查询只读取同源受保护路径和可信最小身份数据", async () => {
    const harness = createHarness(
      jsonResponse({
        authenticated: true,
        principal: { tenantId: "tenant-a", subjectId: "user-a" },
      }),
    );
    expect(await harness.client.getMe()).toEqual({
      authenticated: true,
      principal: { tenantId: "tenant-a", subjectId: "user-a" },
    });
    expect(harness.fetcher).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({
        method: "GET",
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("拒绝包含内部会话令牌或额外权限信息的身份响应", async () => {
    const harness = createHarness(
      jsonResponse({
        authenticated: true,
        principal: { tenantId: "tenant-a", subjectId: "user-a" },
        token: "伪造",
      }),
    );
    await expect(harness.client.getMe()).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("注销使用当前 CSRF Cookie，返回 204 才视为成功", async () => {
    const harness = createHarness(new Response(null, { status: 204 }));
    await expect(harness.client.logout()).resolves.toBeUndefined();
    const init = harness.fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "X-SCADA-CSRF": CSRF_TOKEN });
    expect(init?.credentials).toBe("same-origin");
    expect(init?.method).toBe("POST");
    expect(harness.fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/logout");
  });

  it("写入缺少 Cookie、重复 Cookie 和无效 CSRF 均在网络请求前拒绝", async () => {
    for (const cookie of [
      "",
      CSRF_COOKIE + "; " + CSRF_COOKIE,
      "__Host-adui-scada-csrf=伪造",
      "__Host-adui-scada-csrf=",
      "x=" + "a".repeat(4096),
    ]) {
      const harness = createHarness(jsonResponse(summary, 201), cookie);
      await expect(harness.client.createProject(documentCopy())).rejects.toMatchObject({
        kind: "unauthenticated",
      });
      expect(harness.fetcher).not.toHaveBeenCalled();
    }
  });

  it("创建工程发送的请求体只有 document，不携带租户、操作人或预期修订号", async () => {
    const harness = createHarness(jsonResponse(summary, 201));
    expect(await harness.client.createProject(documentCopy())).toEqual(summary);
    const [path, init] = harness.fetcher.mock.calls[0]!;
    expect(path).toBe("/api/v1/projects");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "X-SCADA-CSRF": CSRF_TOKEN,
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["document"]);
    expect(body.document).toEqual(waterTreatmentDemoDocument);
    expect(JSON.stringify(body)).not.toContain("tenantId");
    expect(JSON.stringify(body)).not.toContain("expectedRevision");
    expect(JSON.stringify(body)).not.toContain("sessionToken");
  });

  it("创建前 Core 校验拒绝过时工程文档且不发送请求", async () => {
    const harness = createHarness(jsonResponse(summary, 201));
    const document = documentCopy();
    document.schemaVersion = "0.1.0";
    await expect(harness.client.createProject(document)).rejects.toThrow(/schemaVersion/);
    expect(harness.fetcher).not.toHaveBeenCalled();
  });

  it("读取工程列表与详情使用共享的精确摘要协议", async () => {
    const list = createHarness(jsonResponse([summary]));
    expect(await list.client.listProjects()).toEqual([summary]);
    const item = createHarness(jsonResponse(summary));
    expect(await item.client.getProject(PROJECT_ID)).toEqual(summary);
    expect(item.fetcher.mock.calls[0]?.[0]).toBe("/api/v1/projects/" + PROJECT_ID);
  });

  it("工程列表使用安全游标分页并拒绝超限和异常排序", async () => {
    const next = { ...summary, projectId: PROJECT_ID + "-2" };
    const valid = createHarness(jsonResponse([summary, next]));
    expect(await valid.client.listProjects({ limit: 2, afterProjectId: "a" })).toEqual([
      summary,
      next,
    ]);
    expect(valid.fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects?limit=2&afterProjectId=a",
    );

    const invalidQuery = createHarness(jsonResponse([]));
    await expect(invalidQuery.client.listProjects({ limit: 101 })).rejects.toThrow(
      "工程列表分页数量不能超过 100",
    );
    await expect(invalidQuery.client.listProjects({ limit: 0 })).rejects.toThrow(
      "工程列表分页数量必须是正安全整数",
    );
    await expect(
      invalidQuery.client.listProjects({ afterProjectId: "../other" }),
    ).rejects.toThrow("工程 ID 必须是合法的 1～128 字符 ASCII 标识符");
    expect(invalidQuery.fetcher).not.toHaveBeenCalled();

    const duplicate = createHarness(jsonResponse([summary, summary]));
    await expect(duplicate.client.listProjects()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    const reversed = createHarness(jsonResponse([next, summary]));
    await expect(reversed.client.listProjects()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    const tooMany = createHarness(jsonResponse([summary, next]));
    await expect(tooMany.client.listProjects({ limit: 1 })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("拒绝非法工程路径及跨工程摘要", async () => {
    const harness = createHarness(jsonResponse({ ...summary, projectId: "wrong" }));
    await expect(harness.client.getProject(PROJECT_ID)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(harness.client.getProject("../other")).rejects.toThrow(/工程 ID/);
    expect(harness.fetcher).toHaveBeenCalledTimes(1);
  });

  it("历史版本只拼接安全分页参数并验证摘要属于同一工程", async () => {
    const version = {
      projectId: PROJECT_ID,
      revision: 2,
      createdAt: CREATED_AT,
      contentHash: "a".repeat(64),
    };
    const harness = createHarness(jsonResponse([version]));
    expect(await harness.client.listVersions(PROJECT_ID, { limit: 50, beforeRevision: 3 })).toEqual(
      [version],
    );
    expect(harness.fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/" + PROJECT_ID + "/versions?limit=50&beforeRevision=3",
    );
  });

  it("分页数量和修订号超界、非安全整数不会发送请求", async () => {
    const harness = createHarness(jsonResponse([]));
    await expect(harness.client.listVersions(PROJECT_ID, { limit: 101 })).rejects.toThrow(/100/);
    await expect(harness.client.listVersions(PROJECT_ID, { beforeRevision: 0 })).rejects.toThrow(
      /正安全整数/,
    );
    await expect(
      harness.client.readVersion(PROJECT_ID, Number.MAX_SAFE_INTEGER + 1),
    ).rejects.toThrow(/正安全整数/);
    expect(harness.fetcher).not.toHaveBeenCalled();
  });

  it("读取历史版本调用 Core SHA-256 完整性校验", async () => {
    const snapshot = await createProjectSnapshot(documentCopy(), {
      revision: 1,
      createdAt: CREATED_AT,
    });
    const harness = createHarness(jsonResponse(snapshot));
    expect(await harness.client.readVersion(PROJECT_ID, 1)).toEqual(snapshot);
    expect(harness.fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/projects/" + PROJECT_ID + "/versions/1",
    );
    const tampered = { ...snapshot, contentHash: "f".repeat(64) };
    const invalid = createHarness(jsonResponse(tampered));
    await expect(invalid.client.readVersion(PROJECT_ID, 1)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("CAS 追加只发送 Core 契约，检查返回修订号并拒绝静默覆盖", async () => {
    const snapshot = await createProjectSnapshot(documentCopy(), {
      revision: 2,
      createdAt: CREATED_AT,
    });
    const harness = createHarness(jsonResponse(snapshot, 201));
    expect(await harness.client.appendVersion(PROJECT_ID, 1, documentCopy())).toEqual(snapshot);
    const body = JSON.parse(harness.fetcher.mock.calls[0]?.[1]?.body as string);
    expect(Object.keys(body)).toEqual(["expectedRevision", "document"]);
    expect(body.expectedRevision).toBe(1);
    const stale = createHarness(jsonResponse(snapshot, 201));
    await expect(stale.client.appendVersion(PROJECT_ID, 2, documentCopy())).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("CAS 冲突、身份失效、跨租户统一映射为受控中文错误", async () => {
    for (const [status, kind] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
    ] as const) {
      const harness = createHarness(jsonResponse({ message: "session-secret" }, status));
      const failure = await harness.client.getProject(PROJECT_ID).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ScadaApiError);
      expect(failure).toMatchObject({ status, kind });
      expect((failure as Error).message).not.toContain("session-secret");
    }
  });

  it("服务端 HTML、非法 JSON 和错误成功状态均按协议异常拒绝", async () => {
    const html = createHarness(
      new Response("<html>登录页</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await expect(html.client.listProjects()).rejects.toMatchObject({ kind: "invalid_response" });
    const broken = createHarness(
      new Response("{broken", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await expect(broken.client.listProjects()).rejects.toMatchObject({ kind: "invalid_response" });
    const mismatch = createHarness(jsonResponse([], 201));
    await expect(mismatch.client.listProjects()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("网络失败不会重试写入或暴露第三方异常信息", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error("上游密钥不得外泄");
    });
    const client = createScadaApiClient({ fetcher, readCookie: () => CSRF_COOKIE });
    const error = await client.createProject(documentCopy()).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ kind: "network" });
    expect((error as Error).message).not.toContain("上游密钥");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
