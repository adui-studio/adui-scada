import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const excluded = new Set(["node_modules", "dist", "target", "gen", ".git", ".agents", ".vite"]);
// Prisma Client 由第三方生成，不能将它的英文注释视为本项目自有文案。
const excludedPaths = new Set(["apps/server/src/generated/prisma"]);
const paths = [".env.example", ".editorconfig", ".gitattributes", ".gitignore", ".dockerignore"];
const extensions = /\.(?:ts|tsx|js|mjs|vue|css|rs|toml|yaml|yml|html)$/;

function collect(directory) {
  if (!existsSync(directory)) return;
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const full = join(directory, item.name);
    if (item.isDirectory()) {
      // 归一化路径分隔符，确保 Windows 与其他平台排除规则一致。
      if (excludedPaths.has(relative(root, full).replaceAll("\\", "/"))) continue;
      collect(full);
    } else if (
      item.isFile() &&
      (extensions.test(item.name) ||
        item.name.startsWith("Dockerfile.") ||
        item.name === "nginx.conf")
    ) {
      paths.push(relative(root, full));
    }
  }
}

for (const directory of ["apps", "packages", "examples", "scripts", "deploy"]) {
  collect(join(root, directory));
}
paths.push("vite.config.ts");

const chinese = /[\u3400-\u9fff]/u;
const failures = [];
let filesChecked = 0;

for (const path of paths) {
  if (path === "scripts/check-chinese-messages.mjs") continue;
  const lines = readFileSync(join(root, path), "utf8").split(/\r?\n/);
  filesChecked++;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    let kind = "";
    let text = "";

    // 仅检查自有文案，不检查接口标识、依赖、URL 和外部工具输出。
    if (trimmed.startsWith("///") || /^#\s*syntax=/.test(trimmed)) continue;
    // 被注释的环境变量赋值是可复制的技术配置，不是面向用户的自然语言注释。
    if (path === ".env.example" && /^#\s*[A-Z][A-Z0-9_]*=/.test(trimmed)) continue;
    // .gitattributes 的 "* text=..." 属于配置指令，不是 JSDoc 注释。
    if (path === ".gitattributes" && trimmed.startsWith("* text=")) continue;
    const comment = trimmed.match(/^(?:\/\/|\/\*+|\*\s+|#\s+)(.*)$/);
    if (comment && !comment[1].startsWith("@") && !comment[1].startsWith("!")) {
      kind = "注释";
      text = comment[1];
    }

    const title = trimmed.match(/\b(?:test|it|describe)\(\s*["']([^"']+)["']/);
    if (title) {
      kind = "测试名称";
      text = title[1];
    }

    const thrown = trimmed.match(/throw\s+new\s+\w+Error\s*\(\s*["'`]([^"'`]*)["'`]/);
    if (thrown) {
      kind = "异常提示";
      // 模板字符串中的变量引用不是人工编写的文案。
      text = thrown[1].replace(/\$\{[^}]*\}/g, "");
    }
    if (/\bconsole\.(?:log|warn|info|error)\(/.test(trimmed) && /["'`]/.test(trimmed)) {
      kind = "日志文案";
      text = trimmed;
    }

    if (kind && /[A-Za-z]/.test(text) && !chinese.test(text)) {
      failures.push(`${path}:${index + 1}：${kind}缺少中文：${text.slice(0, 100)}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(`中文文案检查失败：发现 ${failures.length} 处待处理内容。`);
  process.exitCode = 1;
} else {
  console.log(`中文文案检查通过：已检查 ${filesChecked} 个自有代码或配置文件。`);
}
