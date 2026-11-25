import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PostgresClient, PostgresTransactionContext } from "@prisma/orm-postgres/runtime";
import { describe, expect, it, vi } from "vite-plus/test";
import type { Contract } from "../generated/prisma8/contract.d.js";
import type { ProjectAccessAction } from "../projects/project-access-policy.js";
import type { SecurityAuditDecision, SecurityAuditReporter } from "../security/scada-security-audit.js";
import { Prisma8ScadaProjectGuard } from "./prisma8-scada-project.guard.js";
import { SCADA_PROJECT_PERMISSION } from "./scada-project.guard.js";
import type { ScadaAuthenticatedRequest } from "./scada-session.guard.js";

type Tx = PostgresTransactionContext<Contract>;
const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = "project-a";
const denied = "工程资源不存在或无权访问";
const unavailable = "工程权限查询暂不可用，请稍后重试";
const boundary = {
  database_name: "adui_scada_test",
  schema_name: "public",
  read_only: "off",
  isolation: "read committed",
};

function context(
  request: ScadaAuthenticatedRequest,
  action?: ProjectAccessAction,
  type = "http",
): ExecutionContext {
  const handler = () => undefined;
  if (action) Reflect.defineMetadata(SCADA_PROJECT_PERMISSION, action, handler);
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => class TestRoute {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function request(principal = actor): ScadaAuthenticatedRequest {
  return {
    headers: { authorization: "Bearer 测试凭据不得进入审计" },
    params: { projectId },
    scadaPrincipal: principal,
  };
}

function harness(permissions: readonly string[] = ["version:read"], databaseName = boundary.database_name) {
  const records: SecurityAuditDecision[] = [];
  const audit: SecurityAuditReporter = { record: (decision) => { records.push(decision); } };
  const all = vi.fn<() => Promise<Array<{ permission: string }>>>()
    .mockResolvedValue(permissions.map((permission) => ({ permission })));
  const select = vi.fn<(column: "permission") => { all: typeof all }>()
    .mockReturnValue({ all });
  const where = vi.fn<(scope: { tenantId: string; projectId: string; subjectId: string }) => { select: typeof select }>()
    .mockReturnValue({ select });
  const tx = {
    raw: { sql: () => ({ returnsRow: () => ({ build: () => ({}) }) }) },
    query: () => ({ toArray: () => Promise.resolve([{ ...boundary, database_name: databaseName }]) }),
    orm: { public: { ScadaProjectGrant: { where } } },
  };
  const transaction = vi.fn<(operation: (transaction: Tx) => Promise<unknown>) => Promise<unknown>>()
    .mockImplementation((operation) => operation(tx as unknown as Tx));
  const guard = new Prisma8ScadaProjectGuard(
    { transaction } as unknown as PostgresClient<Contract>,
    new Reflector(),
    audit,
  );
  return { guard, records, transaction, where, select, all };
}

describe("Prisma 8 工程 ACL 前置 Guard 候选", () => {
  it("非 HTTP 与缺失权限元数据必须在数据库前拒绝", async () => {
    const { guard, transaction, records } = harness();
    await expect(guard.canActivate(context(request(), "version:read", "rpc")))
      .rejects.toThrow("工程权限仅支持受保护的 HTTP 请求");
    await expect(guard.canActivate(context(request()))).rejects.toThrow(denied);
    expect(transaction).not.toHaveBeenCalled();
    expect(records).toEqual([
      { action: "project.authorize", outcome: "denied", reason: "unsupported_context" },
      { action: "project.authorize", outcome: "denied", reason: "missing_policy" },
    ]);
  });

  it("缺失可信主体、跨租户路由与非法工程均不查询数据库", async () => {
    const { guard, transaction, records } = harness();
    await expect(guard.canActivate(context({ headers: {}, params: { projectId } }, "version:read")))
      .rejects.toThrow("尚未建立可信身份上下文");
    await expect(guard.canActivate(context({ ...request(), params: { projectId, tenantId: "tenant-b" } }, "version:read")))
      .rejects.toThrow(denied);
    await expect(guard.canActivate(context({ ...request(), params: { projectId: "../bad" } }, "version:read")))
      .rejects.toThrow(denied);
    expect(transaction).not.toHaveBeenCalled();
    expect(records.map((item) => item.reason)).toEqual(["missing_principal", "invalid_scope", "invalid_scope"]);
  });

  it("无效可信主体标识不得进入事务", async () => {
    const { guard, transaction } = harness();
    await expect(guard.canActivate(context(request({ ...actor, subjectId: "" }), "version:read")))
      .rejects.toThrow(denied);
    await expect(guard.canActivate(context(request({ ...actor, tenantId: "../bad" }), "version:read")))
      .rejects.toThrow(denied);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("按可信复合范围查询完整权限集合并只发送固定审计字段", async () => {
    const { guard, where, select, records, transaction } = harness();
    expect(await guard.canActivate(context(request(), "version:read"))).toBe(true);
    await expect(guard.canActivate(context(request(), "version:append"))).rejects.toThrow(denied);
    expect(where).toHaveBeenCalledWith({ ...actor, projectId });
    expect(select).toHaveBeenCalledWith("permission");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(records).toEqual([
      { action: "project.authorize", outcome: "allowed", reason: "permission_granted" },
      { action: "project.authorize", outcome: "denied", reason: "permission_denied" },
    ]);
    const output = JSON.stringify(records);
    expect(output).not.toContain(actor.tenantId);
    expect(output).not.toContain(actor.subjectId);
    expect(output).not.toContain(projectId);
    expect(output).not.toContain("Bearer");
  });

  it("未知授权项、未知动作与空权限集合全部拒绝", async () => {
    const invalid = harness(["version:read", "project:admin"]);
    await expect(invalid.guard.canActivate(context(request(), "version:read"))).rejects.toThrow(denied);
    const empty = harness([]);
    await expect(empty.guard.canActivate(context(request(), "version:read"))).rejects.toThrow(denied);
    const valid = harness(["release:read"]);
    await expect(valid.guard.canActivate(context(request(), "devices:write" as ProjectAccessAction))).rejects.toThrow(denied);
    await expect(valid.guard.canActivate(context(request(), "version:read"))).rejects.toThrow(denied);
    expect(await valid.guard.canActivate(context(request(), "release:read"))).toBe(true);
  });

  it("非隔离数据库不能查询任何 ACL", async () => {
    const { guard, where, records } = harness(["version:read"], "adui_scada");
    await expect(guard.canActivate(context(request(), "version:read"))).rejects.toThrow(unavailable);
    expect(where).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it("查询失败返回固定错误且不会生成授权成功日志", async () => {
    const { guard, all, records } = harness();
    all.mockRejectedValueOnce(new Error("测试内部连接信息不得回显"));
    await expect(guard.canActivate(context(request(), "version:read"))).rejects.toThrow(unavailable);
    expect(records).toEqual([]);
  });
});
