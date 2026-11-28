import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DockerB4RuntimeProbeError,
  verifyScadaB4RuntimeProbe,
} from "./docker-db-role-b4-runtime-probe.mjs";

import { createScadaB4RuntimeProbeFixture as fixture } from "./docker-db-role-b4-runtime-probe.fixture.mjs";

void test("B4 合成夹具正反向语句及管理身份恢复", async () => {
  const { client, calls } = fixture();
  const result = await verifyScadaB4RuntimeProbe(client, "18443");
  assert.equal(result.positiveCount, 36);
  assert.equal(result.deniedCount, 15);
  assert.equal(result.fixturesRolledBack, true);
  assert.equal(result.runtimeStatementsVerified, true);
  for (const flag of [
    "rowLockConcurrencyVerified",
    "rowAuthorizationVerified",
    "businessDataWritten",
    "admissionPassed",
  ])
    assert.equal(result[flag], false);
  assert.equal(calls.filter(({ sql }) => sql === "SAVEPOINT scada_b4_denial").length, 15);
  assert.equal(
    calls.filter(({ sql }) => sql === "ROLLBACK TO SAVEPOINT scada_b4_denial").length,
    15,
  );
  assert.equal(
    calls.some(({ sql }) => sql === "COMMIT"),
    false,
  );
  assert.equal(calls.at(-1).role, "adui_scada");
});

void test("非固定库或清理隔离失败时不写夹具", async () => {
  for (const fault of ["database", "lock", "existing"]) {
    const { client, calls } = fixture(fault);
    await assert.rejects(
      () => verifyScadaB4RuntimeProbe(client, "18443"),
      DockerB4RuntimeProbeError,
    );
    assert.equal(
      calls.some(({ sql }) => sql.startsWith("INSERT INTO public.")),
      false,
    );
    assert.equal(
      calls.some(({ sql }) => sql.includes("public.scada_cleanup_expired_oidc(")),
      false,
    );
  }
  const { client, calls } = fixture();
  await assert.rejects(
    () => verifyScadaB4RuntimeProbe(client, "18443;"),
    DockerB4RuntimeProbeError,
  );
  assert.deepEqual(calls, []);
});

void test("允许越权、错误码、重复创建或清理数不符时拒绝", async () => {
  for (const fault of ["allowed", "wrong-code", "duplicate", "cleanup", "cas"]) {
    const { client, calls } = fixture(fault);
    await assert.rejects(
      () => verifyScadaB4RuntimeProbe(client, "18443"),
      (error) => {
        assert.ok(error instanceof DockerB4RuntimeProbeError);
        assert.doesNotMatch(error.message, /SENSITIVE/u);
        return true;
      },
    );
    assert.ok(calls.some(({ sql }) => sql === "ROLLBACK TO SAVEPOINT scada_b4_runtime_probe"));
    assert.equal(
      calls.some(({ sql }) => sql === "COMMIT"),
      false,
    );
  }
});

void test("夹具回滚或残留检查失败时不报告成功", async () => {
  for (const fault of ["rollback", "residue"]) {
    const { client, calls } = fixture(fault);
    await assert.rejects(
      () => verifyScadaB4RuntimeProbe(client, "18443"),
      (error) => {
        assert.ok(error instanceof DockerB4RuntimeProbeError);
        assert.doesNotMatch(error.message, /SENSITIVE/u);
        return true;
      },
    );
    assert.equal(
      calls.some(({ sql }) => sql === "COMMIT"),
      false,
    );
  }
});
