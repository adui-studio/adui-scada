import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { freshStorageHash } from "./prisma8-fresh-install.mjs";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
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

/** 使用实际全新契约对现有服务端及候选仓储作内存类型检查，不替换 Git 生成物。 */
export function reviewFreshRuntimeTypes(root, nativeText, nativeDeclaration) {
  const server = join(root, "apps", "server");
  const formalDir = join(server, "src", "generated", "prisma8-runtime");
  const declarationPath = join(formalDir, "contract.d.ts");
  const jsonPath = join(formalDir, "contract.json");
  const formalText = readFileSync(jsonPath, "utf8");
  const formalDeclaration = readFileSync(declarationPath, "utf8");
  const formal = JSON.parse(formalText);
  const native = JSON.parse(nativeText);
  requireCondition(formal.storage.storageHash === freshStorageHash && isDeepStrictEqual(formal, native), "当前生成契约与全新原生契约不一致");
  requireDeclarationHashes(formalDeclaration, formal);
  requireDeclarationHashes(nativeDeclaration, native);
  const ts = createRequire(join(server, "package.json"))("typescript");
  const configPath = join(server, "tsconfig.json");
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  requireCondition(!raw.error, "无法读取服务端 TypeScript 配置");
  const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, server);
  requireCondition(config.errors.length === 0, "服务端 TypeScript 配置存在错误");
  checkProgram(ts, config, [
    [declarationPath, formalDeclaration],
    [jsonPath, formalText],
  ]);
  checkProgram(ts, config, [
    [declarationPath, nativeDeclaration],
    [jsonPath, nativeText],
  ]);
  requireCondition(
    readFileSync(declarationPath, "utf8") === formalDeclaration &&
      readFileSync(jsonPath, "utf8") === formalText,
    "离线运行时评审期间当前运行时生成物发生变化",
  );
}

