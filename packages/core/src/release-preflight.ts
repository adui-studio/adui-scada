import { validateProjectDocument } from "./project-snapshot.ts";
import type { ProjectValidationIssue } from "./project-snapshot.ts";

/**
 * 当前 SVG 运行时实际消费的图元绑定槽。发布预检只报告静态兼容性，
 * 不能代替服务端授权、数据源配置、发布事务或运行时安全验收。
 */
const SVG_RUNTIME_BINDINGS: ReadonlyMap<string, readonly string[]> = new Map([
  ["tank", ["level"]],
  ["pump", ["running"]],
  ["pipe", []],
  ["label", ["value"]],
]);

/** 仅接受 SVG 渲染器真正消费的属性及 Studio 编辑状态。 */
const SVG_RUNTIME_PROPS: ReadonlyMap<string, readonly string[]> = new Map([
  ["tank", ["__scadaStudio"]],
  ["pump", ["__scadaStudio"]],
  ["pipe", ["__scadaStudio"]],
  ["label", ["__scadaStudio", "text", "unit"]],
]);

export type ProjectReleasePreflightIssue =
  | ProjectValidationIssue
  | {
      readonly code:
        | "UNSUPPORTED_SYMBOL"
        | "UNSUPPORTED_SYMBOL_VERSION"
        | "UNSUPPORTED_BINDING_SLOT"
        | "UNSUPPORTED_SYMBOL_PROP"
        | "UNRESOLVED_BOUND_TAG"
        | "UNSUPPORTED_RULES";
      readonly severity: "error";
      readonly path: string;
      readonly message: string;
    };

export type ProjectReleasePreflightResult =
  | { readonly passed: true; readonly issues: readonly [] }
  | { readonly passed: false; readonly issues: readonly ProjectReleasePreflightIssue[] };

/**
 * 对 Schema 有效的工程做只读 SVG 运行能力预检，不创建快照或发布版本。
 * 检测所有页面的图元（包括隐藏图元），防止未实现的内容在运行时被静默忽略。
 */
export function validateProjectReleasePreflight(input: unknown): ProjectReleasePreflightResult {
  const checked = validateProjectDocument(input);
  if (!checked.valid) return { passed: false, issues: checked.issues };

  const tags = new Map(checked.document.tags.map((tag) => [tag.tagId, tag]));
  const issues: ProjectReleasePreflightIssue[] = [];

  for (const [pageIndex, page] of checked.document.pages.entries()) {
    for (const [nodeIndex, node] of page.nodes.entries()) {
      const path = `pages[${pageIndex}].nodes[${nodeIndex}]`;
      const slots = SVG_RUNTIME_BINDINGS.get(node.type);

      if (slots === undefined) {
        issues.push({
          code: "UNSUPPORTED_SYMBOL",
          severity: "error",
          path: `${path}.type`,
          message: "当前 SVG 运行时不支持此图元类型",
        });
      } else if (node.symbolVersion !== "1") {
        issues.push({
          code: "UNSUPPORTED_SYMBOL_VERSION",
          severity: "error",
          path: `${path}.symbolVersion`,
          message: "当前 SVG 运行时不支持此图元版本",
        });
      }

      const allowedProps = SVG_RUNTIME_PROPS.get(node.type);
      if (allowedProps !== undefined) {
        for (const prop of Object.keys(node.props)) {
          if (!allowedProps.includes(prop)) {
            issues.push({
              code: "UNSUPPORTED_SYMBOL_PROP",
              severity: "error",
              path: `${path}.props.${prop}`,
              message: "当前 SVG 运行时不处理此图元属性",
            });
          }
        }
      }

      if (node.rules.length > 0) {
        issues.push({
          code: "UNSUPPORTED_RULES",
          severity: "error",
          path: `${path}.rules`,
          message: "当前 SVG 运行时尚未执行图元规则",
        });
      }

      for (const [slot, binding] of Object.entries(node.bindings)) {
        if (slots !== undefined && !slots.includes(slot)) {
          issues.push({
            code: "UNSUPPORTED_BINDING_SLOT",
            severity: "error",
            path: `${path}.bindings.${slot}`,
            message: "当前 SVG 运行时不处理此图元的绑定槽",
          });
        }
        if (tags.get(binding.tagId)?.dataType === "unknown") {
          issues.push({
            code: "UNRESOLVED_BOUND_TAG",
            severity: "error",
            path: `${path}.bindings.${slot}.tagId`,
            message: "已绑定 Tag 的数据类型尚未确认",
          });
        }
      }
    }
  }

  return issues.length === 0 ? { passed: true, issues: [] } : { passed: false, issues };
}
