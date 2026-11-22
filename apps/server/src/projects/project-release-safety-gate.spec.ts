import { describe, expect, it, vi } from "vite-plus/test";
import { createProjectSnapshot, waterTreatmentDemoDocument } from "@adui/scada-core";
import type { ScadaDocument } from "@adui/scada-core";
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

  it("生产门禁对所有工程抛出原有安全拒绝，且不触发任何数据库操作", async () => {
    const snapshot = await snapshotOf();
    const query = vi.fn();
    const transaction = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const gate = new ProjectReleaseSafetyGate();
    await expect(gate.assertReady(transaction, snapshot, CONTEXT)).rejects.toMatchObject({
      name: "ProjectReleaseGateUnavailableError",
      message: "正式发布安全门禁尚未完成，当前请求已被安全拒绝",
      blocks: [
        { code: "TAG_SOURCE_UNVERIFIED" },
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
    expect(failure.blocks.some((block) => block.code === "INDUSTRIAL_READ_POLICY_UNAVAILABLE")).toBe(
      true,
    );
  });
});
