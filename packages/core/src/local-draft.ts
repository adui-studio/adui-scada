import { migrateScadaDocument, parseScadaDocument } from "./document.ts";
import type { ScadaDocument } from "./document.ts";

/** 浏览器存储适配接口，便于脱离 DOM 执行单元测试。 */
export interface LocalDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalDraft {
  savedAt: string;
  document: ScadaDocument;
}

/** 本地草稿与工程 Schema 使用独立版本，避免误当作已发布工程。 */
export const LOCAL_DRAFT_FORMAT_VERSION = 1;
export const LOCAL_DRAFT_MAX_BYTES = 2 * 1024 * 1024;
/** 两套 Studio 共享的自动保存延迟，单位毫秒。 */
export const LOCAL_DRAFT_AUTO_SAVE_DELAY_MS = 1000;
const KEY_PREFIX = "adui-scada:studio:draft:";
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function localDraftKey(projectId: string): string {
  if (!ID_PATTERN.test(projectId)) {
    throw new TypeError("本地草稿工程 ID 不是合法的稳定标识符");
  }
  return `${KEY_PREFIX}${projectId}`;
}

/** 统计 UTF-8 字节数，避免在无 DOM 类型的 Core 中依赖 TextEncoder。 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function readRaw(storage: LocalDraftStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    throw new TypeError("本地草稿读取失败，请检查浏览器存储权限");
  }
}

/** 仅检测是否存在记录；内容是否有效由恢复时的严格校验决定。 */
export function hasLocalDraft(storage: LocalDraftStorage, projectId: string): boolean {
  return readRaw(storage, localDraftKey(projectId)) !== null;
}

/** 只存储经过当前 Schema 验证的 JSON；写入失败不删除已有草稿。 */
export function saveLocalDraft(
  storage: LocalDraftStorage,
  source: unknown,
  now: Date = new Date(),
): LocalDraft {
  const document = parseScadaDocument(source);
  if (!Number.isFinite(now.getTime())) throw new TypeError("草稿保存时间无效");
  const savedAt = now.toISOString();
  const json = JSON.stringify({
    formatVersion: LOCAL_DRAFT_FORMAT_VERSION,
    savedAt,
    document,
  });
  if (utf8ByteLength(json) > LOCAL_DRAFT_MAX_BYTES) {
    throw new RangeError("本地草稿超过 2 MiB 限制，请导出 JSON 文件备份");
  }
  try {
    storage.setItem(localDraftKey(document.projectId), json);
  } catch {
    throw new TypeError("本地草稿保存失败，请检查浏览器存储权限或剩余空间");
  }
  return { savedAt, document };
}

/** 恢复时不执行表达式，不修改或删除无效记录。 */
export function readLocalDraft(storage: LocalDraftStorage, projectId: string): LocalDraft | null {
  const raw = readRaw(storage, localDraftKey(projectId));
  if (raw === null) return null;
  if (raw.length > LOCAL_DRAFT_MAX_BYTES || utf8ByteLength(raw) > LOCAL_DRAFT_MAX_BYTES) {
    throw new RangeError("本地草稿超过 2 MiB 限制，已拒绝恢复");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("本地草稿 JSON 已损坏，无法恢复");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("本地草稿存储结构无效");
  }
  const data = parsed as Record<string, unknown>;
  const keys = Object.keys(data);
  if (
    keys.length !== 3 ||
    keys.some((key) => !["formatVersion", "savedAt", "document"].includes(key)) ||
    data.formatVersion !== LOCAL_DRAFT_FORMAT_VERSION
  ) {
    throw new TypeError("本地草稿格式版本或结构不受支持");
  }
  if (typeof data.savedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(data.savedAt)) {
    throw new TypeError("本地草稿保存时间无效");
  }
  const date = new Date(data.savedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== data.savedAt) {
    throw new TypeError("本地草稿保存时间无效");
  }
  const { document } = migrateScadaDocument(data.document);
  if (document.projectId !== projectId) {
    throw new TypeError("本地草稿与当前工程 ID 不一致，已拒绝恢复");
  }
  return { savedAt: data.savedAt, document };
}

/** 只删除指定工程的浏览器草稿，不影响编辑器或其他工程。 */
export function clearLocalDraft(storage: LocalDraftStorage, projectId: string): void {
  try {
    storage.removeItem(localDraftKey(projectId));
  } catch {
    throw new TypeError("本地草稿清除失败，请检查浏览器存储权限");
  }
}

/**
 * 自动保存会话：仅比较工程内容与同一存储键的完整原始记录。
 * localStorage 不提供原子比较写入，因此属于尽力而为的冲突检测，
 * 不能取代服务端事务或多标签页排他锁。
 */
export class LocalDraftAutoSaveSession {
  readonly projectId: string;
  readonly hasExistingDraft: boolean;
  private readonly storage: LocalDraftStorage;
  private expectedRaw: string | null;
  private baselineJson: string;

  constructor(storage: LocalDraftStorage, source: unknown) {
    const document = parseScadaDocument(source);
    this.projectId = document.projectId;
    this.storage = storage;
    this.baselineJson = JSON.stringify(document);
    const key = localDraftKey(this.projectId);
    const raw = readRaw(storage, key);
    if (raw !== null) {
      if (readLocalDraft(storage, this.projectId) === null || readRaw(storage, key) !== raw) {
        throw new TypeError("本地草稿在检查期间发生变化，请重新确认");
      }
    }
    this.expectedRaw = raw;
    this.hasExistingDraft = raw !== null;
  }

  private checkedDocument(source: unknown): ScadaDocument {
    const document = parseScadaDocument(source);
    if (document.projectId !== this.projectId) {
      throw new TypeError("自动保存工程 ID 不一致，已拒绝写入");
    }
    return document;
  }

  /** 只有工程 JSON 改变才标记为待保存，选择和画布预览不属于工程内容。 */
  isDirty(source: unknown): boolean {
    return JSON.stringify(this.checkedDocument(source)) !== this.baselineJson;
  }

  /** 同一 Origin 的其他页面修改或清除草稿后，禁止自动覆盖。 */
  assertStorageUnchanged(): void {
    if (readRaw(this.storage, localDraftKey(this.projectId)) !== this.expectedRaw) {
      throw new TypeError("检测到其他页面修改或清除了草稿，自动保存已暂停，请人工核对");
    }
  }

  /** 人工保存成功后重置基线，后续自动保存仍执行冲突检测。 */
  acceptSaved(saved: LocalDraft): void {
    const document = this.checkedDocument(saved.document);
    this.baselineJson = JSON.stringify(document);
    this.expectedRaw = JSON.stringify({
      formatVersion: LOCAL_DRAFT_FORMAT_VERSION,
      savedAt: saved.savedAt,
      document,
    });
  }

  /** 每次自动写入前比较完整原始记录，冲突则拒绝覆盖。 */
  saveIfDirty(source: unknown, now: Date = new Date()): LocalDraft | null {
    const document = this.checkedDocument(source);
    if (JSON.stringify(document) === this.baselineJson) return null;
    this.assertStorageUnchanged();
    const saved = saveLocalDraft(this.storage, document, now);
    this.acceptSaved(saved);
    return saved;
  }
}
