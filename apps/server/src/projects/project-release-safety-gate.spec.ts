import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ProjectSnapshot, ScadaDocument } from "@adui/scada-core";
import type { Prisma } from "../generated/prisma/client.js";
import {
  assessProjectReleaseSafety,
  ProjectReleaseGateUnavailableError,
  ProjectReleaseSafetyGate,
} from "./project-release-safety-gate.js";

const CONTEXT = {
  tenantId: "tenant-gate-test",
  actorId: "engineer-gate-test",
  projectId: waterTreatmentDemoDocument.projectId,
};
const CREATED_AT = "2026-11-22T00:00:00.000Z";

async function snapshotOf(edit?: (document: ScadaDocument) => void) {
  const document = JSON.parse(JSON.stringify(waterTreatmentDemoDocument)) as ScadaDocument;
  edit?.(document);
  return createProjectSnapshot(document, { revision: 1, createdAt: CREATED_AT });
}

describe("D5b8a 正式发布安全门禁的真实调用路径与未交付能力", () => {
  it("合法模拟 Tag 工程仍因无可信数据源与工业安全准入被拒绝", async () => {
    const snapshot = await snapshotOf();
    const before = JSON.stringify(snapshot);
    expect(assessProjectReleaseSafety(snapshot, CONTEXT)).toEqual([
      { code: "TAG_SOURCE_UNVERIFIED", path: "snapshot.document.tags" },
      { code: "TAG_BINDING_SOURCE_UNVERIFIED", path: "snapshot.document.pages" },
      { code: "INDUSTRIAL_BINDING_POLICY_UNVERIFIED", path: "snapshot.document.pages" },
      { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
      { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
    ]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("没有 Tag 和绑定的纯静态 SVG 仍不得绕过未完成的发布安全评审", async () => {
    const snapshot = await snapshotOf((document) => {
      document.tags = [];
      for (const page of document.pages) {
        for (const node of page.nodes) node.bindings = {};
      }
    });
    expect(assessProjectReleaseSafety(snapshot, CONTEXT)).toEqual([
      { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
      { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
    ]);
  });

  it("不可信身份和跨工程快照必须先形成独立阻塞类别", async () => {
    const snapshot = await snapshotOf();
    const issues = assessProjectReleaseSafety(snapshot, {
      tenantId: "",
      actorId: "",
      projectId: "other-project",
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      "UNTRUSTED_CONTEXT",
      "PROJECT_MISMATCH",
      "TAG_SOURCE_UNVERIFIED",
      "TAG_BINDING_SOURCE_UNVERIFIED",
      "INDUSTRIAL_BINDING_POLICY_UNVERIFIED",
      "RUNTIME_ADMISSION_UNAVAILABLE",
      "INDUSTRIAL_READ_POLICY_UNAVAILABLE",
    ]);
  });

  it("未知图元版本保留 Core 严格预检的拦截且不得显示工程正文", async () => {
    const snapshot = await snapshotOf((document) => {
      document.pages[0]!.nodes[0]!.symbolVersion = "2";
    });
    expect(assessProjectReleaseSafety(snapshot, CONTEXT)).toContainEqual({
      code: "RUNTIME_COMPATIBILITY_UNVERIFIED",
      path: "snapshot.document",
    });
  });

  it("隐藏图元中的有效绑定仍无法证明来源可信，且不得泄漏 Tag ID", async () => {
    const snapshot = await snapshotOf((document) => {
      document.tags = [document.tags[0]!];
      for (const page of document.pages) {
        for (const node of page.nodes) node.bindings = {};
      }
      const hidden = document.pages[0]!.nodes[1]!;
      hidden.bindings = { level: { tagId: "water.level" } };
      hidden.props.__scadaStudio = { visible: false };
    });
    const issues = assessProjectReleaseSafety(snapshot, CONTEXT);
    expect(issues.map((issue) => issue.code)).toEqual([
      "TAG_SOURCE_UNVERIFIED",
      "TAG_BINDING_SOURCE_UNVERIFIED",
      "INDUSTRIAL_BINDING_POLICY_UNVERIFIED",
      "RUNTIME_ADMISSION_UNAVAILABLE",
      "INDUSTRIAL_READ_POLICY_UNAVAILABLE",
    ]);
    expect(JSON.stringify(issues)).not.toContain("water.level");
  });

  it("未知类型只在真实绑定时单列阻塞，未绑定的历史占位不得凭空推断来源", async () => {
    const makeUnknown = (document: ScadaDocument) => {
      document.tags = document.tags.map((tag) =>
        tag.tagId === "water.level" ? { ...tag, dataType: "unknown" as const } : tag,
      );
    };
    const bound = await snapshotOf(makeUnknown);
    expect(assessProjectReleaseSafety(bound, CONTEXT).map((issue) => issue.code)).toEqual([
      "RUNTIME_COMPATIBILITY_UNVERIFIED",
      "TAG_SOURCE_UNVERIFIED",
      "TAG_BINDING_SOURCE_UNVERIFIED",
      "TAG_BOUND_TYPE_UNRESOLVED",
      "INDUSTRIAL_BINDING_POLICY_UNVERIFIED",
      "RUNTIME_ADMISSION_UNAVAILABLE",
      "INDUSTRIAL_READ_POLICY_UNAVAILABLE",
    ]);
    const unbound = await snapshotOf((document) => {
      makeUnknown(document);
      for (const page of document.pages) {
        for (const node of page.nodes) node.bindings = {};
      }
    });
    expect(assessProjectReleaseSafety(unbound, CONTEXT).map((issue) => issue.code)).toEqual([
      "TAG_SOURCE_UNVERIFIED",
      "RUNTIME_ADMISSION_UNAVAILABLE",
      "INDUSTRIAL_READ_POLICY_UNAVAILABLE",
    ]);
  });

  it("Tag 名称或描述伪造可信来源不能放行，也不能写入内部诊断", async () => {
    const sensitive = "opc.tcp://private-test-device:4840/token=forbidden";
    const snapshot = await snapshotOf((document) => {
      document.tags = document.tags.map((tag) => ({
        ...tag,
        displayName: "已审核的真实工业采集",
        description: sensitive,
      }));
    });
    const before = JSON.stringify(snapshot);
    const issues = assessProjectReleaseSafety(snapshot, CONTEXT);
    expect(issues).toContainEqual({
      code: "TAG_BINDING_SOURCE_UNVERIFIED",
      path: "snapshot.document.pages",
    });
    expect(issues).toContainEqual({
      code: "TAG_SOURCE_UNVERIFIED",
      path: "snapshot.document.tags",
    });
    expect(JSON.stringify(issues)).not.toContain(sensitive);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("隐藏图元携带未审查规则时同时形成 Runtime 与工业策略阻塞且只回传固定路径", async () => {
    const sensitive = "modbus://test-device/register/7";
    const snapshot = await snapshotOf((document) => {
      const hidden = document.pages[0]!.nodes[1]!;
      hidden.props.__scadaStudio = { visible: false };
      hidden.rules = [{ action: "write", target: sensitive }];
    });
    const before = JSON.stringify(snapshot);
    const blocks = assessProjectReleaseSafety(snapshot, CONTEXT);
    expect(blocks).toContainEqual({
      code: "RUNTIME_COMPATIBILITY_UNVERIFIED",
      path: "snapshot.document",
    });
    expect(blocks).toContainEqual({
      code: "INDUSTRIAL_RULES_UNREVIEWED",
      path: "snapshot.document.pages",
    });
    expect(blocks).toContainEqual({
      code: "INDUSTRIAL_BINDING_POLICY_UNVERIFIED",
      path: "snapshot.document.pages",
    });
    expect(JSON.stringify(blocks)).not.toContain(sensitive);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("纯静态页面不因缺少规则和绑定就获得工业只读策略的隐式许可", async () => {
    const snapshot = await snapshotOf((document) => {
      document.tags = [];
      for (const page of document.pages) {
        for (const node of page.nodes) {
          node.bindings = {};
          node.rules = [];
        }
      }
      document.pages[0]!.nodes[0]!.props.text = "禁止工业设备写入";
    });
    expect(assessProjectReleaseSafety(snapshot, CONTEXT)).toEqual([
      { code: "RUNTIME_ADMISSION_UNAVAILABLE", path: "runtime" },
      { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE", path: "industrial" },
    ]);
  });

  it("非首屏图元规则仍必须被工业只读审查发现而不推断任何执行语义", async () => {
    const snapshot = await snapshotOf((document) => {
      document.tags = [];
      for (const page of document.pages) {
        for (const node of page.nodes) node.bindings = {};
      }
      document.pages.push({
        id: "secondary",
        name: "维护页面",
        size: { width: 880, height: 460 },
        nodes: [
          {
            id: "secondary-label",
            type: "label",
            symbolVersion: "1",
            transform: { x: 10, y: 10, width: 100, height: 20, rotation: 0 },
            props: { text: "只读" },
            bindings: {},
            rules: [{ futureOperation: "unknown" }],
          },
        ],
      });
    });
    const blocks = assessProjectReleaseSafety(snapshot, CONTEXT);
    expect(blocks.map((block) => block.code)).toEqual([
      "RUNTIME_COMPATIBILITY_UNVERIFIED",
      "INDUSTRIAL_RULES_UNREVIEWED",
      "RUNTIME_ADMISSION_UNAVAILABLE",
      "INDUSTRIAL_READ_POLICY_UNAVAILABLE",
    ]);
  });

  it("破损 Tag 目录使评估失败时仍返回固定拒绝且不调用数据库", async () => {
    const snapshot = await snapshotOf();
    const invalid = {
      ...snapshot,
      document: { ...snapshot.document, tags: null },
    } as unknown as ProjectSnapshot;
    const query = vi.fn<() => Promise<unknown[]>>();
    const transaction = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const gate = new ProjectReleaseSafetyGate();

    await expect(gate.assertReady(transaction, invalid, CONTEXT)).rejects.toMatchObject({
      name: "ProjectReleaseGateUnavailableError",
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
      blocks: [{ code: "SAFETY_ASSESSMENT_UNAVAILABLE", path: "assessment" }],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("评估抛出的原始敏感错误不得进入正式发布诊断", async () => {
    const snapshot = await snapshotOf();
    const sensitive = "测试用不可信设备凭据内容";
    const document = { ...snapshot.document };
    Object.defineProperty(document, "tags", {
      enumerable: true,
      get() {
        throw new TypeError("工程数据读取异常：" + sensitive);
      },
    });
    const invalid = { ...snapshot, document } as unknown as ProjectSnapshot;
    const gate = new ProjectReleaseSafetyGate();
    const transaction = {} as Prisma.TransactionClient;

    const failure = await gate.assertReady(transaction, invalid, CONTEXT).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ProjectReleaseGateUnavailableError);
    expect(failure).toMatchObject({
      name: "ProjectReleaseGateUnavailableError",
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
      blocks: [{ code: "SAFETY_ASSESSMENT_UNAVAILABLE", path: "assessment" }],
    });
    expect(JSON.stringify(failure)).not.toContain(sensitive);
  });

  it("生产门禁对所有工程抛出原有安全拒绝，且不触发任何数据库操作", async () => {
    const snapshot = await snapshotOf();
    const query = vi.fn<() => Promise<unknown[]>>();
    const transaction = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const gate = new ProjectReleaseSafetyGate();
    await expect(gate.assertReady(transaction, snapshot, CONTEXT)).rejects.toMatchObject({
      name: "ProjectReleaseGateUnavailableError",
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
      blocks: [
        { code: "TAG_SOURCE_UNVERIFIED" },
        { code: "TAG_BINDING_SOURCE_UNVERIFIED" },
        { code: "INDUSTRIAL_BINDING_POLICY_UNVERIFIED" },
        { code: "RUNTIME_ADMISSION_UNAVAILABLE" },
        { code: "INDUSTRIAL_READ_POLICY_UNAVAILABLE" },
      ],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("错误仅包含固定阻塞代码和路径，不透露主体或工程敏感内容", async () => {
    const snapshot = await snapshotOf();
    const blockers = assessProjectReleaseSafety(snapshot, CONTEXT);
    const failure = new ProjectReleaseGateUnavailableError(blockers);
    expect(failure).toBeInstanceOf(ProjectReleaseGateUnavailableError);
    expect(failure.message).not.toContain(CONTEXT.actorId);
    expect(failure.message).not.toContain(CONTEXT.projectId);
    expect(failure.blocks.every((block) => Object.isFrozen(block))).toBe(true);
    expect(Object.isFrozen(failure.blocks)).toBe(true);
    expect(
      failure.blocks.some((block) => block.code === "INDUSTRIAL_READ_POLICY_UNAVAILABLE"),
    ).toBe(true);
  });
});
