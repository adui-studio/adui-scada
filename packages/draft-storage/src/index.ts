import Dexie from "dexie";
import type { Table } from "dexie";
import { localDraftKey, readLocalDraft, parseScadaDocument } from "@adui/scada-core";
import type { DraftRecord, DraftRepository, LocalDraftStorage } from "@adui/scada-core";

interface MigrationMarker {
  projectId: string;
}

interface RepositoryOptions {
  name?: string;
  legacyStorage?: LocalDraftStorage;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  broadcast?: boolean;
}

/**
 * 浏览器数据库适配器。所有 revision 判断和写入都在同一个 IndexedDB
 * readwrite 事务中执行，避免旧标签页静默覆盖较新的工程草稿。
 */
export class DexieDraftRepository implements DraftRepository {
  private readonly database: Dexie;
  private readonly drafts: Table<DraftRecord, string>;
  private readonly migrations: Table<MigrationMarker, string>;
  private readonly legacyStorage?: LocalDraftStorage;
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Map<string, Set<(revision: number | null) => void>>();

  constructor(options: RepositoryOptions = {}) {
    this.legacyStorage = options.legacyStorage;
    const databaseOptions =
      options.indexedDB && options.IDBKeyRange
        ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange }
        : undefined;
    this.database = new Dexie(options.name ?? "adui-scada-studio", databaseOptions);
    this.database.version(1).stores({
      drafts: "projectId,savedAt",
      migrations: "projectId",
    });
    this.drafts = this.database.table<DraftRecord, string>("drafts");
    this.migrations = this.database.table<MigrationMarker, string>("migrations");
    this.channel =
      options.broadcast !== false && typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("adui-scada-studio-draft-updates")
        : null;
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        const change = data as Record<string, unknown>;
        if (
          typeof change.projectId !== "string" ||
          !(change.revision === null || Number.isSafeInteger(change.revision))
        ) {
          return;
        }
        for (const listener of this.listeners.get(change.projectId) ?? []) {
          listener(change.revision as number | null);
        }
      };
    }
  }

  private validate(record: DraftRecord, projectId: string): DraftRecord {
    if (
      record.projectId !== projectId ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1 ||
      typeof record.savedAt !== "string" ||
      !Number.isFinite(Date.parse(record.savedAt))
    ) {
      throw new TypeError("IndexedDB 草稿元数据不合法，已拒绝载入");
    }
    const document = parseScadaDocument(record.document);
    if (document.projectId !== projectId) {
      throw new TypeError("IndexedDB 草稿工程 ID 不一致，已拒绝载入");
    }
    return { projectId, revision: record.revision, savedAt: record.savedAt, document };
  }

  private notify(projectId: string, revision: number | null): void {
    this.channel?.postMessage({ projectId, revision });
    for (const listener of this.listeners.get(projectId) ?? []) listener(revision);
  }

  async get(projectId: string): Promise<DraftRecord | null> {
    localDraftKey(projectId);
    const current = await this.drafts.get(projectId);
    if (current) return this.validate(current, projectId);
    if (!this.legacyStorage || (await this.migrations.get(projectId))) return null;

    // 先完整验证历史 localStorage 记录，再在事务内迁入并留下迁移标记。
    const legacy = readLocalDraft(this.legacyStorage, projectId);
    if (!legacy) return null;
    const migrated = await this.database.transaction(
      "rw",
      this.drafts,
      this.migrations,
      async () => {
        const latest = await this.drafts.get(projectId);
        if (latest) return this.validate(latest, projectId);
        if (await this.migrations.get(projectId)) return null;
        const record: DraftRecord = {
          projectId,
          savedAt: legacy.savedAt,
          revision: 1,
          document: legacy.document,
        };
        await this.drafts.put(record);
        await this.migrations.put({ projectId });
        return record;
      },
    );
    if (migrated) {
      // 成功提交 IndexedDB 以后才清理旧副本；失败时标记可防止再次导入。
      try {
        this.legacyStorage.removeItem(localDraftKey(projectId));
      } catch {
        // 历史备份未被删除，但已经有迁移标记，避免清除后被自动恢复。
      }
      this.notify(projectId, migrated.revision);
    }
    return migrated;
  }

  async save(source: unknown, expectedRevision: number | null): Promise<DraftRecord> {
    const document = parseScadaDocument(source);
    const projectId = document.projectId;
    localDraftKey(projectId);
    if (
      expectedRevision !== null &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    ) {
      throw new TypeError("草稿预期修订号无效");
    }
    // 在事务开始前完成非数据库运算，防止异步等待导致事务意外关闭。
    const savedAt = new Date().toISOString();
    const record = await this.database.transaction("rw", this.drafts, async () => {
      const existing = await this.drafts.get(projectId);
      if ((existing?.revision ?? null) !== expectedRevision) {
        throw new TypeError("检测到其他页面修改了草稿，请先恢复或核对最新版本");
      }
      if (existing) this.validate(existing, projectId);
      const next: DraftRecord = {
        projectId,
        savedAt,
        revision: (existing?.revision ?? 0) + 1,
        document,
      };
      await this.drafts.put(next);
      return next;
    });
    this.notify(projectId, record.revision);
    return record;
  }

  async remove(projectId: string, expectedRevision: number | null): Promise<void> {
    localDraftKey(projectId);
    await this.database.transaction("rw", this.drafts, this.migrations, async () => {
      const existing = await this.drafts.get(projectId);
      if ((existing?.revision ?? null) !== expectedRevision) {
        throw new TypeError("检测到其他页面修改了草稿，已拒绝清除");
      }
      await this.drafts.delete(projectId);
      // 删除后保留迁移标记，避免残留 localStorage 备份再次复活。
      await this.migrations.put({ projectId });
    });
    if (this.legacyStorage) {
      try {
        this.legacyStorage.removeItem(localDraftKey(projectId));
      } catch {
        this.notify(projectId, null);
        throw new TypeError("已清除数据库草稿，但旧浏览器记录清理失败，请检查存储权限");
      }
    }
    this.notify(projectId, null);
  }

  subscribe(projectId: string, listener: (revision: number | null) => void): () => void {
    localDraftKey(projectId);
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  close(): void {
    this.channel?.close();
    this.database.close();
    this.listeners.clear();
  }
}
