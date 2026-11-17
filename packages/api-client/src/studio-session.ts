import { parseScadaDocument } from "@adui/scada-core";
import type { ProjectSnapshot, ScadaDocument } from "@adui/scada-core";
import { isScadaAccessRejection, ScadaApiError } from "./index.ts";
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
  private blockedCreateProjectId: string | null = null;
  private saving = false;
  private contextGeneration = 0;

  private readonly api: ScadaApiClient;

  constructor(api: ScadaApiClient) {
    this.api = api;
  }

  /** 避免上下文切换后迟到的读写结果修改新工程会话。 */
  private requireCurrentContext(generation: number, writeSent = false): void {
    if (generation !== this.contextGeneration) {
      throw new ScadaApiError(
        writeSent
          ? "服务端保存期间工程上下文已变化，写入可能已生效，请重新读取最新版本"
          : "服务端工程上下文已变化，请重新操作",
        "conflict",
        409,
      );
    }
  }

  /** 网络请求完成或失败后均核对保存上下文，避免迟到的拒绝污染新基线。 */
  private async awaitSaveStep<T>(
    generation: number,
    request: Promise<T>,
    writeSent = false,
  ): Promise<T> {
    try {
      return await request;
    } finally {
      this.requireCurrentContext(generation, writeSent);
    }
  }

  /** JSON 导入、本地草稿恢复或本地历史载入后必须清除旧基线。 */
  reset(): void {
    this.contextGeneration += 1;
    this.baseline = null;
    this.blockedCreateProjectId = null;
  }

  /**
   * 身份或工程授权失效后禁止把 404 当作可以新建同 ID 工程的凭据。
   * 只有明确恢复本地工程或重新载入授权工程才能解除阻断。
   */
  invalidateAccess(projectId?: string): void {
    this.contextGeneration += 1;
    this.blockedCreateProjectId =
      projectId ?? this.baseline?.projectId ?? this.blockedCreateProjectId;
    this.baseline = null;
  }

  getBaselineRevision(projectId: string): number | null {
    return this.baseline?.projectId === projectId ? this.baseline.revision : null;
  }

  /** 先校验快照、身份和当前服务端水位，供 UI 在用户确认后载入。 */
  async readVersion(projectId: string, revision: number): Promise<ServerProjectVersion> {
    const generation = this.contextGeneration;
    try {
      const identity = await this.api.getMe();
      this.requireCurrentContext(generation);
      const snapshot = await this.api.readVersion(projectId, revision);
      this.requireCurrentContext(generation);
      const current = await this.api.getProject(projectId);
      this.requireCurrentContext(generation);
      return { snapshot, headRevision: current.headRevision, principal: identity.principal };
    } catch (error) {
      // 迟到的旧请求不能将新工程的合法基线误判为撤权，也不能返回可被确认载入的旧快照。
      this.requireCurrentContext(generation);
      if (isScadaAccessRejection(error)) this.invalidateAccess(projectId);
      throw error;
    }
  }

  /**
   * 冲突后的最新版本只读预览：身份、最新水位、快照与再次核对的水位必须一致。
   * 不建立 CAS 基线，不修改当前画布或 IndexedDB；只允许显式确认载入后恢复保存。
   */
  async previewLatestVersion(projectId: string): Promise<ServerProjectVersion> {
    const generation = this.contextGeneration;
    try {
      const identity = await this.api.getMe();
      this.requireCurrentContext(generation);
      const firstHead = await this.api.getProject(projectId);
      this.requireCurrentContext(generation);
      const snapshot = await this.api.readVersion(projectId, firstHead.headRevision);
      this.requireCurrentContext(generation);
      const lastHead = await this.api.getProject(projectId);
      this.requireCurrentContext(generation);
      if (
        snapshot.projectId !== projectId ||
        snapshot.revision !== firstHead.headRevision ||
        lastHead.headRevision !== firstHead.headRevision
      ) {
        throw new ScadaApiError(
          "只读核验期间服务端版本已变化，请重新查询最新版本",
          "conflict",
          409,
        );
      }
      return { snapshot, headRevision: lastHead.headRevision, principal: identity.principal };
    } catch (error) {
      // 迟到的旧读取绝不清空另一工程的新基线，也不以 404 判断可以新建。
      this.requireCurrentContext(generation);
      if (isScadaAccessRejection(error)) this.invalidateAccess(projectId);
      throw error;
    }
  }

  /**
   * 用户确认载入后、替换画布之前重新核验身份及工程水位。
   * 旧预览或旧工程列表记录不得在确认对话框期间变成隐式最新版本。
   */
  async revalidateConfirmedLoad(version: ServerProjectVersion): Promise<void> {
    const generation = this.contextGeneration;
    const projectId = version.snapshot.projectId;
    try {
      const identity = await this.api.getMe();
      this.requireCurrentContext(generation);
      if (
        identity.principal.tenantId !== version.principal.tenantId ||
        identity.principal.subjectId !== version.principal.subjectId
      ) {
        throw new ScadaApiError("确认载入时服务端登录主体已变化，请重新登录并选择工程", "forbidden", 403);
      }
      const current = await this.api.getProject(projectId);
      this.requireCurrentContext(generation);
      if (current.headRevision !== version.headRevision) {
        throw new ScadaApiError(
          "确认载入时服务端版本已变化，请重新只读预览最新版本",
          "conflict",
          409,
        );
      }
    } catch (error) {
      // 旧请求不能撤销随后重新确认的合法基线。
      this.requireCurrentContext(generation);
      if (isScadaAccessRejection(error)) {
        this.invalidateAccess(projectId);
      } else if (
        error instanceof ScadaApiError &&
        error.kind === "conflict" &&
        this.baseline?.projectId === projectId
      ) {
        this.contextGeneration += 1;
        this.baseline = null;
      }
      throw error;
    }
  }

  /** 只有用户实际载入最新服务端版本，才建立后续 CAS 保存基线。 */
  acceptLoadedVersion(version: ServerProjectVersion): void {
    this.contextGeneration += 1;
    this.blockedCreateProjectId = null;
    const { snapshot, headRevision, principal } = version;
    this.baseline =
      snapshot.revision === headRevision
        ? { projectId: snapshot.projectId, revision: snapshot.revision, principal }
        : null;
  }

  /**
   * 标签页重新可见时只读复核现有服务端 CAS 基线。
   * 不创建工程、不写版本；过期请求不能清除后来已切换或重新载入的基线。
   */
  async revalidateBaseline(projectId: string): Promise<"unchanged" | "skipped"> {
    const baseline = this.baseline;
    if (!baseline || baseline.projectId !== projectId) return "skipped";

    try {
      const identity = await this.api.getMe();
      if (this.baseline !== baseline) return "skipped";
      if (
        identity.principal.tenantId !== baseline.principal.tenantId ||
        identity.principal.subjectId !== baseline.principal.subjectId
      ) {
        throw new ScadaApiError("服务端登录主体已变化，请重新载入授权工程", "forbidden", 403);
      }

      const current = await this.api.getProject(projectId);
      if (this.baseline !== baseline) return "skipped";
      if (current.headRevision !== baseline.revision) {
        throw new ScadaApiError("服务端版本已变化，请重新查询并载入最新版本", "conflict", 409);
      }
      return "unchanged";
    } catch (error) {
      if (this.baseline !== baseline) return "skipped";
      if (isScadaAccessRejection(error)) this.invalidateAccess(projectId);
      if (error instanceof ScadaApiError && error.kind === "conflict") {
        this.contextGeneration += 1;
        this.baseline = null;
      }
      throw error;
    }
  }

  async saveDocument(document: ScadaDocument): Promise<ServerProjectSaveResult> {
    if (this.saving) {
      throw new ScadaApiError("服务端工程正在保存，请勿重复提交", "conflict", 409);
    }
    this.saving = true;
    const generation = this.contextGeneration;
    let attemptedProjectId: string | undefined;
    try {
      // 获取独立副本，网络等待期间画布修改不能改变本次实际提交的文档。
      const checked = parseScadaDocument(document);
      attemptedProjectId = checked.projectId;
      if (this.blockedCreateProjectId === checked.projectId) {
        throw new ScadaApiError(
          "当前工程访问已失效，请重新从授权工程列表载入后再保存",
          "forbidden",
          403,
        );
      }
      const principal = (await this.awaitSaveStep(generation, this.api.getMe())).principal;
      let current;
      try {
        current = await this.awaitSaveStep(generation, this.api.getProject(checked.projectId));
      } catch (error) {
        if (!(error instanceof ScadaApiError) || error.kind !== "not_found") throw error;
        // 已明确载入过该工程后再收到 404，不能把授权撤销当作新工程创建。
        if (this.baseline?.projectId === checked.projectId) {
          this.invalidateAccess(checked.projectId);
          throw error;
        }
        // 首次保存的 404 仍允许尝试创建；服务端独立校验身份和租户唯一约束。
        const created = await this.awaitSaveStep(generation, this.api.createProject(checked), true);
        this.contextGeneration += 1;
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
        this.contextGeneration += 1;
        this.baseline = null;
        throw new ScadaApiError(
          "服务端已有工程，请先载入最新服务端版本再保存，避免覆盖他人的修改",
          "conflict",
          409,
        );
      }

      if (current.headRevision !== baseline.revision) {
        this.contextGeneration += 1;
        this.baseline = null;
        throw new ScadaApiError("服务端版本已变化，请重新查询并载入最新版本", "conflict", 409);
      }

      try {
        const saved = await this.awaitSaveStep(
          generation,
          this.api.appendVersion(checked.projectId, baseline.revision, checked),
          true,
        );
        this.contextGeneration += 1;
        this.baseline = { projectId: checked.projectId, revision: saved.revision, principal };
        return { projectId: checked.projectId, revision: saved.revision, created: false };
      } catch (error) {
        if (
          this.contextGeneration === generation &&
          error instanceof ScadaApiError &&
          error.kind === "conflict"
        ) {
          this.contextGeneration += 1;
          this.baseline = null;
        }
        throw error;
      }
    } catch (error) {
      if (this.contextGeneration === generation && isScadaAccessRejection(error)) {
        this.invalidateAccess(attemptedProjectId);
      }
      throw error;
    } finally {
      this.saving = false;
    }
  }
}

export function createStudioServerProjectSession(api: ScadaApiClient): StudioServerProjectSession {
  return new StudioServerProjectSession(api);
}
