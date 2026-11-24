import { describe, expect, it } from "vite-plus/test";
import { probePrisma8ReadOnly } from "../src/database/prisma8-readonly-probe.js";

describe("Prisma 8 PostgreSQL 只读运行时验收", () => {
  it("真实查询工程修订号并验证联合过滤及资源释放", async () => {
    const result = await probePrisma8ReadOnly(process.env.SCADA_TEST_DATABASE_URL);
    expect(result.missingScopeVerified).toBe(true);
    expect(["MATCHED", "EMPTY"]).toContain(result.sampleStatus);
    console.info(
      result.sampleStatus === "MATCHED"
        ? "Prisma 8 已有工程样本比对通过，租户与工程联合过滤通过"
        : "Prisma 8 不存在工程查询通过；隔离库为空，已有工程样本比对尚未执行",
    );
  });
});
