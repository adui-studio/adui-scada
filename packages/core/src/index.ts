export {
  SCADA_SCHEMA_VERSION,
  LEGACY_SCADA_SCHEMA_VERSION,
  parseScadaDocument,
  migrateScadaDocument,
} from "./document.ts";
export type {
  ScadaDocument,
  ScadaDocumentMigration,
  ScadaNode,
  ScadaPage,
  TagId,
} from "./document.ts";
export { TAG_QUALITIES, TAG_QUALITY_LABELS, TagStore, validateTagValue } from "./tag-store.ts";
export type { TagChange, TagListener, TagQuality, TagScalar, TagValue } from "./tag-store.ts";
export { WaterTreatmentSimulator } from "./simulator.ts";
export { renderSvgPage } from "./svg.ts";
export { waterTreatmentDemoDocument } from "./demo-document.ts";
export {
  LOCAL_DRAFT_FORMAT_VERSION,
  LOCAL_DRAFT_MAX_BYTES,
  LOCAL_DRAFT_AUTO_SAVE_DELAY_MS,
  localDraftKey,
  hasLocalDraft,
  saveLocalDraft,
  readLocalDraft,
  clearLocalDraft,
  LocalDraftAutoSaveSession,
} from "./local-draft.ts";
export type { LocalDraft, LocalDraftStorage } from "./local-draft.ts";
