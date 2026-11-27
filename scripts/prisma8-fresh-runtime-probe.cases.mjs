import assert from "node:assert/strict";
import { test } from "node:test";
import { probeFreshRuntime } from "./prisma8-fresh-runtime-probe.mjs";

/** @param {{ failAt?: string, result?: unknown }} [options] 模拟失败阶段及工程查询结果 */
function fixture({ failAt = "", result = null } = {}) {
  const events = [];
  const record = (step) => {
    events.push(step);
    if (step === failAt) throw new Error("不应泄露的模拟连接凭据");
  };
  const client = {
    connect() {
      record("连接");
      return Promise.resolve();
    },
    end() {
      record("关闭连接");
      return Promise.resolve();
    },
  };
  const create = (connection) => {
    assert.equal(connection, client);
    record("创建运行时");
    return {
      orm: {
        public: {
          ScadaProject: {
            where(scope) {
              record("联合过滤");
              assert.match(scope.tenantId, /^prisma8-fresh-[a-f0-9-]{36}$/u);
              assert.equal(scope.projectId, scope.tenantId);
              return {
                select(...fields) {
                  assert.deepEqual(fields, ["tenantId", "projectId", "headRevision"]);
                  return {
                    first() {
                      record("只读查询");
                      return Promise.resolve(result);
                    },
                  };
                },
              };
            },
          },
        },
      },
      close() {
        record("关闭运行时");
        return Promise.resolve();
      },
    };
  };
  const verify = (connection) => {
    assert.equal(connection, client);
    record(events.includes("核验边界") ? "复核边界" : "核验边界");
    return Promise.resolve();
  };
  return { client, create, verify, events };
}

void test("原生运行时复用同一连接，核验联合过滤并按顺序关闭", async () => {
  const { client, create, verify, events } = fixture();
  assert.deepEqual(await probeFreshRuntime(client, create, verify), {
    missingScopeVerified: true,
    readOnlyBoundaryVerified: true,
  });
  assert.deepEqual(events, [
    "连接",
    "核验边界",
    "创建运行时",
    "联合过滤",
    "只读查询",
    "复核边界",
    "关闭运行时",
    "关闭连接",
  ]);
});

void test("连接或边界失败时不创建运行时且关闭连接", async () => {
  for (const failAt of ["连接", "核验边界"]) {
    const { client, create, verify, events } = fixture({ failAt });
    await assert.rejects(probeFreshRuntime(client, create, verify), /只读探针失败/u);
    assert.equal(events.includes("创建运行时"), false);
    assert.equal(events.at(-1), "关闭连接");
  }
});

void test("运行时创建失败仍关闭连接，非空查询及边界漂移均拒绝", async () => {
  for (const options of [
    { failAt: "创建运行时", result: null },
    { failAt: "只读查询", result: null },
    { failAt: "复核边界", result: null },
    { failAt: "", result: { headRevision: 0n } },
  ]) {
    const { client, create, verify, events } = fixture(options);
    await assert.rejects(probeFreshRuntime(client, create, verify), /只读探针失败/u);
    assert.equal(events.at(-1), "关闭连接");
    assert.equal(events.includes("关闭运行时"), options.failAt !== "创建运行时");
  }
});

void test("运行时或连接关闭异常不得返回成功且不回显底层异常", async () => {
  for (const failAt of ["关闭运行时", "关闭连接"]) {
    const { client, create, verify, events } = fixture({ failAt });
    await assert.rejects(probeFreshRuntime(client, create, verify), {
      message: /^关闭 Prisma 8 全新运行时(?:连接)?失败$/u,
    });
    assert.equal(events.at(-1), "关闭连接");
  }
});
