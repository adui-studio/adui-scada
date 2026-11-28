import "reflect-metadata";
import { describe, expect, it } from "vite-plus/test";
import type { Prisma8Client, Prisma8Service } from "../database/prisma8.service.js";
import {
  readPrisma8Transaction,
  type Prisma8Transaction,
} from "../database/prisma8-read-transaction.js";
import {
  hasProjectPermission,
  type ProjectAccessAction,
} from "../projects/project-access-policy.js";
import { Prisma8AuthorizationReadStore } from "./prisma8-authorization-read-store.js";

const storageHash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const config = {
  connectionString: undefined,
  expectedSystemIdentifier: "123456789",
  readOnly: true,
};
const boundary = {
  database: "adui_scada",
  role: "adui_scada",
  sessionRole: "adui_scada",
  schema: "public",
  version: "190000",
  systemIdentifier: "123456789",
  storageHash,
  readOnly: "on",
  defaultReadOnly: "on",
  recovery: "false",
  isolation: "read committed",
};
const actor = { tenantId: "tenant-a", subjectId: "subject-a" };
const issuer = "https://identity.invalid/realm";
const subject = "external-subject";
const projectId = "project-a";

function harness() {
  const queries: Array<{ text: string; parameters: unknown[] }> = [];
  const scopes: unknown[] = [];
  const columns: unknown[] = [];
  const options: unknown[] = [];
  const boundaryRows = [[boundary], [boundary]];
  let identityRows = [{ tenant_id: actor.tenantId, subject_id: actor.subjectId }];
  let grantRows = [{ permission: "version:read" }];
  const tx = {
    raw: {
      sql: (strings: TemplateStringsArray, ...parameters: unknown[]) => ({
        returnsRow: () => ({
          build: () => ({ text: strings.join("?"), parameters }),
        }),
      }),
    },
    query: (plan: { text: string; parameters: unknown[] }) => {
      queries.push(plan);
      return {
        toArray: () =>
          Promise.resolve(
            plan.text.includes("current_database()") ? (boundaryRows.shift() ?? []) : identityRows,
          ),
      };
    },
    orm: {
      public: {
        ScadaProjectGrant: {
          where: (scope: unknown) => {
            scopes.push(scope);
            return {
              select: (...selected: unknown[]) => {
                columns.push(selected);
                return { all: () => Promise.resolve(grantRows) };
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
    readTransaction: <T>(operation: (transaction: Prisma8Transaction) => Promise<T>) =>
      readPrisma8Transaction(client, config, storageHash, operation),
  } as Prisma8Service;
  return {
    store: new Prisma8AuthorizationReadStore(database),
    queries,
    scopes,
    columns,
    options,
    boundaryRows,
    set identityRows(value: typeof identityRows) {
      identityRows = value;
    },
    set grantRows(value: typeof grantRows) {
      grantRows = value;
    },
  };
}

describe("原生身份及工程授权仓储", () => {
  it("在真实业务库事务边界前后复核并按外部联合键参数化查询活跃身份", async () => {
    const h = harness();
    const principal = await h.store.findActiveExternalIdentity(issuer, subject);
    expect(principal).toEqual(actor);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(h.options).toEqual([{ isolationLevel: "ReadCommitted", timeout: 10000 }]);
    expect(h.queries).toHaveLength(3);
    expect(h.queries[0]?.text).toContain("prisma_contract.marker");
    expect(h.queries[1]?.parameters).toEqual([issuer, subject]);
    expect(h.queries[1]?.text).toContain("i.status = 'active'");
    expect(h.queries[1]?.text).toContain(
      "i.tenant_id = e.tenant_id AND i.subject_id = e.subject_id",
    );
    expect(h.queries[2]).toEqual(h.queries[0]);
  });

  it("缺失、重复及不合法的身份记录均返回拒绝结果", async () => {
    for (const rows of [
      [],
      [{ tenant_id: "tenant-a", subject_id: "../bad" }],
      [
        { tenant_id: "tenant-a", subject_id: "subject-a" },
        { tenant_id: "tenant-b", subject_id: "subject-b" },
      ],
    ]) {
      const h = harness();
      h.identityRows = rows;
      await expect(h.store.findActiveExternalIdentity(issuer, subject)).resolves.toBeNull();
    }
  });

  it("授权投影固定可信租户主体工程且保留完整权限供原纯策略核验", async () => {
    const h = harness();
    h.grantRows = [{ permission: "version:read" }, { permission: "unknown" }];
    const source = { ...actor };
    const pending = h.store.readProjectGrants(source, projectId);
    source.tenantId = "tenant-b";
    const grants = await pending;
    expect(h.scopes).toEqual([{ ...actor, projectId }]);
    expect(h.columns).toEqual([["permission"]]);
    expect(h.queries).toHaveLength(2);
    expect(grants).toEqual([{ permission: "version:read" }, { permission: "unknown" }]);
    expect(
      hasProjectPermission(
        actor,
        { tenantId: actor.tenantId, projectId },
        {
          ...actor,
          projectId,
          permissions: grants.map((grant) => grant.permission as ProjectAccessAction),
        },
        "version:read",
      ),
    ).toBe(false);
  });

  it("非法标识不启动事务或查询业务数据", async () => {
    const h = harness();
    await expect(h.store.findActiveExternalIdentity(issuer, "")).resolves.toBeNull();
    await expect(
      h.store.readProjectGrants({ ...actor, subjectId: "../bad" }, projectId),
    ).resolves.toEqual([]);
    await expect(h.store.readProjectGrants(actor, "../bad")).resolves.toEqual([]);
    expect(h.options).toHaveLength(0);
    expect(h.queries).toHaveLength(0);
    expect(h.scopes).toHaveLength(0);
  });

  it("错误业务库角色标记只读设置及事务隔离级别均在业务查询前拒绝", async () => {
    for (const drift of [
      { database: "adui_scada_test" },
      { role: "other" },
      { sessionRole: "other" },
      { schema: "private" },
      { version: "170000" },
      { systemIdentifier: "987654321" },
      { storageHash: "f".repeat(64) },
      { readOnly: "off" },
      { defaultReadOnly: "off" },
      { recovery: "true" },
      { isolation: "serializable" },
    ]) {
      const h = harness();
      h.boundaryRows[0] = [{ ...boundary, ...drift }];
      await expect(h.store.readProjectGrants(actor, projectId)).rejects.toThrow("边界不一致");
      expect(h.scopes).toHaveLength(0);
      expect(h.queries).toHaveLength(1);
    }
  });

  it("查询后边界漂移不能返回身份或授权结果", async () => {
    const h = harness();
    h.boundaryRows[1] = [{ ...boundary, storageHash: "" }];
    await expect(h.store.findActiveExternalIdentity(issuer, subject)).rejects.toThrow("边界不一致");
    expect(h.queries).toHaveLength(3);
  });
});
