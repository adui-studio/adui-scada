import type { ProjectSnapshot } from "@adui/scada-core";
import { ScadaApiError } from "./index.ts";
import type { ScadaApiClient, ScadaReleasePreflightReport } from "./index.ts";

export interface StudioServerReleasePreflight {
  readonly snapshot: ProjectSnapshot;
  readonly report: ScadaReleasePreflightReport;
}

/**
 * 只读核对已保存的当前版本：先取水位和完整快照，再取服务端预检，
 * 最后重新读取水位。不会改变 Studio 的 CAS 基线、画布或 IndexedDB 草稿。
 */
export async function readCurrentServerReleasePreflight(
  api: Pick<ScadaApiClient, "getProject" | "readVersion" | "preflightRelease">,
  projectId: string,
): Promise<StudioServerReleasePreflight> {
  const current = await api.getProject(projectId);
  const revision = current.headRevision;
  const snapshot = await api.readVersion(projectId, revision);
  if (snapshot.projectId !== projectId || snapshot.revision !== revision) {
    throw new ScadaApiError("服务端快照与预检工程或修订号不一致", "invalid_response");
  }
  const report = await api.preflightRelease(projectId, revision);
  if (report.contentHash !== snapshot.contentHash) {
    throw new ScadaApiError("服务端预检报告与已保存快照摘要不一致", "invalid_response");
  }
  const latest = await api.getProject(projectId);
  if (latest.headRevision !== revision) {
    throw new ScadaApiError("预检期间服务端版本已变化，请重新读取", "conflict", 409);
  }
  return { snapshot, report };
}
