import { describe, expect, it } from "vite-plus/test";
import { hasProjectPermission } from "./project-access-policy.js";
import type {
  AuthenticatedProjectPrincipal,
  ProjectAccessAction,
  ProjectAccessScope,
  ProjectPermissionGrant,
} from "./project-access-policy.js";

const principal: AuthenticatedProjectPrincipal = {
  tenantId: "tenant-a",
  subjectId: "engineer-1",
};
const scope: ProjectAccessScope = { tenantId: "tenant-a", projectId: "water-demo" };
const grant: ProjectPermissionGrant = {
  ...scope,
  subjectId: "engineer-1",
  permissions: ["project:read", "version:read", "version:append"],
};

describe("服务端工程级权限策略", () => {
  it("相同租户和工程的有效授权允许读取工程", () => {
    expect(hasProjectPermission(principal, scope, grant, "project:read")).toBe(true);
  });

  it("已明确授权的版本写入操作允许通过", () => {
    expect(hasProjectPermission(principal, scope, grant, "version:append")).toBe(true);
  });

  it("只读授权不能推导出版本追加权限", () => {
    const readOnly: ProjectPermissionGrant = { ...grant, permissions: ["version:read"] };
    expect(hasProjectPermission(principal, scope, readOnly, "version:read")).toBe(true);
    expect(hasProjectPermission(principal, scope, readOnly, "version:append")).toBe(false);
  });

  it("没有认证主体必须拒绝操作", () => {
    expect(hasProjectPermission(null, scope, grant, "version:read")).toBe(false);
  });

  it("没有项目授权记录必须拒绝操作", () => {
    expect(hasProjectPermission(principal, scope, null, "version:read")).toBe(false);
  });

  it("跨租户访问即使工程 ID 相同也必须拒绝", () => {
    const otherScope = { ...scope, tenantId: "tenant-b" };
    expect(hasProjectPermission(principal, otherScope, grant, "version:read")).toBe(false);
    expect(
      hasProjectPermission({ ...principal, tenantId: "tenant-b" }, scope, grant, "version:read"),
    ).toBe(false);
  });

  it("授权记录关联其他工程时必须拒绝", () => {
    expect(
      hasProjectPermission(
        principal,
        scope,
        { ...grant, projectId: "other-project" },
        "version:read",
      ),
    ).toBe(false);
  });

  it("授权记录属于其他主体时必须拒绝", () => {
    expect(
      hasProjectPermission(
        principal,
        scope,
        { ...grant, subjectId: "another-user" },
        "version:read",
      ),
    ).toBe(false);
  });

  it("未知权限名称不会被解释为管理员或写入权限", () => {
    const invalidAction = "devices:write" as ProjectAccessAction;
    expect(hasProjectPermission(principal, scope, grant, invalidAction)).toBe(false);
    const unknownGrant = {
      ...grant,
      permissions: ["version:read", "project:admin"] as ProjectAccessAction[],
    };
    expect(hasProjectPermission(principal, scope, unknownGrant, "version:read")).toBe(false);
  });

  it("无效或缺失的权限集合不能视为有效授权", () => {
    const invalid = { ...grant, permissions: "version:append" as unknown as ProjectAccessAction[] };
    expect(hasProjectPermission(principal, scope, invalid, "version:append")).toBe(false);
    expect(
      hasProjectPermission(principal, scope, { ...grant, permissions: [] }, "version:read"),
    ).toBe(false);
  });

  it("非法租户、主体或工程标识符一律拒绝", () => {
    expect(
      hasProjectPermission(principal, { ...scope, projectId: "../secret" }, grant, "version:read"),
    ).toBe(false);
    expect(
      hasProjectPermission({ ...principal, subjectId: "" }, scope, grant, "version:read"),
    ).toBe(false);
    expect(
      hasProjectPermission(principal, scope, { ...grant, tenantId: "a/b" }, "version:read"),
    ).toBe(false);
  });
});
