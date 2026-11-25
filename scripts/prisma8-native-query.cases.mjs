import assert from "node:assert/strict";
import test from "node:test";
import { expectedReleaseSample, reviewReleaseQueries } from "./prisma8-native-query-review.mjs";

const state = {
  tenantId: "tenant", projectId: "project", releaseGeneration: "3", releasedRevision: "2",
  releasedContentHash: "digest", lastReleaseEventId: "event",
};
const event = {
  tenantId: "tenant", projectId: "project", generation: "3", toRevision: "2",
  toContentHash: "digest", eventId: "event", action: "ROLLBACK",
};
const absentTenant = "missing-tenant";
const absentProject = "missing-project";

function readerFor(expected) {
  return {
    state: async (tenant, project) => tenant === state.tenantId && project === state.projectId ? expected : null,
    event: async (tenant, project, id) => tenant === state.tenantId && project === state.projectId && id === event.eventId ? expected?.lastReleaseEvent ?? null : null,
  };
}

void test("已发布样本保留 bigint、六字段闭包与回滚类型", async () => {
  const expected = expectedReleaseSample(state, event);
  assert.equal(expected.releaseGeneration, 3n);
  assert.equal(expected.lastReleaseEvent.toRevision, 2n);
  assert.equal(await reviewReleaseQueries(readerFor(expected), expected, absentTenant, absentProject), "MATCHED");
});

void test("未发布样本的所有关联为空且可独立核验", async () => {
  const expected = expectedReleaseSample({ ...state, releaseGeneration: "0", releasedRevision: null, releasedContentHash: null, lastReleaseEventId: null }, null);
  assert.equal(expected.lastReleaseEvent, null);
  assert.equal(await reviewReleaseQueries(readerFor(expected), expected, absentTenant, absentProject), "MATCHED");
});

void test("六字段分别漂移及非法事件类型均被拒绝", () => {
  for (const key of ["tenantId", "projectId", "generation", "toRevision", "toContentHash", "eventId", "action"]) {
    assert.throws(() => expectedReleaseSample(state, { ...event, [key]: "1" }), /六字段闭包/);
  }
});

void test("缺失事件及非空未发布指针均被拒绝", () => {
  assert.throws(() => expectedReleaseSample(state, null), /缺少完整/);
  assert.throws(() => expectedReleaseSample({ ...state, releaseGeneration: "0" }, null), /空关联/);
});

void test("空库仅记录空样本而非非空通过", async () => {
  assert.equal(await reviewReleaseQueries(readerFor(null), expectedReleaseSample(null, null), absentTenant, absentProject), "EMPTY");
});

void test("关联对象、标量 bigint 及显式事件查询漂移均被拒绝", async () => {
  const expected = expectedReleaseSample(state, event);
  for (const actual of [{ ...expected, lastReleaseEvent: null }, { ...expected, releaseGeneration: "3" }, null]) {
    await assert.rejects(reviewReleaseQueries(readerFor(actual), expected, absentTenant, absentProject), /关联事件查询结果不一致/);
  }
  const reader = readerFor(expected);
  reader.event = async () => null;
  await assert.rejects(reviewReleaseQueries(reader, expected, absentTenant, absentProject), /显式末次事件查询结果不一致/);
});

void test("错误租户和错误工程不可返回状态或事件", async () => {
  const expected = expectedReleaseSample(state, event);
  for (const axis of ["tenant", "project"]) {
    const reader = readerFor(expected);
    const base = reader.state;
    reader.state = async (tenant, project) => axis === "tenant" && tenant === absentTenant && project === state.projectId || axis === "project" && tenant === state.tenantId && project === absentProject ? expected : base(tenant, project);
    await assert.rejects(reviewReleaseQueries(reader, expected, absentTenant, absentProject), /错误租户|错误工程/);
    const other = readerFor(expected);
    const original = other.event;
    other.event = async (tenant, project, id) => axis === "tenant" && tenant === absentTenant || axis === "project" && project === absentProject ? expected.lastReleaseEvent : original(tenant, project, id);
    await assert.rejects(reviewReleaseQueries(other, expected, absentTenant, absentProject), /错误租户|错误工程/);
  }
});
