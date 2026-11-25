import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const formalHash = "054113c40b1e6f3b7609641e09868e45c0e969d8035e6e1376d10ac3e5148424";
const nativeHash = "6eec3e7459bdfa2646dc156bd6eaf22ffe60b0a0eac309622262b9742a0c68cc";
const executionHash = "a4d7e4794290fb3681a486309f2b191b6a804c75c010f175cdf453bcfc66df79";
const profileHash = "3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** 核对已验收候选的标识和关系差异，不替代物理结构复验或签名授权。 */
export function reviewRuntimeRelations(formal, native) {
  for (const [contract, hash] of [
    [formal, formalHash],
    [native, nativeHash],
  ]) {
    requireCondition(
      contract?.storage?.storageHash === hash &&
        contract.execution?.executionHash === executionHash &&
        contract.profileHash === profileHash,
      "契约哈希标识与已验收版本不一致",
    );
  }
  const expected = structuredClone(formal.domain);
  const models = expected.namespaces.public.models;
  const forward = models.ScadaProjectReleaseState.relations.lastReleaseEvent;
  const reverse = models.ScadaProjectReleaseEvent.relations.currentReleaseState;
  requireCondition(
    isDeepStrictEqual(forward, {
      cardinality: "N:1",
      nullable: true,
      on: { localFields: ["lastReleaseEventId"], targetFields: ["eventId"] },
      to: { model: "ScadaProjectReleaseEvent", namespace: "public" },
    }) &&
      isDeepStrictEqual(reverse, {
        cardinality: "1:1",
        nullable: true,
        on: { localFields: ["eventId"], targetFields: ["lastReleaseEventId"] },
        to: { model: "ScadaProjectReleaseState", namespace: "public" },
      }),
    "正式契约关系与已验收基线不一致",
  );
  forward.on.localFields = [
    "tenantId",
    "projectId",
    "releaseGeneration",
    "releasedRevision",
    "releasedContentHash",
    "lastReleaseEventId",
  ];
  forward.on.targetFields = [
    "tenantId",
    "projectId",
    "generation",
    "toRevision",
    "toContentHash",
    "eventId",
  ];
  delete models.ScadaProjectReleaseEvent.relations.currentReleaseState;
  requireCondition(
    isDeepStrictEqual(native.domain, expected) &&
      isDeepStrictEqual(native.roots, formal.roots) &&
      isDeepStrictEqual(native.execution, formal.execution),
    "原生候选存在未评审的运行时差异",
  );
  return "STORAGE_REVIEW_REQUIRED_RUNTIME_BLOCKED";
}

/** 检查声明中的契约标识，避免误用另一轮生成物。 */
export function requireDeclarationHashes(declaration, contract) {
  for (const [type, hash] of [
    ["StorageHashBase", contract.storage.storageHash],
    ["ExecutionHashBase", contract.execution.executionHash],
    ["ProfileHashBase", contract.profileHash],
  ]) {
    requireCondition(declaration.includes(`${type}<'${hash}'>`), "契约声明与 JSON 哈希标识不一致");
  }
}

/** 在编译器内存中替换两个生成物，保留原路径的依赖解析，不修改任何文件。 */
export function createReviewHost(ts, options, replacements) {
  const base = ts.createCompilerHost(options);
  const canonical = (fileName) => base.getCanonicalFileName(resolve(fileName));
  const files = new Map(replacements.map(([fileName, content]) => [canonical(fileName), content]));
  return {
    ...base,
    readFile: (fileName) => files.get(canonical(fileName)) ?? base.readFile(fileName),
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const content = files.get(canonical(fileName));
      return content === undefined
        ? base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, content, languageVersion);
    },
    writeFile() {
      throw new Error("离线类型检查禁止写入文件");
    },
  };
}

function checkProgram(ts, config, replacements) {
  const options = { ...config.options, noEmit: true, incremental: false };
  const host = createReviewHost(ts, options, replacements);
  const program = ts.createProgram({ rootNames: config.fileNames, options, host });
  for (const [fileName, content] of replacements) {
    requireCondition(
      program.getSourceFile(fileName)?.text === content,
      "编译器未实际载入指定契约生成物",
    );
  }
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
    throw new Error("服务端离线类型检查失败");
  }
}

function main() {
  requireCondition(process.argv.length === 2, "离线类型评审不接受额外参数");
  const root = resolve(import.meta.dirname, "..");
  const server = join(root, "apps", "server");
  const formalDir = join(server, "src", "generated", "prisma8");
  const nativeDir = join(root, ".artifacts", "prisma8-native");
  const declarationPath = join(formalDir, "contract.d.ts");
  const jsonPath = join(formalDir, "contract.json");
  const formalText = readFileSync(jsonPath, "utf8");
  const nativeText = readFileSync(join(nativeDir, "contract.json"), "utf8");
  const formalDeclaration = readFileSync(declarationPath, "utf8");
  const nativeDeclaration = readFileSync(join(nativeDir, "contract.d.ts"), "utf8");
  const formal = JSON.parse(formalText);
  const native = JSON.parse(nativeText);
  const status = reviewRuntimeRelations(formal, native);
  requireDeclarationHashes(formalDeclaration, formal);
  requireDeclarationHashes(nativeDeclaration, native);

  const ts = createRequire(join(server, "package.json"))("typescript");
  const configPath = join(server, "tsconfig.json");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  requireCondition(!raw.error, "无法读取服务端 TypeScript 配置");
  const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, server);
  requireCondition(config.errors.length === 0, "服务端 TypeScript 配置存在错误");
  const resolution = ts.resolveModuleName(
    "@prisma/orm-postgres/contract-types",
    declarationPath,
    config.options,
    ts.sys,
    undefined,
    undefined,
    ts.ModuleKind.ESNext,
  );
  requireCondition(resolution.resolvedModule, "服务端无法解析 Prisma 8 契约类型依赖");
  checkProgram(ts, config, [
    [declarationPath, formalDeclaration],
    [jsonPath, formalText],
  ]);
  console.log("正式契约：服务端离线类型检查通过");
  checkProgram(ts, config, [
    [declarationPath, nativeDeclaration],
    [jsonPath, nativeText],
  ]);
  console.log("原生候选：服务端离线类型检查通过");
  console.log("关系差异：仅允许末次发布事件六字段关联及缺少反向导航");
  console.log("评审状态：", status);
  console.log("不允许签名、迁移或切换正式数据库提供方");
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "原生候选运行时评审失败");
    process.exitCode = 1;
  }
}
