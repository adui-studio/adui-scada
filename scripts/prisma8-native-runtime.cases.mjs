import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createReviewHost,
  requireDeclarationHashes,
  reviewRuntimeRelations,
  reviewFreshRuntimeRelations,
} from "./prisma8-native-runtime-review.mjs";

function fixture() {
  const formal = {
    storage: {
      storageHash: "054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424",
    },
    execution: {
      executionHash: "a4d7e4794290fb3681a486309f2b191b6a804c75c010f175cdf453bcfc66df79",
    },
    profileHash: "3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2",
    roots: {},
    domain: {
      namespaces: {
        public: {
          models: {
            ScadaProjectReleaseState: {
              relations: {
                lastReleaseEvent: {
                  cardinality: "N:1",
                  nullable: true,
                  on: { localFields: ["lastReleaseEventId"], targetFields: ["eventId"] },
                  to: { model: "ScadaProjectReleaseEvent", namespace: "public" },
                },
              },
            },
            ScadaProjectReleaseEvent: {
              relations: {
                currentReleaseState: {
                  cardinality: "1:1",
                  nullable: true,
                  on: { localFields: ["eventId"], targetFields: ["lastReleaseEventId"] },
                  to: { model: "ScadaProjectReleaseState", namespace: "public" },
                },
              },
            },
          },
        },
      },
    },
  };
  const native = structuredClone(formal);
  native.storage.storageHash = "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc";
  const models = native.domain.namespaces.public.models;
  models.ScadaProjectReleaseState.relations.lastReleaseEvent.on = {
    localFields: [
      "tenantId",
      "projectId",
      "releaseGeneration",
      "releasedRevision",
      "releasedContentHash",
      "lastReleaseEventId",
    ],
    targetFields: ["tenantId", "projectId", "generation", "toRevision", "toContentHash", "eventId"],
  };
  models.ScadaProjectReleaseEvent.relations = {};
  return { formal, native };
}

void describe("原生候选离线运行时兼容评审", () => {
  void it("只接受已评审的六字段和反向导航差异且保持阻塞", () => {
    const { formal, native } = fixture();
    const before = structuredClone(formal);
    assert.equal(reviewRuntimeRelations(formal, native), "STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED");
    assert.deepEqual(formal, before);
  });

  void it("全新存储标识独立核验且历史候选门禁保持不变", () => {
    const { formal, native } = fixture();
    assert.throws(() => reviewFreshRuntimeRelations(formal, native), /哈希标识/u);
    native.storage.storageHash =
      "9ab29293ba3d8ce61b05d057a1bfe85acd0b730793971d16dfaa199d4a514436";
    assert.equal(reviewFreshRuntimeRelations(formal, native), "FRESH_RUNTIME_RELATIONS_REVIEWED");
    assert.throws(() => reviewRuntimeRelations(formal, native), /哈希标识/u);
    native.domain.namespaces.public.models.ScadaProjectReleaseState.relations.lastReleaseEvent.on.localFields.reverse();
    assert.throws(() => reviewFreshRuntimeRelations(formal, native), /未评审的运行时差异/u);
  });

  void it("拒绝候选哈希变化", () => {
    const { formal, native } = fixture();
    native.storage.storageHash = formal.storage.storageHash;
    assert.throws(() => reviewRuntimeRelations(formal, native), /哈希标识/);
  });

  void it("拒绝六字段关联缺列或次序改变", () => {
    const { formal, native } = fixture();
    const models = native.domain.namespaces.public.models;
    models.ScadaProjectReleaseState.relations.lastReleaseEvent.on.localFields.reverse();
    assert.throws(() => reviewRuntimeRelations(formal, native), /未评审的运行时差异/);
  });

  void it("拒绝恢复反向导航或新增根模型等未审查差异", () => {
    const { formal, native } = fixture();
    native.domain.namespaces.public.models.ScadaProjectReleaseEvent.relations = structuredClone(
      formal.domain.namespaces.public.models.ScadaProjectReleaseEvent.relations,
    );
    assert.throws(() => reviewRuntimeRelations(formal, native), /未评审的运行时差异/);
    const second = fixture();
    second.native.roots = { extra: true };
    assert.throws(() => reviewRuntimeRelations(second.formal, second.native), /未评审的运行时差异/);
  });

  void it("拒绝混用其他生成轮次的声明", () => {
    const { formal, native } = fixture();
    const declaration = [
      `StorageHashBase<'${formal.storage.storageHash}'>`,
      `ExecutionHashBase<'${formal.execution.executionHash}'>`,
      `ProfileHashBase<'${formal.profileHash}'>`,
    ].join("\n");
    requireDeclarationHashes(declaration, formal);
    assert.throws(() => requireDeclarationHashes(declaration, native), /声明与 JSON/);
  });

  void it("真实编译器读取虚拟声明和 JSON 且不修改磁盘生成物", () => {
    const ts = createRequire(join(import.meta.dirname, "..", "apps", "server", "package.json"))(
      "typescript",
    );
    const directory = mkdtempSync(join(tmpdir(), "scada-native-runtime-"));
    try {
      const declaration = join(directory, "contract.d.ts");
      const json = join(directory, "contract.json");
      const consumer = join(directory, "consumer.ts");
      writeFileSync(join(directory, "package.json"), '{"type":"module"}');
      writeFileSync(declaration, "export type Contract = string;\n");
      writeFileSync(json, '{"value":"正式"}');
      writeFileSync(
        consumer,
        'import type { Contract } from "./contract.d.js";\n' +
          'import data from "./contract.json" with { type: "json" };\n' +
          "export const value: Contract = data.value;\n",
      );
      const options = {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        resolveJsonModule: true,
        noEmit: true,
        strict: true,
        types: [],
      };
      const changed = "export type Contract = number;\n";
      const host = createReviewHost(ts, options, [
        [declaration, changed],
        [json, '{"value":42}'],
      ]);
      const program = ts.createProgram({ rootNames: [consumer], options, host });
      assert.equal(program.getSourceFile(declaration)?.text, changed);
      assert.equal(program.getSourceFile(json)?.text, '{"value":42}');
      assert.equal(ts.getPreEmitDiagnostics(program).length, 0);
      const mismatched = createReviewHost(ts, options, [[declaration, changed]]);
      const mismatchedProgram = ts.createProgram({
        rootNames: [consumer],
        options,
        host: mismatched,
      });
      assert.ok(
        ts.getPreEmitDiagnostics(mismatchedProgram).some((diagnostic) => diagnostic.code === 2322),
      );
      assert.equal(readFileSync(declaration, "utf8"), "export type Contract = string;\n");
      assert.equal(readFileSync(json, "utf8"), '{"value":"正式"}');
      assert.throws(() => host.writeFile(), /禁止写入/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
