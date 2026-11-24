import { describe, expect, it } from "vite-plus/test";
import { requirePrisma8ReadOnlyTestUrl } from "./prisma8-readonly-target.js";

const local = "postgresql://test_user:test_password@127.0.0.1:15432/adui_scada_test";

describe("Prisma 8 只读探针连接边界", () => {
  it("接受明确的本机测试库并移除 Prisma 专用参数", () => {
    expect(requirePrisma8ReadOnlyTestUrl(local)).toBe(local);
    expect(requirePrisma8ReadOnlyTestUrl(local + "?schema=public")).toBe(local);
    expect(requirePrisma8ReadOnlyTestUrl(local.replace("127.0.0.1", "localhost"))).toBe(
      local.replace("127.0.0.1", "localhost"),
    );
    expect(requirePrisma8ReadOnlyTestUrl(local.replace("postgresql:", "postgres:"))).toBe(
      local.replace("postgresql:", "postgres:"),
    );
  });

  it.each([
    undefined,
    "",
    "不是数据库地址",
    " " + local,
    local + "\n",
    local.replace("127.0.0.1", "192.0.2.1"),
    local.replace("15432", "5432"),
    local.replace(":15432", ""),
    local.replace("adui_scada_test", "adui_scada"),
    local.replace("adui_scada_test", "postgres"),
    local.replace("postgresql:", "https:"),
    local.replace("test_user:test_password@", ""),
    local + "?schema=private",
    local + "?schema=public&schema=public",
    local + "?options=-c%20default_transaction_read_only%3Doff",
    local + "?host=192.0.2.1",
    local + "#fragment",
  ])("拒绝不符合隔离条件的连接地址", (input) => {
    expect(() => requirePrisma8ReadOnlyTestUrl(input)).toThrow(
      "Prisma 8 只读探针仅允许连接本机 15432 端口的 adui_scada_test 数据库",
    );
  });
});
