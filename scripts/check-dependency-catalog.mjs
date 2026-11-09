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
        errors.push(path + ": missing catalog " + name);
      else if (
        typeof value !== "string" ||
        (!value.startsWith("workspace:") && value !== "catalog:")
      )
        errors.push(path + ": not catalog/workspace " + name);
    }
  }
}
if (!yaml.includes('typescript: "6.0.3"')) errors.push("TypeScript 6.0.3 is not pinned");
if (!yaml.includes('vitest: "5.1.0"')) errors.push("Vitest 5.1.0 not pinned");
for (const f of ["react", "vue"])
  if (!existsSync(join(root, "apps", "web-" + f, "package.json"))) errors.push("Missing web-" + f);
if (errors.length) {
  for (const err of errors) console.error(err);
  process.exitCode = 1;
} else
  console.log(
    "Catalog OK: " + manifests.length + " manifests, " + catalog.size + " catalog dependencies",
  );
