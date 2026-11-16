import { parseScadaDocument } from "@adui/scada-core";
import type { ProjectSnapshot, ScadaDocument } from "@adui/scada-core";
import { ScadaApiError } from "./index.ts";
import type { ScadaApiClient, ScadaPrincipal } from "./index.ts";

export interface ServerProjectSaveResult {
  readonly projectId: string;
  readonly revision: number;
  readonly created: boolean;
}

export interface ServerProjectVersion {
  readonly snapshot: ProjectSnapshot;
  readonly headRevision: number;
  readonly principal: ScadaPrincipal;
}

/**
 * Studio 的服务端保存基线只存在于当前会话内。
 * 不能把本地草稿修订号或刚查询的服务端水位当作已经载入的保存基线。
 */
export class StudioServerProjectSession {
  private baseline: {
    projectId: string;
    revision: number;
    principal: ScadaPrincipal;
  } | null = null;
  private saving = false;

  private readonly api: ScadaApiClient;

  constructor(api: ScadaApiClient) {
    this.api = api;
  }

  /** JSON 导入、本地草稿恢复或本地历史载入后必须清除旧基线。 */
  reset(): void {
    this.baseline = null;
  }

  getBaselineRevision(projectId: string): number | null {
    return this.baseline?.projectId === projectId ? this.baseline.revision : null;
  }

  /** 先校验快照、身份和当前服务端水位，供 UI 在用户确认后载入。 */
  async readVersion(projectId: string, revision: number): Promise<ServerProjectVersion> {
    const identity = await this.api.getMe();
    const snapshot = await this.api.readVersion(projectId, revision);
    const current = await this.api.getProject(projectId);
    return { snapshot, headRevision: current.headRevision, principal: identity.principal };
  }

  /** 只有用户实际载入最新服务端版本，才建立后续 CAS 保存基线。 */
  acceptLoadedVersion(version: ServerProjectVersion): void {
    const { snapshot, headRevision, principal } = version;
    this.baseline =
      snapshot.revision === headRevision
        ? { projectId: snapshot.projectId, revision: snapshot.revision, principal }
        : null;
  }

  async saveDocument(document: ScadaDocument): Promise<ServerProjectSaveResult> {
    if (this.saving) {
      throw new ScadaApiError("服务端工程正在保存，请勿重复提交", "conflict", 409);
    }
    this.saving = true;
    try {
      // 获取独立副本，网络等待期间画布修改不能改变本次实际提交的文档。
      const checked = parseScadaDocument(document);
      const principal = (await this.api.getMe()).principal;
      let current;
      try {
        current = await this.api.getProject(checked.projectId);
      } catch (error) {
        if (!(error instanceof ScadaApiError) || error.kind !== "not_found") throw error;
        // 无权访问与不存在统一 404；创建仍需服务端独立鉴权和租户唯一约束。
        const created = await this.api.createProject(checked);
        this.baseline = {
          projectId: checked.projectId,
          revision: created.headRevision,
          principal,
        };
        return { projectId: checked.projectId, revision: created.headRevision, created: true };
      }

      const baseline = this.baseline;
      if (
        !baseline ||
        baseline.projectId !== checked.projectId ||
        baseline.principal.tenantId !== principal.tenantId ||
        baseline.principal.subjectId !== principal.subjectId
      ) {
        this.baseline = null;
        throw new ScadaApiError(
          "服务端已有工程，请先载入最新服务端版本再保存，避免覆盖他人的修改",
          "conflict",
          409,
        );
      }

      if (current.headRevision !== baseline.revision) {
        this.baseline = null;
        throw new ScadaApiError("服务端版本已变化，请重新查询并载入最新版本", "conflict", 409);
      }

      try {
        const saved = await this.api.appendVersion(
          checked.projectId,
          baseline.revision,
          checked,
        );
        this.baseline = { projectId: checked.projectId, revision: saved.revision, principal };
        return { projectId: checked.projectId, revision: saved.revision, created: false };
      } catch (error) {
        if (error instanceof ScadaApiError && error.kind === "conflict") {
          this.baseline = null;
        }
        throw error;
      }
    } finally {
      this.saving = false;
    }
  }
}

export function createStudioServerProjectSession(api: ScadaApiClient): StudioServerProjectSession {
  return new StudioServerProjectSession(api);
}
