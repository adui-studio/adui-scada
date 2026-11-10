import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
const catalog = new Set([...yaml.matchAll(/^  ["']?(@?[\w/.-]+)["']?: /gm)].map((m) => m[1]));
const manifests = ["package.json"];
for (const group of ["apps", "packages", "tools"]) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory() && existsSync(join(dir, item.name, "package.json")))
      manifests.push(group + "/" + item.name + "/package.json");
  }
}
const errors = [];
for (const path of manifests) {
  const json = JSON.parse(readFileSync(join(root, path), "utf8"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, value] of Object.entries(json[field] ?? {})) {
      if (value === "catalog:" && !catalog.has(name))
        errors.push(path + ": 缺少 Catalog 依赖 " + name);
      else if (
        typeof value !== "string" ||
        (!value.startsWith("workspace:") && value !== "catalog:")
      )
        errors.push(path + ": 依赖必须使用 catalog: 或 workspace: " + name);
    }
  }
}
if (!yaml.includes('typescript: "6.0.3"')) errors.push("TypeScript 6.0.3 未锁定版本");
if (!yaml.includes('vitest: "5.1.0"')) errors.push("Vitest 5.1.0 未锁定版本");
for (const f of ["react", "vue"])
  if (!existsSync(join(root, "apps", "web-" + f, "package.json")))
    errors.push("缺少 Web 应用 web-" + f);
if (errors.length) {
  for (const err of errors) console.error(err);
  process.exitCode = 1;
} else
  console.log(
    "依赖目录检查通过：共 " + manifests.length + " 个清单，" + catalog.size + " 项 Catalog 依赖",
  );
