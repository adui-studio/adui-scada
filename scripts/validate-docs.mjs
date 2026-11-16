import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "README.md",
  "AGENTS.md",
  "docs/AI_MISTAKES.md",
  "docs/REQUIREMENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/SDD.md",
  "docs/PROJECT_CONTEXT.md",
  "docs/CODEBASE_MAP.md",
  "docs/SKILLS.md",
  "docs/HARNESS.md",
  "docs/VALIDATION.md",
  "docs/adr/0001-dual-framework-core.md",
  "docs/adr/0002-industrial-io-security.md",
  "skills-lock.json",
  "scripts/validate-docs.mjs",
];
const errors = [];
const abs = (p) => resolve(root, p);
for (const file of required) {
  if (!existsSync(abs(file))) errors.push("缺少必需文件：" + file);
}
function collect(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}
const markdown = [abs("README.md"), abs("AGENTS.md"), ...collect(abs("docs"))].filter(existsSync);
for (const file of markdown) {
  const content = readFileSync(file, "utf8");
  const re = /\[[^\]]+\]\(([^)\s]+)\)/g;
  for (const match of content.matchAll(re)) {
    const href = match[1];
    if (/^(https?:\/\/|mailto:|#)/i.test(href)) continue;
    const path = href.split("#")[0].split("?")[0];
    if (!path) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      errors.push("文档链接格式错误：" + relative(root, file) + " -> " + href);
      continue;
    }
    const target = resolve(dirname(file), decoded);
    if (target !== root && !target.startsWith(root + sep)) {
      errors.push("文档链接指向仓库目录之外：" + relative(root, file) + " -> " + href);
    } else if (!existsSync(target)) {
      errors.push("文档链接目标不存在：" + relative(root, file) + " -> " + href);
    }
  }
}
if (existsSync(abs("docs/REQUIREMENTS.md"))) {
  const content = readFileSync(abs("docs/REQUIREMENTS.md"), "utf8");
  const ids = [...content.matchAll(/^\|\s*((?:FR|NFR)-\d{3})\s*\|/gm)].map((m) => m[1]);
  const duplicated = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (duplicated.length) errors.push("需求编号重复：" + duplicated.join(", "));
  if (!ids.some((x) => x.startsWith("FR-"))) errors.push("未找到 FR 功能需求编号");
  if (!ids.some((x) => x.startsWith("NFR-"))) errors.push("未找到 NFR 非功能需求编号");
}
if (existsSync(abs("docs/adr"))) {
  for (const f of readdirSync(abs("docs/adr")).filter((n) => n.endsWith(".md"))) {
    const body = readFileSync(abs("docs/adr/" + f), "utf8");
    const id = f.match(/^(\d{4})-/)?.[1];
    if (!id || !body.includes("ADR-" + id)) errors.push("ADR 编号与文件名不一致：" + f);
    if (!/^- 状态：(Proposed|Accepted|Rejected|Superseded|Deprecated)$/m.test(body)) {
      errors.push("ADR 状态无效：" + f);
    }
  }
}
if (existsSync(abs("skills-lock.json"))) {
  try {
    const lock = JSON.parse(readFileSync(abs("skills-lock.json"), "utf8"));
    for (const name of Object.keys(lock.skills ?? {})) {
      if (!existsSync(abs(".agents/skills/" + name + "/SKILL.md"))) {
        errors.push("缺少 Skill 文件：" + name);
      }
    }
  } catch (error) {
    errors.push("skills-lock.json 内容无效：" + error.message);
  }
}
if (errors.length) {
  errors.forEach((message) => console.error("错误：", message));
  process.exitCode = 1;
} else {
  console.log("文档检查通过：共 " + markdown.length + " 个 Markdown 文件。");
  console.log("本次仅执行静态文档检查，不代表构建、运行、业务语义或工业安全验证通过。");
}
