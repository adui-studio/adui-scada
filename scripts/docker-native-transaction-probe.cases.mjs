import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  DOCKER_TRANSACTION_CONFIRMATION,
  requireDockerTransactionConfirmation,
  verifyDockerNativeTransactions,
} from "../apps/server/src/database/docker-native-transaction-probe.ts";
import {
  resolveDockerReadOnlyConfig,
  resolveDockerTransactionProbeConfig,
} from "../apps/server/src/database/docker-readonly-config.ts";
import { resolvePrisma8RuntimeUrl } from "../apps/server/src/database/prisma8-runtime-boundary.ts";

const hash = "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
const binding = JSON.stringify({
  password: "a".repeat(43),
  systemIdentifier: "123456789",
  storageHash: hash,
});
const failure = /原生临时事务探针未通过/;

/** 模拟数据库事务边界，只支持探针自身固定 SQL，不调用真实数据库。 */
function fixture(options = {}) {
  const state = {
    present: Boolean(options.existing),
    value: "",
    transactions: 0,
    commits: 0,
    rollbacks: 0,
    writes: [],
  };
  const transaction = async (operation) => {
    state.transactions += 1;
    const index = state.transactions;
    let present = state.present;
    let value = state.value;
    const tx = {
      raw: {
        sql: (strings, ...parameters) => {
          const plan = { text: strings.join("?"), parameters };
          return {
            returnsRow: () => ({ build: () => plan }),
            affectedCount: () => ({ build: () => plan }),
          };
        },
      },
      query: (plan) => {
        if (plan.text.includes("pg_catalog.pg_backend_pid()")) {
          return {
            toArray: () =>
              Promise.resolve([
                {
                  pid: options.otherBackend && index === 2 ? "22" : "11",
                  present: String(present),
                },
              ]),
          };
        }
        assert.match(
          plan.text,
          /^SELECT value::text AS value FROM pg_temp\.adui_scada_native_tx_probe$/u,
        );
        return { toArray: () => Promise.resolve(present ? [{ value }] : []) };
      },
      execute: (plan) => {
        state.writes.push(plan.text);
        assert.match(plan.text, /pg_temp\.adui_scada_native_tx_probe/u);
        if (plan.text.startsWith("CREATE TEMP TABLE ")) {
          assert.equal(present, false);
          present = true;
          return Promise.resolve({ affectedRows: 0 });
        }
        if (plan.text.startsWith("INSERT INTO ")) {
          assert.equal(present, true);
          value = plan.parameters[0];
          return Promise.resolve({ affectedRows: options.wrongCount ? 0 : 1 });
        }
        if (plan.text.startsWith("UPDATE ")) {
          if (options.sqlError) throw new Error("模拟临时表更新异常");
          assert.equal(value, plan.parameters[1]);
          value = plan.parameters[0];
          return Promise.resolve({ affectedRows: 1 });
        }
        assert.match(plan.text, /^DROP TABLE pg_temp\.adui_scada_native_tx_probe$/u);
        if (options.cleanupFailed) throw new Error("模拟临时表清理异常");
        present = false;
        return Promise.resolve({ affectedRows: 0 });
      },
    };
    try {
      const result = await operation(tx);
      if (!(options.noCommit && index === 1)) {
        state.present = present;
        state.value = value;
      }
      state.commits += 1;
      return result;
    } catch (error) {
      if (options.noRollback) {
        state.present = present;
        state.value = value;
      }
      state.rollbacks += 1;
      if (options.swallowRollback) return undefined;
      throw error;
    }
  };
  return {
    state,
    database: {
      writable: !options.readOnly,
      readTransaction: transaction,
      writeTransaction: transaction,
    },
  };
}

