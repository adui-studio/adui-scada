import { randomUUID } from "node:crypto";

export class FreshRuntimeProbeError extends Error {}

/** 只读探针复用一个已核验连接；成功和失败均关闭运行时及调用方连接。 */
export async function probeFreshRuntime(client, createRuntime, verifyBoundary) {
  let stage = "连接初始化";
  let db;
  let failure;
  try {
    await client.connect();
    stage = "运行时连接身份与只读边界核验";
    await verifyBoundary(client);
    stage = "原生运行时初始化";
    db = createRuntime(client);
    const scope = "prisma8-fresh-" + randomUUID();
    stage = "不存在工程联合过滤核验";
    const missing = await db.orm.public.ScadaProject.where({
      tenantId: scope,
      projectId: scope,
    })
      .select("tenantId", "projectId", "headRevision")
      .first();
    if (missing !== null) throw new Error("不存在工程查询必须返回空结果");
    stage = "运行时连接边界复核";
    await verifyBoundary(client);
  } catch {
    failure = new FreshRuntimeProbeError("Prisma 8 全新运行时只读探针失败：" + stage);
  }
  if (db) {
    try {
      await db.close();
    } catch {
      failure ??= new FreshRuntimeProbeError("关闭 Prisma 8 全新运行时失败");
    }
  }
  try {
    await client.end();
  } catch {
    failure ??= new FreshRuntimeProbeError("关闭 Prisma 8 全新运行时连接失败");
  }
  if (failure) throw failure;
  return { missingScopeVerified: true, readOnlyBoundaryVerified: true };
}
