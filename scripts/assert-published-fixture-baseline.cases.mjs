import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublishedFixtureBaselineRows,
  BASELINE_ERROR,
  BASELINE_PROJECT,
} from "./assert-published-fixture-baseline.mjs";

function fixture() {
  return {
    project: [{ head_revision: "1" }],
    versions: [{ revision: "1", created_by: "lab-engineer" }],
    audit: [{ revision: "1", actor_id: "lab-engineer", action: "version:append" }],
    state: [
      {
        release_generation: "0",
        released_revision: null,
        released_content_hash: null,
        last_release_event_id: null,
      },
    ],
    events: [{ count: 0 }],
    grants: ["project:read", "version:read", "version:append", "release:read"].map(
      (permission) => ({ subject_id: "lab-engineer", permission }),
    ),
  };
}

void describe("D5b7d 原 D5b1 基线只读安全门禁", () => {
  void it("仅接受唯一首版、未发布空指针、零发布事件和四项原授权", () => {
    assert.match(BASELINE_PROJECT, /^d5b-unreleased-/);
    assert.equal(assertPublishedFixtureBaselineRows(fixture()), true);
  });

  void it("缺失工程、重复历史版本、错误审计或主体必须拒绝", () => {
    for (const mutate of [
      (r) => {
        r.project = [];
      },
      (r) => {
        r.project[0].head_revision = "2";
      },
      (r) => {
        r.versions.push(r.versions[0]);
      },
      (r) => {
        r.versions[0].created_by = "other";
      },
      (r) => {
        r.audit[0].actor_id = "other";
      },
      (r) => {
        r.audit[0].action = "release:publish";
      },
    ]) {
      const rows = fixture();
      mutate(rows);
      assert.throws(() => assertPublishedFixtureBaselineRows(rows), new RegExp(BASELINE_ERROR));
    }
  });

  void it("任意发布指针、代次或事件破坏原未发布基线时拒绝", () => {
    for (const mutate of [
      (r) => {
        r.state[0].release_generation = "1";
      },
      (r) => {
        r.state[0].released_revision = "1";
      },
      (r) => {
        r.state[0].released_content_hash = "a".repeat(64);
      },
      (r) => {
        r.state[0].last_release_event_id = "bad";
      },
      (r) => {
        r.events[0].count = 1;
      },
      (r) => {
        r.state = [];
      },
    ]) {
      const rows = fixture();
      mutate(rows);
      assert.throws(() => assertPublishedFixtureBaselineRows(rows), new RegExp(BASELINE_ERROR));
    }
  });

  void it("授权重复、撤销、跨主体或额外授权必须拒绝", () => {
    for (const mutate of [
      (r) => {
        r.grants.pop();
      },
      (r) => {
        r.grants.push(r.grants[0]);
      },
      (r) => {
        r.grants[0].subject_id = "other";
      },
      (r) => {
        r.grants[0].permission = "release:publish";
      },
    ]) {
      const rows = fixture();
      mutate(rows);
      assert.throws(() => assertPublishedFixtureBaselineRows(rows), new RegExp(BASELINE_ERROR));
    }
  });

  void it("异常字段或夹带工程正文必须拒绝且不能修改输入", () => {
    const rows = fixture();
    const before = structuredClone(rows);
    assert.equal(assertPublishedFixtureBaselineRows(rows), true);
    assert.deepEqual(rows, before);
    rows.versions[0].snapshot = "SECRET";
    assert.throws(() => assertPublishedFixtureBaselineRows(rows), new RegExp(BASELINE_ERROR));
  });
});
