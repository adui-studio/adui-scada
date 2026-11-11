import { expect, test } from "vite-plus/test";
import { parseScadaDocument } from "../src/document.ts";
import { waterTreatmentDemoDocument } from "../src/demo-document.ts";
import { compareProjectDocuments } from "../src/project-version-compare.ts";

function fixture() {
  return parseScadaDocument(waterTreatmentDemoDocument);
}

test("相同工程内容比较显示一致并统计页面图元和 Tag 绑定", () => {
  const compared = compareProjectDocuments(fixture(), fixture());
  expect(compared.sameContent).toBe(true);
  expect(compared.current).toEqual({ pageCount: 1, nodeCount: 5, bindingCount: 3 });
  expect(compared.historical).toEqual(compared.current);
});

test("不同图元位置即使数量一致仍判定工程不同", () => {
  const current = fixture();
  const historical = fixture();
  current.pages[0]!.nodes[0]!.transform.x += 10;
  const compared = compareProjectDocuments(current, historical);
  expect(compared.sameContent).toBe(false);
  expect(compared.current).toEqual(compared.historical);
});

test("图元 props 对象键顺序改变不应显示虚假版本差异", () => {
  const current = fixture();
  const historical = fixture();
  current.pages[0]!.nodes[0]!.props = { text: "水处理", unit: "米" };
  historical.pages[0]!.nodes[0]!.props = { unit: "米", text: "水处理" };
  expect(compareProjectDocuments(current, historical).sameContent).toBe(true);
});

test("拒绝跨工程比较和不合法工程，且不修改传入工程", () => {
  const current = fixture();
  const historical = fixture();
  historical.projectId = "another-project";
  expect(() => compareProjectDocuments(current, historical)).toThrow(/同一个工程/);
  historical.projectId = current.projectId;
  historical.pages[0]!.nodes[0]!.transform.width = 0;
  expect(() => compareProjectDocuments(current, historical)).toThrow(/有限数值/);
  expect(current.pages[0]!.nodes[0]!.transform.width).toBeGreaterThan(0);
});
