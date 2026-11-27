import "reflect-metadata";
import { createProjectSnapshot, validateProjectReleasePreflight, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import { describe, expect, it } from "vite-plus/test";
import type { Contract as HistoricalContract } from "../generated/prisma8/contract.d.js";
import {
  assertPrisma8Writable,
  readPrisma8Transaction,
  type Prisma8Transaction,
} from "../database/prisma8-read-transaction.js";
import type { Prisma8Client, Prisma8Service } from "../database/prisma8.service.js";
import { Prisma8ProjectQueryStore } from "./prisma8-project-query-store.js";
import { Prisma8RuntimeProjectQueryStore } from "./prisma8-runtime-project-query-store.js";

const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const projectId = waterTreatmentDemoDocument.projectId;
const createdAt = "2026-11-27T00:00:00.000Z";
const projectRow = {
  project_id: projectId,
  head_revision: "2",
  created_at: createdAt,
  updated_at: createdAt,
};
type Row = Record<string, string>;
type Plan = { text: string; parameters: unknown[] };

function harness(readOnly = false) {
  const mode = readOnly ? "on" : "off";
  const config = { connectionString: undefined, expectedSystemIdentifier: "123456789", readOnly };
  const boundary = {
    database: "adui_scada",
    role: "adui_scada",
    sessionRole: "adui_scada",
    schema: "public",
    version: "190000",
    systemIdentifier: "123456789",
    storageHash,
    readOnly: mode,
    defaultReadOnly: mode,
    recovery: "false",
    isolation: "read committed",
  };
  const queries: Plan[] = [];
  const steps: string[] = [];
  const scopes: unknown[] = [];
  const options: unknown[] = [];
  const state = {
    boundaryRows: [[boundary], [boundary]] as Row[][],
    projectRows: [projectRow] as Row[],
    lockRows: [{ head_revision: "2" }] as Row[],
    grants: [{ permission: "project:read" }, { permission: "version:read" }],
    versions: [{ project_id: projectId, revision: "2", created_at: createdAt, content_hash: "a".repeat(64) }] as Row[],
    snapshots: [] as Row[],
  };
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => ({
        returnsRow: () => ({
          build: () => ({ text: strings.join("?"), parameters }),
        }),
      }),
    },
    query: (plan: Plan) => {
      queries.push(plan);
      let rows: Row[];
      if (plan.text.includes("current_database()")) {
        steps.push("边界");
        rows = state.boundaryRows.shift() ?? [];
      } else if (plan.text.includes("FOR SHARE")) {
        steps.push("共享锁");
        rows = state.lockRows;
      } else if (plan.text.includes("snapshot::text")) {
        steps.push("快照");
        rows = state.snapshots;
      } else if (plan.text.includes("scada_project_versions")) {
        steps.push("版本列表");
        rows = state.versions;
      } else {
        steps.push("工程摘要");
        rows = state.projectRows;
      }
      return { toArray: () => Promise.resolve(rows) };
    },
    execute: () => {
      throw new Error("工程查询不得执行写入");
    },
    orm: {
      public: {
        ScadaProjectGrant: {
          where: (scope: unknown) => {
            scopes.push(scope);
            steps.push("授权");
            return {
              select: (column: string) => {
                if (column !== "permission") throw new Error("工程授权投影异常");
                return { all: () => Promise.resolve(state.grants) };
              },
            };
          },
        },
      },
    },
  };
  const client = {
    transaction: (
      operation: (transaction: Prisma8Transaction) => Promise<unknown>,
      option: unknown,
    ) => {
      options.push(option);
      return operation(tx as unknown as Prisma8Transaction);
    },
  } as unknown as Prisma8Client;
  const database = {
    assertWritable: () => assertPrisma8Writable(config),
    readTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      readPrisma8Transaction(client, config, storageHash, operation),
  } as Prisma8Service;
  return { store: new Prisma8RuntimeProjectQueryStore(database), state, boundary, queries, steps, scopes, options, client };
}

