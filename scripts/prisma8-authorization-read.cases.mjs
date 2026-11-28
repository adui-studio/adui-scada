import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyAuthorizationPrincipal,
  isAuthorizationIdentifier,
  isExternalIdentityKey,
} from "../apps/server/src/auth/authorization-read-store.ts";

void test("授权标识拒绝空值、路径、控制字符及超长标识", () => {
  for (const value of [undefined, null, 1, "", "../tenant", "a/b", "a\n", "a".repeat(129)]) {
    assert.equal(isAuthorizationIdentifier(value), false);
  }
  for (const value of ["tenant-1", "subject_a", "project.a", "a".repeat(128)]) {
    assert.equal(isAuthorizationIdentifier(value), true);
  }
});

void test("外部身份查询键限制长度与控制字符", () => {
  assert.equal(isExternalIdentityKey("https://identity.invalid/realm", "subject-1"), true);
  for (const issuer of ["", "a".repeat(513), "https://identity.invalid/\n", "a b"]) {
    assert.equal(isExternalIdentityKey(issuer, "subject-1"), false);
  }
  for (const subject of ["", "a".repeat(256), "a\u0000b", "a\u007fb", "主体"]) {
    assert.equal(isExternalIdentityKey("https://identity.invalid/realm", subject), false);
  }
  assert.equal(isExternalIdentityKey("a".repeat(512), "b".repeat(255)), true);
});

void test("可信主体只返回固定且不可变的合法副本", () => {
  const source = { tenantId: "tenant-a", subjectId: "subject-a" };
  const principal = copyAuthorizationPrincipal(source.tenantId, source.subjectId);
  source.tenantId = "tenant-b";
  assert.deepEqual(principal, { tenantId: "tenant-a", subjectId: "subject-a" });
  assert.equal(Object.isFrozen(principal), true);
  assert.equal(copyAuthorizationPrincipal("tenant-a", "../bad"), null);
  assert.equal(copyAuthorizationPrincipal(undefined, "subject-a"), null);
});
