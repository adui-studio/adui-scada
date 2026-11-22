import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeD5b4fSequenceFailure,
  parseD5b4fSequenceArgs,
  planD5b4fSequence,
  runD5b4fSequence,
} from "./test-oidc-published-revocation-sequence.mjs";

const ID = "d5b4-revoke-12345678-1234-4234-8234-123456789abc";
const ORIGINAL = "d5b-unreleased-42c376a0-5bdc-4fd6-80d6-da29e0312aca";

void describe("D5b4f 撤权前后真实只读验收编排门禁", () => {
  void it("只接受当前阶段和现存专用工程，不开放创建、撤权或恢复参数", () => {
    for (const phase of ["before", "after"]) {
      assert.deepEqual(parseD5b4fSequenceArgs(["--phase", phase, "--project-id", ID]), {
        phase,
        projectId: ID,
      });
    }
    for (const args of [
      [],
      ["--phase", "before", "--project-id", ORIGINAL],
      ["--phase", "after", "--project-id", "d5b4-revoke-example"],
      ["--phase", "both", "--project-id", ID],
      ["--phase", "revoke", "--project-id", ID],
      ["--phase", "restore", "--project-id", ID],
      ["--phase", "before", "--project-id", "../secret"],
      ["--phase", "before", "--project-id", ID, "--apply"],
      ["--phase", "after", "--project-id", ID, "--confirm-lab", "adui_scada"],
      ["--apply", "--confirm-lab", "adui_scada"],
    ]) {
      assert.throws(
        () => parseD5b4fSequenceArgs(args),
        /只允许明确阶段与独立专用工程/,
      );
    }
  });

  void it("撤权前固定为两次四项 ACL 只读核验夹持一次真实双框架浏览器", () => {
    const steps = planD5b4fSequence({ phase: "before", projectId: ID });
    assert.deepEqual(
      steps.map(({ script, args }) => ({ script, args })),
      [
        {
          script: "preflight-oidc-published-revocation-target.mjs",
          args: ["--project-id", ID],
        },
        {
          script: "test-oidc-published-revocation-readonly.mjs",
          args: ["--phase", "before", "--project-id", ID],
        },
        {
          script: "preflight-oidc-published-revocation-target.mjs",
          args: ["--project-id", ID],
        },
      ],
    );
  });

  void it("撤权后固定为两次三项 ACL 只读核验夹持一次真实 404 双框架浏览器", () => {
    const steps = planD5b4fSequence({ phase: "after", projectId: ID });
    assert.deepEqual(
      steps.map(({ script, args }) => ({ script, args })),
      [
        {
          script: "preflight-oidc-published-revocation-after.mjs",
          args: ["--project-id", ID],
        },
        {
          script: "test-oidc-published-revocation-readonly.mjs",
          args: ["--phase", "after", "--project-id", ID],
        },
        {
          script: "preflight-oidc-published-revocation-after.mjs",
          args: ["--project-id", ID],
        },
      ],
    );
  });

  void it("程序内部也必须拒绝非法阶段、旧工程和任意构造的脚本参数", () => {
    for (const mode of [
      null,
      {},
      { phase: "both", projectId: ID },
      { phase: "before", projectId: ORIGINAL },
      { phase: "after", projectId: "d5b4-revoke-example" },
    ]) {
      assert.throws(() => planD5b4fSequence(mode), /只允许明确阶段与独立专用工程/);
    }
  });

  void it("合法阶段按数据库、真实浏览器、数据库依序成功并且全程只有固定脚本", async () => {
    for (const phase of ["before", "after"]) {
      const executed = [];
      assert.equal(
        await runD5b4fSequence({ phase, projectId: ID }, async (script, args) => {
          executed.push({ script, args });
          return 0;
        }),
        true,
      );
      assert.deepEqual(executed, planD5b4fSequence({ phase, projectId: ID }).map(
        ({ script, args }) => ({ script, args }),
      ));
    }
  });

  void it("首轮数据库不存在目标、缺失 ACL 或其他异常必须阻断全部浏览器与后续 SQL", async () => {
    const executed = [];
    await assert.rejects(
      runD5b4fSequence({ phase: "before", projectId: ID }, (script) => {
        executed.push(script);
        return 1;
      }),
      /首次数据库只读检查未通过，已停止/,
    );
    assert.deepEqual(executed, ["preflight-oidc-published-revocation-target.mjs"]);
  });

  void it("真实浏览器任一框架失败必须阻断末次数据库复核", async () => {
    const executed = [];
    await assert.rejects(
      runD5b4fSequence({ phase: "after", projectId: ID }, (script) => {
        executed.push(script);
        return executed.length === 1 ? 0 : 1;
      }),
      /React\/Vue 真实只读浏览器验收未通过，已停止/,
    );
    assert.deepEqual(executed, [
      "preflight-oidc-published-revocation-after.mjs",
      "test-oidc-published-revocation-readonly.mjs",
    ]);
  });

  void it("浏览器之后数据库 ACL 被改动或目标消失必须使整个阶段失败", async () => {
    const executed = [];
    await assert.rejects(
      runD5b4fSequence({ phase: "after", projectId: ID }, (script) => {
        executed.push(script);
        return executed.length < 3 ? 0 : 1;
      }),
      /末次数据库只读复核未通过，已停止/,
    );
    assert.equal(executed.length, 3);
    assert.equal(executed[0], executed[2]);
  });

  void it("异步子步骤必须串行，不得同时触发多次浏览器或数据库核查", async () => {
    let active = 0;
    const order = [];
    assert.equal(
      await runD5b4fSequence({ phase: "before", projectId: ID }, async (script) => {
        active += 1;
        assert.equal(active, 1);
        order.push("开始：" + script);
        await Promise.resolve();
        order.push("结束：" + script);
        active -= 1;
        return 0;
      }),
      true,
    );
    assert.equal(active, 0);
    assert.equal(order.length, 6);
    for (let index = 0; index < order.length; index += 2) {
      assert.match(order[index], /^开始：/);
      assert.match(order[index + 1], /^结束：/);
    }
  });

  void it("子步骤退出码异常、进程失败和未知异常信息始终以白名单中文脱敏", async () => {
    await assert.rejects(
      runD5b4fSequence({ phase: "before", projectId: ID }, () => null),
      /首次数据库只读检查未通过，已停止/,
    );
    assert.equal(
      describeD5b4fSequenceFailure(
        new Error("D5b4f 末次数据库只读复核未通过，已停止"),
      ),
      "D5b4f 末次数据库只读复核未通过，已停止",
    );
    assert.equal(
      describeD5b4fSequenceFailure(new Error("Cookie=SECRET; Token=SECRET")),
      "D5b4f 真实只读验收编排失败，内部信息已脱敏",
    );
  });
});