describe("原生工程查询仓储及事务边界", () => {
  it("只读工程列表使用可信租户主体、稳定游标及前后边界复核", async () => {
    const h = harness(true);
    const principal = { ...actor };
    const pending = h.store.list(principal, { limit: "2", afterProjectId: "project-a" });
    principal.tenantId = "tenant-b";
    await expect(pending).resolves.toEqual([{ projectId, headRevision: 2, createdAt, updatedAt: createdAt }]);
    expect(h.options).toEqual([{ isolationLevel: "ReadCommitted", timeout: 10000 }]);
    expect(h.steps).toEqual(["边界", "工程摘要", "边界"]);
    expect(h.queries[1]?.parameters).toEqual([actor.tenantId, "project-a", "project-a", actor.subjectId, 2]);
    expect(h.queries[1]?.text).toContain("g.tenant_id = p.tenant_id AND g.project_id = p.project_id");
    expect(h.queries[1]?.text).toContain("g.permission = 'project:read'");
    expect(h.queries[1]?.text).not.toContain("snapshot");
  });

  it("四项锁内查询在严格只读模式下提前拒绝而不取得事务", async () => {
    const h = harness(true);
    const message = "Prisma 8 只读提供方禁止写入";
    await expect(h.store.getProject(actor, projectId)).rejects.toThrow(message);
    await expect(h.store.listVersions(actor, projectId)).rejects.toThrow(message);
    await expect(h.store.read(actor, projectId, 1)).rejects.toThrow(message);
    await expect(h.store.preflightRelease(actor, projectId, 1)).rejects.toThrow(message);
    expect(h.options).toHaveLength(0);
    expect(h.steps).toHaveLength(0);
  });

  it("非法身份、工程、分页与修订号在取得事务前拒绝", async () => {
    const h = harness();
    await expect(h.store.list(null)).rejects.toThrow("工程资源不存在或无权访问");
    await expect(h.store.list(actor, { tenantId: "tenant-b" })).rejects.toThrow("工程列表分页只允许 limit 与 afterProjectId 参数");
    await expect(h.store.getProject(actor, "../bad")).rejects.toThrow("工程资源不存在或无权访问");
    await expect(h.store.listVersions(actor, projectId, { beforeRevision: 0 })).rejects.toThrow("历史分页修订号必须是大于零的安全整数");
    await expect(h.store.read(actor, projectId, 0)).rejects.toThrow("查询修订号必须为大于零的安全整数");
    await expect(h.store.preflightRelease(actor, projectId, Number.NaN)).rejects.toThrow("发布预检修订号必须为大于零的安全整数");
    expect(h.options).toHaveLength(0);
    expect(h.steps).toHaveLength(0);
  });

  it("工程详情先取得共享锁再复核完整权限并读取同一联合键", async () => {
    const h = harness();
    await expect(h.store.getProject(actor, projectId)).resolves.toEqual({ projectId, headRevision: 2, createdAt, updatedAt: createdAt });
    expect(h.steps).toEqual(["边界", "共享锁", "授权", "工程摘要", "边界"]);
    expect(h.scopes).toEqual([{ ...actor, projectId }]);
    expect(h.queries[1]?.parameters).toEqual([actor.tenantId, projectId]);
    expect(h.queries[2]?.parameters).toEqual([actor.tenantId, projectId]);
  });

  it("缺失工程、缺失权限与未知权限不读取工程正文或摘要", async () => {
    const missing = harness();
    missing.state.lockRows = [];
    await expect(missing.store.getProject(actor, projectId)).rejects.toThrow("工程资源不存在或无权访问");
    expect(missing.steps).toEqual(["边界", "共享锁"]);
    for (const grants of [[], [{ permission: "version:read" }], [{ permission: "project:read" }, { permission: "unknown" }]]) {
      const h = harness();
      h.state.grants = grants;
      await expect(h.store.getProject(actor, projectId)).rejects.toThrow("工程资源不存在或无权访问");
      expect(h.steps).toEqual(["边界", "共享锁", "授权"]);
    }
  });

  it("历史列表以参数化 BigInt 修订号倒序分页且不读取快照", async () => {
    const h = harness();
    await expect(h.store.listVersions(actor, projectId, { limit: 2, beforeRevision: 12 })).resolves.toEqual([{ projectId, revision: 2, createdAt, contentHash: "a".repeat(64) }]);
    expect(h.steps).toEqual(["边界", "共享锁", "授权", "版本列表", "边界"]);
    expect(h.queries[2]?.parameters).toEqual([actor.tenantId, projectId, 12n, 12n, 2]);
    expect(h.queries[2]?.text).toContain("ORDER BY scada_project_versions.revision DESC");
    expect(h.queries[2]?.text).not.toContain("snapshot");
  });

  it("历史快照读取和发布预检复用原摘要与元数据校验", async () => {
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, { revision: 2, createdAt });
    const row = { snapshot_data: JSON.stringify(snapshot), content_hash: snapshot.contentHash, created_at: createdAt };
    const h = harness();
    h.state.snapshots = [row];
    await expect(h.store.read(actor, projectId, 2)).resolves.toEqual(snapshot);
    expect(h.steps).toEqual(["边界", "共享锁", "授权", "快照", "边界"]);
    expect(h.queries[2]?.parameters).toEqual([actor.tenantId, projectId, 2n]);
    const preflight = harness();
    preflight.state.snapshots = [row];
    const report = validateProjectReleasePreflight(snapshot.document);
    await expect(preflight.store.preflightRelease(actor, projectId, 2)).resolves.toEqual({
      projectId, revision: 2, headRevision: 2, contentHash: snapshot.contentHash, passed: report.passed, issues: report.issues,
    });
    expect(preflight.steps).toEqual(["边界", "共享锁", "授权", "快照", "边界"]);
  });

  it("不存在版本、错配快照与过期发布预检均安全拒绝", async () => {
    const missing = harness();
    await expect(missing.store.read(actor, projectId, 2)).rejects.toThrow("指定工程版本不存在");
    const snapshot = await createProjectSnapshot(waterTreatmentDemoDocument, { revision: 2, createdAt });
    const mismatch = harness();
    mismatch.state.snapshots = [{ snapshot_data: JSON.stringify(snapshot), content_hash: "0".repeat(64), created_at: createdAt }];
    await expect(mismatch.store.read(actor, projectId, 2)).rejects.toThrow("数据库工程版本元数据与快照不一致");
    const stale = harness();
    await expect(stale.store.preflightRelease(actor, projectId, 1)).rejects.toThrow("工程版本已变化，请重新获取最新修订号");
    expect(stale.steps).toEqual(["边界", "共享锁", "授权"]);
  });

  it("缺失文本列、超界修订号及事务前后标记漂移均不返回业务结果", async () => {
    const invalid = harness();
    invalid.state.projectRows = [{}];
    await expect(invalid.store.list(actor)).rejects.toThrow("工程事务查询结果缺少有效文本列");
    const overflow = harness();
    overflow.state.projectRows = [{ ...projectRow, head_revision: "9007199254740992" }];
    await expect(overflow.store.list(actor)).rejects.toThrow("数据库工程修订号超出安全整数范围");
    const before = harness();
    before.state.boundaryRows[0] = [{ ...before.boundary, storageHash: "" }];
    await expect(before.store.getProject(actor, projectId)).rejects.toThrow("边界不一致");
    expect(before.steps).toEqual(["边界"]);
    const after = harness();
    after.state.boundaryRows[1] = [{ ...after.boundary, storageHash: "" }];
    await expect(after.store.getProject(actor, projectId)).rejects.toThrow("边界不一致");
    expect(after.steps).toEqual(["边界", "共享锁", "授权", "工程摘要", "边界"]);
  });

  it("历史隔离候选拒绝新业务库且不执行工程查询", async () => {
    const h = harness();
    h.state.boundaryRows[0] = [{
      database_name: "adui_scada",
      schema_name: "public",
      read_only: "off",
      isolation: "read committed",
    }];
    const historical = new Prisma8ProjectQueryStore(h.client as unknown as PostgresClient<HistoricalContract>);
    await expect(historical.list(actor)).rejects.toThrow("Prisma 8 工程查询候选仅允许隔离库读已提交事务");
    expect(h.steps).toEqual(["边界"]);
    expect(h.scopes).toHaveLength(0);
  });
});
