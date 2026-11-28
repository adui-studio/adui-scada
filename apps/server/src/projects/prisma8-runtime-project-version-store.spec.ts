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
    createRows: [{ result: "CREATED" }] as Row[],
    createFault: false,
    initialStateRows: [
      { generation: "0", revision: "", hash: "", event_id: "", hash_is_null: "true" },
    ] as Row[],
    initialGrants: [
      { permission: "project:read" },
      { permission: "version:read" },
      { permission: "version:append" },
    ],
    created: false,
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
      } else if (plan.text.includes("public.scada_create_project(")) {
        steps.push("工程首版例程");
        if (state.createFault) throw new Error("模拟工程首版例程失败");
        rows = state.createRows;
        if (rows.length === 1 && rows[0]?.result === "CREATED") {
          const [, , subject, snapshot, hash, time, eventId] = plan.parameters;
          if (
            typeof subject !== "string" ||
            typeof snapshot !== "string" ||
            typeof hash !== "string" ||
            typeof time !== "string" ||
            typeof eventId !== "string"
          )
            throw new Error("首版例程参数异常");
          state.created = true;
          state.row = {
            snapshot_data: snapshot,
            content_hash: hash,
            created_by: subject,
            created_at: time,
            head_revision: "1",
            actor_id: subject,
            action: "version:append",
            event_id: eventId,
          };
        }
      } else if (plan.text.includes("public.scada_lock_identity(")) {
        steps.push("身份锁");
        rows = state.identityRows;
      } else if (plan.text.includes("public.scada_lock_release_state_share(")) {
        steps.push("发布状态回读");
        rows = state.initialStateRows;
      } else if (plan.text.includes("public.scada_lock_project_grants(")) {
        steps.push(state.created ? "创建者授权回读" : "锁内授权");
        const [tenantId, projectId, subjectId] = plan.parameters;
        scopes.push({ tenantId, projectId, subjectId });
        rows = state.created ? state.initialGrants : state.grants;
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
      const count = state.affected.shift() ?? 1;
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
      } else {
        throw new Error("工程事务出现未预期写入");
      }
      return Promise.resolve({ affectedRows: count });
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
      "工程首版例程",
      "版本回读",
      "发布状态回读",
      "创建者授权回读",
      "边界",
    ]);
    const create = h.reads[1];
    expect(create?.text).toContain("public.scada_create_project(");
    expect(create?.parameters.slice(0, 3)).toEqual([actor.tenantId, projectId, actor.subjectId]);
    expect(create?.parameters[3]).toBe(h.state.row?.snapshot_data);
    expect(create?.parameters.slice(4, 6)).toEqual([h.state.row?.content_hash, result.createdAt]);
    expect(create?.parameters[6]).toBe(h.state.row?.event_id);
    expect(h.reads[2]?.parameters).toEqual([actor.tenantId, projectId, 1n]);
    expect(h.reads[3]?.parameters).toEqual([actor.tenantId, projectId]);
    expect(h.reads[4]?.parameters).toEqual([actor.tenantId, projectId, actor.subjectId]);
    expect(h.writes).toHaveLength(0);
    expect(h.state.committed).toBe(1);
  });

  it("追加在排他行锁内复核完整授权并使用 BigInt 修订号比较更新", async () => {
    const h = harness();
    const snapshot = await h.store.append(actor, projectId, input);
    expect(snapshot.revision).toBe(2);
    expect(h.steps).toEqual([
      "边界",
      "工程锁",
      "身份锁",
      "锁内授权",
      "不可变版本",
      "修订号比较更新",
      "成功审计",
      "版本回读",
      "边界",
    ]);
    expect(h.scopes).toEqual([{ ...actor, projectId }]);
    expect(h.reads[1]?.parameters).toEqual([actor.tenantId, projectId]);
    expect(h.reads[2]?.parameters).toEqual([actor.tenantId, actor.subjectId]);
    expect(h.reads[3]?.parameters).toEqual([actor.tenantId, projectId, actor.subjectId]);
    expect(h.reads[3]?.text).toContain("public.scada_lock_project_grants(");
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
    const denied = harness();
    denied.state.createRows = [{ result: "DENIED" }];
    await expect(denied.store.create(actor, { document })).rejects.toThrow(
      "工程资源不存在或无权访问",
    );
    expect(denied.steps).toEqual(["边界", "工程首版例程"]);
    expect(denied.writes).toHaveLength(0);
    expect(denied.state.rejected).toBe(1);
    for (const rows of [[], [{ status: "disabled" }]]) {
      const h = harness();
      h.state.identityRows = rows;
      await expect(h.store.append(actor, projectId, input)).rejects.toThrow(
        "工程资源不存在或无权访问",
      );
      expect(h.steps).toEqual(["边界", "工程锁", "身份锁"]);
      expect(h.writes).toHaveLength(0);
      expect(h.state.rejected).toBe(1);
    }
  });

  it("同租户重复工程拒绝并且不初始化任何附属数据", async () => {
    const h = harness();
    h.state.createRows = [{ result: "EXISTS" }];
    await expect(h.store.create(actor, { document })).rejects.toThrow(
      "当前租户下已存在相同工程标识的工程",
    );
    expect(h.steps).toEqual(["边界", "工程首版例程"]);
    expect(h.writes).toHaveLength(0);
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
      expect(h.steps).toEqual(["边界", "工程锁", "身份锁", "锁内授权"]);
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

  it("首版例程缺失、返回异常及回读漂移不得回退直接写入", async () => {
    const unavailable = harness();
    unavailable.state.createFault = true;
    await expect(unavailable.store.create(actor, { document })).rejects.toThrow(
      "模拟工程首版例程失败",
    );
    expect(unavailable.steps).toEqual(["边界", "工程首版例程"]);
    expect(unavailable.writes).toHaveLength(0);
    for (const rows of [
      [],
      [{ result: "UNKNOWN" }],
      [{ result: "CREATED" }, { result: "CREATED" }],
    ]) {
      const h = harness();
      h.state.createRows = rows;
      await expect(h.store.create(actor, { document })).rejects.toThrow("工程首版例程返回结果无效");
      expect(h.state.committed).toBe(0);
      expect(h.writes).toHaveLength(0);
    }
    const stateDrift = harness();
    stateDrift.state.initialStateRows = [
      { generation: "1", revision: "1", hash: "", event_id: "", hash_is_null: "true" },
    ];
    await expect(stateDrift.store.create(actor, { document })).rejects.toThrow(
      "工程首版发布状态回读不一致",
    );
    expect(stateDrift.state.rejected).toBe(1);
    expect(stateDrift.writes).toHaveLength(0);
    const grantsDrift = harness();
    grantsDrift.state.initialGrants = [
      { permission: "project:read" },
      { permission: "version:append" },
      { permission: "release:publish" },
    ];
    await expect(grantsDrift.store.create(actor, { document })).rejects.toThrow(
      "工程首版创建者授权回读不一致",
    );
    expect(grantsDrift.state.rejected).toBe(1);
    expect(grantsDrift.writes).toHaveLength(0);
    const versionDrift = harness();
    versionDrift.state.corrupt = true;
    await expect(versionDrift.store.create(actor, { document })).rejects.toThrow(
      "工程版本事务回读元数据不一致",
    );
    expect(versionDrift.state.rejected).toBe(1);
    expect(versionDrift.writes).toHaveLength(0);
  });

  it("业务写入之后数据库身份漂移仍拒绝提交结果", async () => {
    const h = harness();
    h.state.drift = true;
    await expect(h.store.append(actor, projectId, input)).rejects.toThrow(
      "Prisma 8 运行时数据库身份、标记或连接边界不一致",
    );
    expect(h.steps.at(-1)).toBe("边界");
    expect(h.state.rejected).toBe(1);
    expect(h.state.committed).toBe(0);
  });
});