void describe("容器原生临时事务探针", () => {
  void it("确认参数必须单独且精确匹配", () => {
    assert.doesNotThrow(() =>
      requireDockerTransactionConfirmation([DOCKER_TRANSACTION_CONFIRMATION]),
    );
    for (const args of [[], ["--yes"], [DOCKER_TRANSACTION_CONFIRMATION, "--yes"]]) {
      assert.throws(() => requireDockerTransactionConfirmation(args), /需要单独明确确认/);
    }
  });

  void it("独立探针绑定固定容器目标且不改变常驻只读配置", () => {
    const config = resolveDockerTransactionProbeConfig(binding, hash);
    const readOnly = resolveDockerReadOnlyConfig(binding, hash);
    assert.equal(config.connectionString, readOnly.connectionString);
    assert.equal(config.expectedSystemIdentifier, "123456789");
    assert.equal(config.transport, "docker-transaction-probe");
    assert.equal(config.readOnly, false);
    assert.equal(readOnly.readOnly, true);
    const url = new URL(resolvePrisma8RuntimeUrl(config));
    assert.equal(url.hostname, "postgres");
    assert.equal(url.port, "5432");
    assert.equal(url.pathname, "/adui_scada");
    assert.match(url.searchParams.get("options") ?? "", /default_transaction_read_only=off/u);
    assert.match(
      new URL(resolvePrisma8RuntimeUrl(readOnly)).searchParams.get("options") ?? "",
      /default_transaction_read_only=on/u,
    );
  });

  void it("探针拒绝只读标志混用、缺失集群与其他库或连接地址", () => {
    const config = resolveDockerTransactionProbeConfig(binding, hash);
    const connectionString = config.connectionString;
    assert.ok(typeof connectionString === "string");
    for (const invalid of [
      { ...config, readOnly: true },
      { ...config, transport: "docker-readonly" },
      { ...config, expectedSystemIdentifier: undefined },
      { ...config, expectedSystemIdentifier: "0" },
      { ...config, connectionString: connectionString.replace("@postgres:", "@127.0.0.1:") },
      {
        ...config,
        connectionString: connectionString.replace("/adui_scada?", "/adui_scada_keycloak?"),
      },
    ]) {
      assert.throws(() => resolvePrisma8RuntimeUrl(invalid), /仅允许已初始化的本机业务库/);
    }
    assert.throws(
      () => resolveDockerTransactionProbeConfig(binding, "f".repeat(64)),
      /数据库绑定无效/,
    );
  });

  void it("提交后回读、主动回滚后保持原值并清理同一会话临时表", async () => {
    const { database, state } = fixture();
    assert.deepEqual(await verifyDockerNativeTransactions(database), {
      commitVerified: true,
      rollbackVerified: true,
      sameBackendVerified: true,
      temporaryTableRemoved: true,
      businessDataWritten: false,
    });
    assert.equal(state.transactions, 6);
    assert.equal(state.commits, 5);
    assert.equal(state.rollbacks, 1);
    assert.equal(state.present, false);
    assert.equal(state.writes.length, 4);
  });

  void it("只读提供方或既有同名临时表在写入前拒绝", async () => {
    const readOnly = fixture({ readOnly: true });
    await assert.rejects(verifyDockerNativeTransactions(readOnly.database), /需要独立可写连接/);
    assert.equal(readOnly.state.transactions, 0);
    const existing = fixture({ existing: true });
    await assert.rejects(verifyDockerNativeTransactions(existing.database), failure);
    assert.equal(existing.state.writes.length, 0);
  });

  void it("实际提交缺失或后端会话漂移均拒绝", async () => {
    for (const options of [{ noCommit: true }, { otherBackend: true }]) {
      const { database, state } = fixture(options);
      await assert.rejects(verifyDockerNativeTransactions(database), failure);
      assert.equal(state.writes.length, 2);
    }
  });

  void it("回滚未恢复原值或吞掉主动异常均不能报告成功", async () => {
    for (const options of [{ noRollback: true }, { swallowRollback: true }]) {
      const { database, state } = fixture(options);
      await assert.rejects(verifyDockerNativeTransactions(database), failure);
      assert.equal(state.writes.length, 3);
    }
  });

  void it("影响行数异常、SQL 失败及清理失败不得冒充回滚成功", async () => {
    for (const { options, expected } of [
      { options: { wrongCount: true }, expected: failure },
      { options: { sqlError: true }, expected: /模拟临时表更新异常/ },
      { options: { cleanupFailed: true }, expected: /模拟临时表清理异常/ },
    ]) {
      const { database } = fixture(options);
      await assert.rejects(verifyDockerNativeTransactions(database), expected);
    }
  });
});
