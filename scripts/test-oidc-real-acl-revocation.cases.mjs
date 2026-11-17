import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeRevocationFailure,
  resolveRevocationMode,
  revokeSecondSubject,
  revokedResponsesInPage,
  verifyRevokedProject,
} from "./test-oidc-real-acl-revocation.mjs";

const projectId = "b34-oidc-cas-12345678-1234-1234-1234-123456789abc";
const owner = { tenantId: "lab-tenant", subjectId: "adui" };
const guest = { tenantId: "lab-tenant", subjectId: "test" };
const permissions = ["project:read", "version:read", "version:append"];

function mockDatabase({ guestGranted = true, extraGrant = false, version = 1 } = {}) {
  const calls = [];
  const ownerRows = permissions.map((permission) => ({ subject_id: owner.subjectId, permission }));
  const guestRows = guestGranted
    ? permissions.map((permission) => ({ subject_id: guest.subjectId, permission }))
    : [];
  const client = {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      if (sql.includes("FROM public.scada_projects")) {
        return { rows: [{ head_revision: String(version) }] };
      }
      if (sql.includes("FROM public.scada_project_versions")) {
        return { rows: [{ revision: "1", created_by: owner.subjectId }] };
      }
      if (sql.includes("FROM public.scada_project_audit")) {
        return { rows: [{ revision: "1", actor_id: owner.subjectId }] };
      }
      if (sql.startsWith("DELETE FROM public.scada_project_grants")) {
        return { rows: permissions.map((permission) => ({ permission })) };
      }
      if (sql.includes("FROM public.scada_project_grants")) {
        return {
          rows: [
            ...ownerRows,
            ...guestRows,
            ...(extraGrant ? [{ subject_id: "unknown", permission: "project:read" }] : []),
          ],
        };
      }
      return { rows: [] };
    },
  };
  return client;
}

void describe("真实双主体专用工程 ACL 撤销浏览器安全门禁", () => {
  void it("默认只读；必须显式确认当前本机 Lab 才允许创建专用工程并撤权", () => {
    assert.deepEqual(resolveRevocationMode([]), { write: false });
    assert.deepEqual(
      resolveRevocationMode(["--run-revoke", "--confirm-lab", "adui_scada"]),
      { write: true },
    );
    for (const input of [
      ["--run-revoke"],
      ["--run-revoke", "--confirm-lab", "adui_scada_test"],
      ["--run-revoke", "--confirm-lab", "adui_scada", "--force"],
      ["--run-revoke", "--confirm-lab", "adui_scada", "--run-cas"],
    ]) {
      assert.throws(
        () => resolveRevocationMode(input),
        /真实撤权专项仅允许只读预检或显式确认的本机 Lab 专用工程验收/,
      );
    }
  });

  void it("不允许任意工程 ID、不同租户或相同主体触发数据库事务", async () => {
    const client = mockDatabase();
    await assert.rejects(
      revokeSecondSubject(client, "existing-business-project", owner, guest),
      /专用工程权限撤销失败/,
    );
    await assert.rejects(
      revokeSecondSubject(client, projectId, owner, { ...guest, tenantId: "other-tenant" }),
      /两次登录所属租户不一致/,
    );
    await assert.rejects(
      revokeSecondSubject(client, projectId, owner, owner),
      /两次登录映射到同一本地主体/,
    );
    assert.equal(client.calls.length, 0);
  });

  void it("撤权只删除全新专用工程的第二主体三项固定 ACL，保留创建者 ACL", async () => {
    const client = mockDatabase();
    assert.equal(await revokeSecondSubject(client, projectId, owner, guest), true);
    const deletes = client.calls.filter((item) => item.sql.startsWith("DELETE"));
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0].args, [owner.tenantId, projectId, guest.subjectId]);
    assert.ok(deletes[0].sql.includes("AND permission IN"));
    assert.equal(client.calls[0].sql, "BEGIN ISOLATION LEVEL SERIALIZABLE");
    assert.equal(client.calls.at(-1).sql, "COMMIT");
    assert.equal(client.calls.filter((item) => item.sql.startsWith("UPDATE")).length, 0);
  });

  void it("权限已撤销的专用工程重复回收保持幂等，不再执行 SQL DELETE", async () => {
    const client = mockDatabase({ guestGranted: false });
    assert.equal(await revokeSecondSubject(client, projectId, owner, guest), false);
    assert.equal(client.calls.some((item) => item.sql.startsWith("DELETE")), false);
    assert.equal(client.calls.at(-1).sql, "COMMIT");
  });

  void it("遇到混入的其他主体授权或异常版本水位必须回滚，绝不删除权限", async () => {
    for (const options of [{ extraGrant: true }, { version: 2 }]) {
      const client = mockDatabase(options);
      await assert.rejects(
        revokeSecondSubject(client, projectId, owner, guest),
        /专用工程权限撤销失败/,
      );
      assert.equal(client.calls.at(-1).sql, "ROLLBACK");
      assert.equal(client.calls.some((item) => item.sql.startsWith("DELETE")), false);
    }
  });

  void it("撤销后仅有创建者首版、审计和三项权限才接受为成功", async () => {
    assert.equal(
      await verifyRevokedProject(mockDatabase({ guestGranted: false }), projectId, owner, guest),
      true,
    );
    for (const options of [{ guestGranted: true }, { version: 2 }]) {
      await assert.rejects(
        verifyRevokedProject(mockDatabase(options), projectId, owner, guest),
        /专用工程历史或权限校验失败/,
      );
    }
  });

  void it("浏览器只读取指定工程的三个真实 HTTP 状态，不输出 Cookie 或正文", async () => {
    const paths = [];
    const runtime = {
      location: { origin: "https://127.0.0.1:15174" },
      async fetch(path, options) {
        paths.push({ path, options });
        return { status: 404 };
      },
    };
    assert.deepEqual(
      await revokedResponsesInPage("https://127.0.0.1:15174", projectId, runtime),
      [404, 404, 404],
    );
    assert.equal(paths.length, 3);
    assert.ok(paths.every((row) => row.options.method === "GET"));
    assert.ok(paths.every((row) => row.options.credentials === "same-origin"));
    assert.ok(paths.every((row) => row.path.startsWith("/api/v1/projects/" + projectId)));
    await assert.rejects(
      revokedResponsesInPage("https://127.0.0.1:15173", projectId, runtime),
      /专用工程历史或权限校验失败/,
    );
    await assert.rejects(
      revokedResponsesInPage("https://127.0.0.1:15174", "existing-project", runtime),
      /专用工程历史或权限校验失败/,
    );
    assert.equal(paths.length, 3);
  });

  void it("未知异常被固定中文说明脱敏，不回显身份和浏览器凭据", () => {
    const message = describeRevocationFailure(new Error("Cookie=private; access-token=secret"));
    assert.equal(message, "真实双主体工程撤权专项未通过，内部细节已脱敏");
    assert.equal(message.includes("private"), false);
    const valid = new Error("专用工程权限撤销失败，必须核对定向 ACL");
    assert.equal(describeRevocationFailure(valid), valid.message);
  });
});
