import Dexie from "dexie";
import type { Table } from "dexie";
import { createProjectSnapshot, parseScadaDocument, readProjectSnapshot } from "@adui/scada-core";
import type {
  ProjectSnapshot,
  ProjectVersionQuery,
  ProjectVersionRepository,
  ProjectVersionSummary,
} from "@adui/scada-core";

interface VersionHead {
  projectId: string;
  revision: number;
}

interface VersionStorageOptions {
  /** 默认与既有草稿库分离，避免更改现有数据库的版本和迁移过程。 */
  name?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_QUERY_LIMIT = 100;

function requireProjectId(projectId: string): void {
  if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) {
    throw new TypeError("工程历史版本的工程 ID 必须是合法的稳定标识符");
  }
}

function requireRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("工程历史版本修订号必须是大于零的安全整数");
  }
}

function requireExpectedRevision(value: number | null): void {
  if (value !== null) requireRevision(value);
}

function queryOptions(query: ProjectVersionQuery): { limit: number; beforeRevision?: number } {
  const limit = query.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new TypeError("工程历史版本每页数量必须为 1～100 的整数");
  }
  if (query.beforeRevision !== undefined) requireRevision(query.beforeRevision);
  return { limit, beforeRevision: query.beforeRevision };
}

/** 乐观并发写入失败时明确返回可识别的冲突异常。 */
export class ProjectVersionConflictError extends TypeError {
  constructor() {
    super("工程历史版本已被其他页面更新，请先读取最新修订号后重试");
    this.name = "ProjectVersionConflictError";
  }
}

/**
 * 本地历史版本仓储：独立 IndexedDB、按工程隔离、只追加。
 * SHA-256 计算必须发生在数据库事务外；事务只执行修订号 CAS 与原子写入。
 */
export class DexieProjectVersionRepository implements ProjectVersionRepository {
  private readonly database: Dexie;
  private readonly heads: Table<VersionHead, string>;
  private readonly versions: Table<ProjectSnapshot, [string, number]>;

  constructor(options: VersionStorageOptions = {}) {
    const databaseOptions =
      options.indexedDB && options.IDBKeyRange
        ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange }
        : undefined;
    this.database = new Dexie(options.name ?? "adui-scada-studio-versions", databaseOptions);
    this.database.version(1).stores({
      heads: "projectId",
      versions: "[projectId+revision],projectId",
    });
    this.heads = this.database.table<VersionHead, string>("heads");
    this.versions = this.database.table<ProjectSnapshot, [string, number]>("versions");
  }

  async getHeadRevision(projectId: string): Promise<number | null> {
    requireProjectId(projectId);
    const head = await this.heads.get(projectId);
    if (!head) return null;
    if (head.projectId !== projectId) {
      throw new TypeError("工程历史版本索引中的工程 ID 不一致");
    }
    requireRevision(head.revision);
    if (!(await this.get(projectId, head.revision))) {
      throw new TypeError("工程历史版本索引指向了不存在的快照");
    }
    return head.revision;
  }

  async append(
    source: unknown,
    expectedRevision: number | null,
    createdAt = new Date().toISOString(),
  ): Promise<ProjectSnapshot> {
    requireExpectedRevision(expectedRevision);
    const document = parseScadaDocument(source);
    const projectId = document.projectId;

    // 在事务外完成 WebCrypto；事务期间不等待浏览器或其他异步服务。
    const currentRevision = await this.getHeadRevision(projectId);
    if (currentRevision !== expectedRevision) throw new ProjectVersionConflictError();
    const nextRevision = currentRevision === null ? 1 : currentRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) {
      throw new RangeError("工程历史版本修订号已达到安全整数上限");
    }
    const snapshot = await createProjectSnapshot(document, {
      revision: nextRevision,
      createdAt,
    });

    await this.database.transaction("rw", this.heads, this.versions, async () => {
      const latest = await this.heads.get(projectId);
      if ((latest?.revision ?? null) !== expectedRevision) {
        throw new ProjectVersionConflictError();
      }
      if (await this.versions.get([projectId, nextRevision])) {
        throw new TypeError("工程历史修订号已存在，禁止覆盖旧快照");
      }
      await this.versions.add(snapshot);
      await this.heads.put({ projectId, revision: nextRevision });
    });
    return snapshot;
  }

  async get(projectId: string, revision: number): Promise<ProjectSnapshot | null> {
    requireProjectId(projectId);
    requireRevision(revision);
    const saved = await this.versions.get([projectId, revision]);
    if (!saved) return null;
    const snapshot = await readProjectSnapshot(saved);
    if (snapshot.projectId !== projectId || snapshot.revision !== revision) {
      throw new TypeError("工程历史版本索引与快照元数据不一致");
    }
    return snapshot;
  }

  async list(
    projectId: string,
    query: ProjectVersionQuery = {},
  ): Promise<readonly ProjectVersionSummary[]> {
    requireProjectId(projectId);
    const { limit, beforeRevision } = queryOptions(query);
    // 查询 1 之前的历史必为空，避免构造空的排他性 IndexedDB 复合键范围。
    if (beforeRevision === 1) return [];
    const upper = beforeRevision ?? Number.MAX_SAFE_INTEGER;
    const records = await this.versions
      .where("[projectId+revision]")
      .between([projectId, 1], [projectId, upper], true, beforeRevision === undefined)
      .reverse()
      .limit(limit)
      .toArray();

    // 数据库可能被外部修改，列表也要完成原始摘要校验，不能只相信索引字段。
    return Promise.all(
      records.map(async (record) => {
        const snapshot = await readProjectSnapshot(record);
        if (snapshot.projectId !== projectId) {
          throw new TypeError("工程历史版本列表包含其他工程的快照");
        }
        return {
          projectId: snapshot.projectId,
          revision: snapshot.revision,
          createdAt: snapshot.createdAt,
          contentHash: snapshot.contentHash,
        };
      }),
    );
  }

  close(): void {
    this.database.close();
  }
}
