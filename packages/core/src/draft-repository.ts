import { parseScadaDocument } from "./document.ts";
import type { ScadaDocument } from "./document.ts";

/** 数据库草稿版本独立于工程 Schema，供同一事务内条件写入。 */
export interface DraftRecord {
  projectId: string;
  savedAt: string;
  revision: number;
  document: ScadaDocument;
}

/** 框架无关的异步工程仓储；浏览器实现位于独立 IndexedDB 适配包。 */
export interface DraftRepository {
  get(projectId: string): Promise<DraftRecord | null>;
  save(source: unknown, expectedRevision: number | null): Promise<DraftRecord>;
  remove(projectId: string, expectedRevision: number | null): Promise<void>;
  subscribe(projectId: string, listener: (revision: number | null) => void): () => void;
}

/** 保持工程基线；只在内容发生变化时执行事务化的版本条件写入。 */
export class DraftAutoSaveSession {
  readonly projectId: string;
  readonly hasExistingDraft: boolean;
  private readonly repository: DraftRepository;
  private revision: number | null;
  private baseline: string;
  private stopped = false;
  private pending: Promise<void> = Promise.resolve();

  private constructor(
    repository: DraftRepository,
    source: ScadaDocument,
    saved: DraftRecord | null,
  ) {
    this.repository = repository;
    this.projectId = source.projectId;
    this.revision = saved?.revision ?? null;
    this.baseline = JSON.stringify(source);
    this.hasExistingDraft = saved !== null;
  }

  static async open(repository: DraftRepository, source: unknown): Promise<DraftAutoSaveSession> {
    const document = parseScadaDocument(source);
    const saved = await repository.get(document.projectId);
    return new DraftAutoSaveSession(repository, document, saved);
  }

  get currentRevision(): number | null {
    return this.revision;
  }

  private checked(source: unknown): ScadaDocument {
    const document = parseScadaDocument(source);
    if (document.projectId !== this.projectId) {
      throw new TypeError("自动保存工程 ID 不一致，已拒绝写入");
    }
    return document;
  }

  isDirty(source: unknown): boolean {
    return JSON.stringify(this.checked(source)) !== this.baseline;
  }

  /** 已经提交的数据库保存结果才能推进当前基线。 */
  acceptSaved(saved: DraftRecord): void {
    if (saved.projectId !== this.projectId) {
      throw new TypeError("自动保存工程 ID 不一致，已拒绝写入");
    }
    const document = this.checked(saved.document);
    this.revision = saved.revision;
    this.baseline = JSON.stringify(document);
  }

  /** 依次执行异步写入，避免较慢的事务覆盖较新的同会话编辑。 */
  saveIfDirty(source: unknown): Promise<DraftRecord | null> {
    const document = this.checked(source);
    const task = this.pending.then(async () => {
      if (this.stopped || JSON.stringify(document) === this.baseline) return null;
      const saved = await this.repository.save(document, this.revision);
      this.acceptSaved(saved);
      return saved;
    });
    this.pending = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /** 在恢复、导入、清除和人工保存前等待已开始的写入结束。 */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.pending;
  }
}
