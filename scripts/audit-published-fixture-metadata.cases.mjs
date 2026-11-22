import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyPublishedFixtureMetadata,
  parsePublishedFixtureMetadataArgs,
} from "./audit-published-fixture-metadata.mjs";

const PROJECT = "d5b7b-published-12345678-1234-4234-8234-123456789abc";
const EVENT = "12345678-1234-4234-8234-123456789abc";
const HASH = "a".repeat(64);
const ERROR = /D5b7b 发布夹具只读元数据不完整或不一致/;

function released() {
  return {
    context: {
      database_name: "adui_scada",
      database_user: "adui_scada",
      tenant_id: "lab-tenant",
      subject_id: "lab-engineer",
      project_id: PROJECT,
      identity_count: "1",
      external_identity_count: "1",
    },
    project: [{ tenant_id: "lab-tenant", project_id: PROJECT, head_revision: "2" }],
    grants: [{ subject_id: "lab-engineer", permission: "release:read" }],
    releaseState: [{
      release_generation: "1",
      released_revision: "1",
      released_content_hash: HASH,
      last_release_event_id: EVENT,
    }],
    releasedVersion: [{ revision: "1", content_hash: HASH }],
    lastEvent: [{
      event_id: EVENT,
      tenant_id: "lab-tenant",
      project_id: PROJECT,
      generation: "1",
      action: "PUBLISH",
      to_revision: "1",
      to_content_hash: HASH,
    }],
  };
}

function expectInvalid(change) {
  const rows = released();
  change(rows);
  assert.throws(() => classifyPublishedFixtureMetadata(rows, PROJECT), ERROR);
}

