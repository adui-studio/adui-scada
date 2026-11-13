export {
  SCADA_SCHEMA_VERSION,
  LEGACY_SCADA_SCHEMA_VERSION,
  parseScadaDocument,
  migrateScadaDocument,
  STUDIO_NODE_STATE_KEY,
  studioNodeLocked,
  studioNodeVisible,
} from "./document.ts";
export type {
  ScadaDocument,
  ScadaDocumentMigration,
  ScadaNode,
  ScadaPage,
  TagId,
} from "./document.ts";
export {
  TAG_DATA_TYPES,
  TAG_DATA_TYPE_LABELS,
  TagDefinitionCatalog,
} from "./tag-definition.ts";
export type { TagDataType, TagDefinition } from "./tag-definition.ts";
export { TAG_QUALITIES, TAG_QUALITY_LABELS, TagStore, validateTagValue } from "./tag-store.ts";
export type { TagChange, TagListener, TagQuality, TagScalar, TagValue } from "./tag-store.ts";
export { WaterTreatmentSimulator } from "./simulator.ts";
export { renderSvgPage } from "./svg.ts";
export { waterTreatmentDemoDocument, waterTreatmentDemoTagOptions } from "./demo-document.ts";
export { buildLayerTree } from "./layer-tree.ts";
export type { LayerTreeEntry, LayerTreeGroup, LayerTreeNode } from "./layer-tree.ts";
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
export { DraftAutoSaveSession } from "./draft-repository.ts";
export type { DraftRepository, DraftRecord } from "./draft-repository.ts";
export { clampStudioPan, studioViewBox } from "./studio-viewport.ts";
export type { StudioPan, StudioPageSize } from "./studio-viewport.ts";
export { studioViewportRect } from "./studio-viewport-rect.ts";
export type { StudioViewportRect, StudioViewportSize } from "./studio-viewport-rect.ts";
export {
  PROJECT_SNAPSHOT_FORMAT_VERSION,
  PROJECT_SNAPSHOT_MAX_BYTES,
  validateProjectDocument,
  createProjectSnapshot,
  readProjectSnapshot,
} from "./project-snapshot.ts";
export type {
  DeepReadonly,
  ProjectValidationIssue,
  ProjectValidationResult,
  ProjectSnapshot,
  ProjectSnapshotOptions,
} from "./project-snapshot.ts";
export type {
  ProjectVersionRepository,
  ProjectVersionQuery,
  ProjectVersionSummary,
} from "./project-version-repository.ts";
export { parseServerProjectSaveRequest } from "./server-project-contract.ts";
export type { ServerProjectSaveRequest } from "./server-project-contract.ts";
export { compareProjectDocuments } from "./project-version-compare.ts";
export type {
  ProjectDocumentMetrics,
  ProjectDocumentComparison,
} from "./project-version-compare.ts";
