import { parsePublishedRelease } from "@adui/scada-core";
import type { ProjectSnapshot, PublishedRelease } from "@adui/scada-core";

/** 此处只处理发布快照，不代表已接入实时 Tag，也不提供设备写入能力。 */
export type PublishedRuntimeStatus =
  | "idle"
  | "loading"
  | "unreleased"
  | "verified"
  | "offline"
  | "denied"
  | "error";

export interface PublishedRuntimeState {
  readonly status: PublishedRuntimeStatus;
  readonly projectId: string | null;
  readonly releaseGeneration: number | null;
  readonly snapshot: ProjectSnapshot | null;
  readonly message: string;
  /** D2 尚未连接实时 Tag；UI 不得将已验证发布快照视为 GOOD 质量。 */
  readonly tagQuality: "UNAVAILABLE";
}

export interface PublishedReleaseReader {
  readCurrentRelease(projectId: string, signal?: AbortSignal): Promise<unknown>;
}

export type PublishedRuntimeListener = (state: PublishedRuntimeState) => void;

export const initialPublishedRuntimeState: PublishedRuntimeState = Object.freeze({
  status: "idle",
  projectId: null,
  releaseGeneration: null,
  snapshot: null,
  message: "尚未读取正式发布快照",
  tagQuality: "UNAVAILABLE",
});

interface LastReleasePointer {
  readonly generation: number;
  readonly revision: number;
  readonly hash: string;
  readonly eventId: string;
}

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function requireProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new TypeError("发布运行工程 ID 必须是合法的 1～128 字符 ASCII 标识符");
  }
}

/** 网络错误可单独显示离线，授权撤销与其它异常必须清空发布快照。 */
function failureStatus(error: unknown): PublishedRuntimeStatus {
  if (error !== null && typeof error === "object") {
    const kind = (error as { kind?: unknown }).kind;
    if (kind === "unauthenticated" || kind === "forbidden" || kind === "not_found") {
      return "denied";
    }
    if (kind === "network") return "offline";
  }
  return "error";
}

/** 不依赖 Vue/React、浏览器持久化或 SSE 的已发布工程只读加载会话。 */
export class PublishedRuntime {
  private readonly listener: PublishedRuntimeListener;
  private readonly reader: PublishedReleaseReader;
  private state: PublishedRuntimeState = initialPublishedRuntimeState;
  private currentProjectId: string | null = null;
  private lastPointer: LastReleasePointer | null = null;
  private controller: AbortController | null = null;
  private requestGeneration = 0;

  constructor(listener: PublishedRuntimeListener, reader: PublishedReleaseReader) {
    this.listener = listener;
    this.reader = reader;
  }

  snapshot(): PublishedRuntimeState {
    return this.state;
  }

  private publish(next: PublishedRuntimeState): void {
    this.state = Object.freeze(next);
    this.listener(this.state);
  }

  private isCurrent(generation: number, controller: AbortController): boolean {
    return generation === this.requestGeneration && this.controller === controller;
  }

  /**
   * 重新从服务端只读发布指针获取快照；新请求立即废弃旧请求。
   * 不保留离线画面正文，不回退到编辑 head/本地草稿或模拟工程。
   */
  async load(projectId: string): Promise<void> {
    requireProjectId(projectId);
    this.controller?.abort();
    if (this.currentProjectId !== projectId) this.lastPointer = null;
    this.currentProjectId = projectId;
    const requestGeneration = ++this.requestGeneration;
    const controller = new AbortController();
    this.controller = controller;
    this.publish({
      status: "loading",
      projectId,
      releaseGeneration: null,
      snapshot: null,
      message: "正在读取正式发布指针",
      tagQuality: "UNAVAILABLE",
    });

    try {
      const raw = await this.reader.readCurrentRelease(projectId, controller.signal);
      if (!this.isCurrent(requestGeneration, controller)) return;
      const release = await parsePublishedRelease(raw, projectId);
      if (!this.isCurrent(requestGeneration, controller)) return;
      this.acceptRelease(release);
    } catch (error) {
      if (!this.isCurrent(requestGeneration, controller)) return;
      const status = failureStatus(error);
      if (status === "denied") this.lastPointer = null;
      this.publish({
        status,
        projectId,
        releaseGeneration: null,
        snapshot: null,
        message:
          status === "denied"
            ? "登录或正式发布读取授权已失效"
            : status === "offline"
              ? "正式发布服务连接中断，已清空运行画面"
              : "正式发布快照或响应校验失败，已停止显示",
        tagQuality: "UNAVAILABLE",
      });
    } finally {
      if (this.isCurrent(requestGeneration, controller)) this.controller = null;
    }
  }

  /** 单次读取超时后撤销旧请求、清空快照并显示离线；迟到的请求不能恢复画面。 */
  expire(): void {
    if (this.controller === null || this.currentProjectId === null) return;
    const projectId = this.currentProjectId;
    this.requestGeneration++;
    this.controller.abort();
    this.controller = null;
    this.publish({
      status: "offline",
      projectId,
      releaseGeneration: null,
      snapshot: null,
      message: "正式发布指针读取超时，已清空运行画面",
      tagQuality: "UNAVAILABLE",
    });
  }

  private acceptRelease(release: PublishedRelease): void {
    if (release.status === "UNRELEASED") {
      if (this.lastPointer !== null) {
        throw new TypeError("正式发布指针不得回退到未发布状态");
      }
      this.publish({
        status: "unreleased",
        projectId: release.projectId,
        releaseGeneration: 0,
        snapshot: null,
        message: "当前工程尚未正式发布",
        tagQuality: "UNAVAILABLE",
      });
      return;
    }

    const previous = this.lastPointer;
    if (
      previous !== null &&
      (release.releaseGeneration < previous.generation ||
        (release.releaseGeneration === previous.generation &&
          (release.releasedRevision !== previous.revision ||
            release.releasedContentHash !== previous.hash ||
            release.eventId !== previous.eventId)))
    ) {
      throw new TypeError("正式发布指针代次回退或同代次元数据发生变化");
    }
    this.lastPointer = {
      generation: release.releaseGeneration,
      revision: release.releasedRevision,
      hash: release.releasedContentHash,
      eventId: release.eventId,
    };
    this.publish({
      status: "verified",
      projectId: release.projectId,
      releaseGeneration: release.releaseGeneration,
      snapshot: release.snapshot,
      message: "正式发布快照已校验，实时 Tag 数据尚未连接",
      tagQuality: "UNAVAILABLE",
    });
  }

  /** 离开运行页或身份上下文变化时必须调用，取消请求并清除全部发布态缓存。 */
  stop(): void {
    this.requestGeneration++;
    this.controller?.abort();
    this.controller = null;
    this.currentProjectId = null;
    this.lastPointer = null;
    this.publish(initialPublishedRuntimeState);
  }
}
