import "reflect-metadata";
import { waterTreatmentDemoDocument } from "@adui/scada-core";
import { describe, expect, it } from "vite-plus/test";
import {
  assertPrisma8Writable,
  readPrisma8Transaction,
  writePrisma8Transaction,
  type Prisma8Transaction,
} from "../database/prisma8-read-transaction.js";
import type { Prisma8Client, Prisma8Service } from "../database/prisma8.service.js";
import { Prisma8RuntimeProjectVersionStore } from "./prisma8-runtime-project-version-store.js";

const actor = { tenantId: "tenant-a", subjectId: "operator-a" };
const document = waterTreatmentDemoDocument;
const projectId = document.projectId;
const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const input = { expectedRevision: 1, document };
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
  const steps: string[] = [];
  const reads: Plan[] = [];
  const writes: Plan[] = [];
  const scopes: unknown[] = [];
  const options: unknown[] = [];
  const state = {
    identityRows: [{ status: "active" }] as Row[],
    lockRows: [{ head_revision: "1" }] as Row[],
    grants: [{ permission: "version:append" }],
    affected: [] as number[],
    failAt: 0,
    corrupt: false,
    drift: false,
    boundaryChecks: 0,
    row: null as Row | null,
    committed: 0,
    rejected: 0,
  };
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => {
        const plan = { text: strings.join("?"), parameters };
        return {
          returnsRow: () => ({ build: () => plan }),
          affectedCount: () => ({ build: () => plan }),
        };
      },
    },
    query: (plan: Plan) => {
      reads.push(plan);
      let rows: Row[];
      if (plan.text.includes("current_database()")) {
        steps.push("边界");
        state.boundaryChecks += 1;
        rows = [
          state.drift && state.boundaryChecks === 2 ? { ...boundary, role: "wrong" } : boundary,
        ];
      } else if (plan.text.includes("FOR SHARE")) {
        steps.push("身份锁");
        rows = state.identityRows;
      } else if (plan.text.includes("FOR UPDATE")) {
        steps.push("工程锁");
        rows = state.lockRows;
      } else if (plan.text.includes("v.snapshot::text")) {
        steps.push("版本回读");
        rows = state.row
          ? [{ ...state.row, ...(state.corrupt ? { content_hash: "错误摘要" } : {}) }]
          : [];
      } else {
        throw new Error("工程事务出现未预期查询");
      }
      return { toArray: () => Promise.resolve(rows) };
    },
    execute: (plan: Plan) => {
      writes.push(plan);
      if (state.failAt === writes.length) throw new Error("模拟工程事务写入失败");
      const isGrants = plan.text.includes("INSERT INTO public.scada_project_grants");
      const count = state.affected.shift() ?? (isGrants ? 3 : 1);
      if (plan.text.includes("INSERT INTO public.scada_project_versions")) {
        steps.push("不可变版本");
        const [, , revision, snapshot, hash, subject, time] = plan.parameters;
        if (
          typeof revision !== "bigint" ||
          typeof snapshot !== "string" ||
          typeof hash !== "string" ||
          typeof subject !== "string" ||
          typeof time !== "string"
        ) {
          throw new Error("版本写入参数类型异常");
        }
        state.row = {
          snapshot_data: snapshot,
          content_hash: hash,
          created_by: subject,
          created_at: time,
          head_revision: String(revision),
          actor_id: subject,
          action: "version:append",
          event_id: "",
        };
      } else if (plan.text.includes("UPDATE public.scada_projects")) {
        steps.push("修订号比较更新");
      } else if (plan.text.includes("INSERT INTO public.scada_project_audit")) {
        steps.push("成功审计");
        const eventId = plan.parameters[0];
        if (!state.row || typeof eventId !== "string") throw new Error("审计参数异常");
        state.row.event_id = eventId;
      } else if (plan.text.includes("INSERT INTO public.scada_projects")) {
        steps.push("工程创建");
      } else if (plan.text.includes("INSERT INTO public.scada_project_release_state")) {
        steps.push("发布初始状态");
      } else if (isGrants) {
        steps.push("创建者授权");
      } else {
        throw new Error("工程事务出现未预期写入");
      }
      return Promise.resolve({ affectedRows: count });
    },
    orm: {
      public: {
        ScadaProjectGrant: {
          where: (scope: unknown) => {
            steps.push("锁内授权");
            scopes.push(scope);
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
    transaction: async (
      operation: (transaction: Prisma8Transaction) => Promise<unknown>,
      option: unknown,
    ) => {
      options.push(option);
      try {
        const result = await operation(tx as unknown as Prisma8Transaction);
        state.committed += 1;
        return result;
      } catch (error) {
        state.rejected += 1;
        throw error;
      }
    },
  } as unknown as Prisma8Client;
  const database = {
    assertWritable: () => assertPrisma8Writable(config),
    readTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      readPrisma8Transaction(client, config, storageHash, operation),
    writeTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      writePrisma8Transaction(client, config, storageHash, operation),
  } as Prisma8Service;
  return {
    store: new Prisma8RuntimeProjectVersionStore(database),
    state,
    steps,
    reads,
    writes,
    scopes,
    options,
  };
}

describe("全新原生工程版本持久化", () => {
  it("创建工程在一个事务内写入发布状态、创建者授权、首个版本及审计", async () => {
    const h = harness();
    const mutable = { ...actor };
    const pending = h.store.create(mutable, { document });
    mutable.tenantId = "tenant-b";
    const result = await pending;
    expect(result).toMatchObject({ projectId, headRevision: 1 });
    expect(h.options).toEqual([{ isolationLevel: "ReadCommitted", timeout: 10000 }]);
    expect(h.steps).toEqual([
      "边界",
      "身份锁",
      "工程创建",
      "发布初始状态",
      "创建者授权",
      "不可变版本",
      "修订号比较更新",
      "成功审计",
      "版本回读",
      "边界",
    ]);
    expect(h.reads[1]?.parameters).toEqual([actor.tenantId, actor.subjectId]);
    expect(h.writes[2]?.parameters).toEqual([
      actor.tenantId,
      projectId,
      actor.subjectId,
      actor.tenantId,
      projectId,
      actor.subjectId,
      actor.tenantId,
      projectId,
      actor.subjectId,
    ]);
    expect(h.writes[2]?.text).toContain("'version:append'");
    expect(h.writes[2]?.text).not.toContain("'release:publish'");
    expect(h.writes[4]?.parameters).toEqual([1n, result.createdAt, actor.tenantId, projectId, 0n]);
    expect(h.state.committed).toBe(1);
  });

  it("追加在排他行锁内复核完整授权并使用 BigInt 修订号比较更新", async () => {
    const h = harness();
    const snapshot = await h.store.append(actor, projectId, input);
    expect(snapshot.revision).toBe(2);
    expect(h.steps).toEqual([
      "边界",
      "工程锁",
      "锁内授权",
      "不可变版本",
      "修订号比较更新",
      "成功审计",
      "版本回读",
      "边界",
    ]);
    expect(h.scopes).toEqual([{ ...actor, projectId }]);
    expect(h.reads[1]?.parameters).toEqual([actor.tenantId, projectId]);
    expect(h.writes[1]?.parameters).toEqual([
      2n,
      snapshot.createdAt,
      actor.tenantId,
      projectId,
      1n,
    ]);
    expect(h.state.committed).toBe(1);
  });

  it("非法主体、请求和不匹配工程在取得事务前拒绝", async () => {
    const h = harness();
    await expect(h.store.create(null, { document })).rejects.toThrow("工程资源不存在或无权访问");
    await expect(h.store.create(actor, { document, tenantId: "tenant-b" })).rejects.toThrow(
      "工程创建请求只允许 document 字段",
    );
    await expect(h.store.append(actor, "different-project", input)).rejects.toThrow(
      "请求工程 ID 与路由工程 ID 不一致",
    );
    await expect(
      h.store.append(actor, projectId, { ...input, expectedRevision: 0 }),
    ).rejects.toThrow("工程预期修订号必须为 null 或大于零的安全整数");
    expect(h.options).toHaveLength(0);
  });

  it("严格只读配置在工程创建与追加取得事务前拒绝", async () => {
    const h = harness(true);
    await expect(h.store.create(actor, { document })).rejects.toThrow(
      "Prisma 8 只读提供方禁止写入",
    );
    await expect(h.store.append(actor, projectId, input)).rejects.toThrow(
      "Prisma 8 只读提供方禁止写入",
    );
    expect(h.options).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  });

  it("不存在或停用的身份不能创建工程", async () => {
    for (const rows of [[], [{ status: "disabled" }]]) {
      const h = harness();
      h.state.identityRows = rows;
      await expect(h.store.create(actor, { document })).rejects.toThrow("工程资源不存在或无权访问");
      expect(h.steps).toEqual(["边界", "身份锁"]);
      expect(h.writes).toHaveLength(0);
      expect(h.state.rejected).toBe(1);
    }
  });

  it("同租户重复工程拒绝并且不初始化任何附属数据", async () => {
    const h = harness();
    h.state.affected = [0];
    await expect(h.store.create(actor, { document })).rejects.toThrow(
      "当前租户下已存在相同工程标识的工程",
    );
    expect(h.writes).toHaveLength(1);
    expect(h.state.committed).toBe(0);
  });

  it("缺失工程、缺失权限以及混入未知权限都不允许追加", async () => {
    const absent = harness();
    absent.state.lockRows = [];
    await expect(absent.store.append(actor, projectId, input)).rejects.toThrow(
      "工程资源不存在或无权访问",
    );
    expect(absent.steps).toEqual(["边界", "工程锁"]);
    for (const grants of [
      [],
      [{ permission: "project:read" }],
      [{ permission: "version:append" }, { permission: "unknown" }],
    ]) {
      const h = harness();
      h.state.grants = grants;
      await expect(h.store.append(actor, projectId, input)).rejects.toThrow(
        "工程资源不存在或无权访问",
      );
      expect(h.steps).toEqual(["边界", "工程锁", "锁内授权"]);
      expect(h.writes).toHaveLength(0);
    }
  });

  it("过期修订号、异常文本和安全整数上限拒绝且不写入版本", async () => {
    const stale = harness();
    stale.state.lockRows = [{ head_revision: "2" }];
    await expect(stale.store.append(actor, projectId, input)).rejects.toThrow(
      "工程版本已变化，请重新获取最新修订号",
    );
    expect(stale.writes).toHaveLength(0);
    const invalid = harness();
    invalid.state.lockRows = [{ head_revision: "0x1" }];
    await expect(invalid.store.append(actor, projectId, input)).rejects.toThrow(
      "数据库工程修订号异常",
    );
    expect(invalid.writes).toHaveLength(0);
    const full = harness();
    full.state.lockRows = [{ head_revision: String(Number.MAX_SAFE_INTEGER) }];
    await expect(
      full.store.append(actor, projectId, { ...input, expectedRevision: Number.MAX_SAFE_INTEGER }),
    ).rejects.toThrow("工程修订号超出安全整数范围");
    expect(full.writes).toHaveLength(0);
  });

  it("影响行数不符时事务拒绝且不继续写审计", async () => {
    const h = harness();
    h.state.affected = [1, 0];
    await expect(h.store.append(actor, projectId, input)).rejects.toThrow(
      "工程版本事务影响行数异常",
    );
    expect(h.writes).toHaveLength(2);
    expect(h.state.rejected).toBe(1);
    expect(h.state.committed).toBe(0);
  });

  it("审计写入异常或版本回读不一致不得返回成功", async () => {
    const audit = harness();
    audit.state.failAt = 3;
    await expect(audit.store.append(actor, projectId, input)).rejects.toThrow(
      "模拟工程事务写入失败",
    );
    expect(audit.state.rejected).toBe(1);
    expect(audit.state.committed).toBe(0);
    const mismatch = harness();
    mismatch.state.corrupt = true;
    await expect(mismatch.store.append(actor, projectId, input)).rejects.toThrow(
      "工程版本事务回读元数据不一致",
    );
    expect(mismatch.state.rejected).toBe(1);
    expect(mismatch.state.committed).toBe(0);
  });

  it("业务写入之后数据库身份漂移仍拒绝提交结果", async () => {
    const h = harness();
    h.state.drift = true;
    await expect(h.store.append(actor, projectId, input)).rejects.toThrow();
    expect(h.steps.at(-1)).toBe("边界");
    expect(h.state.rejected).toBe(1);
    expect(h.state.committed).toBe(0);
  });
});