void describe("D5b7b 已发布夹具元数据只读预检安全边界", () => {
  void it("必须显式提供专用工程 ID，拒绝创建发布撤权及额外参数", () => {
    assert.deepEqual(parsePublishedFixtureMetadataArgs(["--project-id", PROJECT]), {
      projectId: PROJECT,
    });
    for (const args of [
      [],
      ["--project-id", "d5b4-revoke-12345678-1234-4234-8234-123456789abc"],
      ["--project-id", "../../secret"],
      ["--project-id", PROJECT, "--publish"],
      ["--apply", "--confirm-lab", "adui_scada"],
      ["--project-id", PROJECT.toUpperCase()],
    ]) {
      assert.throws(
        () => parsePublishedFixtureMetadataArgs(args),
        /仅允许显式指定独立已发布夹具/,
      );
    }
  });

  void it("合法元数据仅返回待审核标记，不能冒充 verified", () => {
    assert.deepEqual(classifyPublishedFixtureMetadata(released(), PROJECT), {
      kind: "RELEASED_METADATA_ONLY",
    });
  });

  void it("已发布修订落后于编辑 head 不得回退到编辑版本", () => {
    const rows = released();
    rows.project[0].head_revision = "35";
    assert.deepEqual(classifyPublishedFixtureMetadata(rows, PROJECT), {
      kind: "RELEASED_METADATA_ONLY",
    });
  });

  void it("有独立读取权限但尚未发布时只返回 UNRELEASED", () => {
    const rows = released();
    rows.releaseState = [{
      release_generation: "0",
      released_revision: null,
      released_content_hash: null,
      last_release_event_id: null,
    }];
    rows.releasedVersion = [];
    rows.lastEvent = [];
    assert.deepEqual(classifyPublishedFixtureMetadata(rows, PROJECT), { kind: "UNRELEASED" });
  });

  void it("工程不存在或读取权限缺失时不暴露发布状态", () => {
    const missing = released();
    missing.project = [];
    assert.deepEqual(classifyPublishedFixtureMetadata(missing, PROJECT), { kind: "DENIED" });
    const revoked = released();
    revoked.grants = [];
    revoked.releaseState = [{ released_revision: "SECRET" }];
    assert.deepEqual(classifyPublishedFixtureMetadata(revoked, PROJECT), { kind: "DENIED" });
  });

  void it("数据库用户租户工程主体及可信身份不符一律拒绝", () => {
    for (const change of [
      (r) => { r.context.database_name = "adui_scada_test"; },
      (r) => { r.context.database_user = "postgres"; },
      (r) => { r.context.tenant_id = "other"; },
      (r) => { r.context.subject_id = "other"; },
      (r) => { r.context.project_id = "other"; },
      (r) => { r.context.identity_count = 0; },
      (r) => { r.context.external_identity_count = 2; },
    ]) {
      expectInvalid(change);
    }
  });

  void it("跨工程引用重复工程和无效 head 必须拒绝", () => {
    for (const change of [
      (r) => { r.project[0].project_id = "other"; },
      (r) => { r.project[0].tenant_id = "other"; },
      (r) => { r.project.push(r.project[0]); },
      (r) => { r.project[0].head_revision = "0"; },
      (r) => { r.project[0].head_revision = "9007199254740992"; },
    ]) {
      expectInvalid(change);
    }
  });

  void it("多余或跨主体授权不能等价于 release:read", () => {
    for (const change of [
      (r) => { r.grants[0].permission = "project:read"; },
      (r) => { r.grants[0].subject_id = "other"; },
      (r) => { r.grants.push(r.grants[0]); },
    ]) {
      expectInvalid(change);
    }
  });

  void it("未发布状态不允许残留发布指针或末次事件", () => {
    for (const change of [
      (r) => { r.releaseState[0].release_generation = "0"; },
      (r) => { r.releaseState[0].released_revision = null; },
      (r) => { r.releaseState[0].last_release_event_id = null; },
      (r) => { r.releaseState[0].release_generation = "-1"; },
      (r) => { r.releaseState[0].release_generation = "9007199254740992"; },
    ]) {
      expectInvalid(change);
    }
  });

  void it("发布版本修订与摘要必须双向匹配", () => {
    for (const change of [
      (r) => { r.releasedVersion = []; },
      (r) => { r.releasedVersion[0].revision = "2"; },
      (r) => { r.releasedVersion[0].content_hash = "b".repeat(64); },
      (r) => { r.releaseState[0].released_content_hash = "A".repeat(64); },
      (r) => { r.releaseState[0].released_revision = "9007199254740992"; },
    ]) {
      expectInvalid(change);
    }
  });

  void it("末次事件跨租户跨工程代次动作和摘要异常均拒绝", () => {
    for (const change of [
      (r) => { r.lastEvent = []; },
      (r) => { r.lastEvent[0].event_id = "bad"; },
      (r) => { r.lastEvent[0].tenant_id = "other"; },
      (r) => { r.lastEvent[0].project_id = "other"; },
      (r) => { r.lastEvent[0].generation = "2"; },
      (r) => { r.lastEvent[0].action = "DELETE"; },
      (r) => { r.lastEvent[0].action = "ROLLBACK"; },
      (r) => { r.lastEvent[0].to_revision = "2"; },
      (r) => { r.lastEvent[0].to_content_hash = "b".repeat(64); },
    ]) {
      expectInvalid(change);
    }
  });

  void it("后续代次允许 ROLLBACK，但不代表发布安全门禁可用", () => {
    const rows = released();
    rows.releaseState[0].release_generation = "2";
    rows.lastEvent[0].generation = "2";
    rows.lastEvent[0].action = "ROLLBACK";
    assert.deepEqual(classifyPublishedFixtureMetadata(rows, PROJECT), {
      kind: "RELEASED_METADATA_ONLY",
    });
  });

  void it("禁止夹带工程正文、快照或额外数据库字段", () => {
    for (const change of [
      (r) => { r.snapshot = { secret: "SECRET" }; },
      (r) => { r.releasedVersion[0].snapshot = "SECRET"; },
      (r) => { r.context.connectionString = "SECRET"; },
    ]) {
      expectInvalid(change);
    }
  });

  void it("错误诊断不得泄漏原始输入，且校验不修改来源数据", () => {
    const rows = released();
    const before = structuredClone(rows);
    assert.deepEqual(classifyPublishedFixtureMetadata(rows, PROJECT), {
      kind: "RELEASED_METADATA_ONLY",
    });
    assert.deepEqual(rows, before);
    const corrupted = released();
    corrupted.lastEvent[0].event_id = "Token=SECRET";
    assert.throws(() => classifyPublishedFixtureMetadata(corrupted, PROJECT), (error) => {
      assert.equal(error.message, "D5b7b 发布夹具只读元数据不完整或不一致");
      assert.equal(error.message.includes("SECRET"), false);
      return true;
    });
  });
});
