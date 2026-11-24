export {
  SCADA_SCHEMA_VERSION,
  PREVIOUS_SCADA_SCHEMA_VERSION,
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
  tagDefinitionSupportsSlot,
} from "./tag-definition.ts";
export type { TagDataType, TagDefinition } from "./tag-definition.ts";
export { TAG_QUALITIES, TAG_QUALITY_LABELS, TagStore, validateTagValue } from "./tag-store.ts";
export type { TagChange, TagListener, TagQuality, TagScalar, TagValue } from "./tag-store.ts";
export {
  MAX_TAG_HISTORY_BUFFER_SAMPLES,
  TagHistoryBuffer,
  TagHistorySampler,
  selectTagHistory,
} from "./tag-history.ts";
export type {
  TagHistoryArchiveBatch,
  TagHistoryBatch,
  TagHistoryPoint,
  TagHistoryQuery,
  TagHistorySampleInput,
  TagHistorySamplingDecision,
  TagHistorySamplingPolicy,
} from "./tag-history.ts";
export { TagHistoryArchiveWriter } from "./tag-history-persistence.ts";
export type {
  TagHistoryArchiveScope,
  TagHistoryPersistencePort,
  TagHistoryPersistenceReceipt,
  TagHistoryPersistenceRequest,
} from "./tag-history-persistence.ts";
export {
  ALARM_EVENTS,
  ALARM_STATES,
  ALARM_STATE_LABELS,
  transitionAlarmState,
} from "./alarm-state.ts";
export type { AlarmEvent, AlarmState } from "./alarm-state.ts";
export { classifyNumericAlarmSample } from "./alarm-tag-quality.ts";
export { AlarmSubscriptionAdapter } from "./alarm-subscription-adapter.ts";
export type {
  AlarmReadonlySubscriptionSource,
  AlarmSubscriptionAdapterOptions,
  AlarmSubscriptionScheduler,
} from "./alarm-subscription-adapter.ts";
export { AlarmBaselineSessionController } from "./alarm-session-controller.ts";
export type {
  AlarmBaselineManagedTransition,
  AlarmBaselineSessionToken,
} from "./alarm-session-controller.ts";
export {
  beginAlarmBaselineSession,
  restartAlarmBaselineSession,
  transitionAlarmBaselineSession,
} from "./alarm-baseline-session.ts";
export type {
  AlarmBaselineSessionAction,
  AlarmBaselineSessionRejectReason,
  AlarmBaselineSessionState,
  AlarmBaselineSessionTransition,
} from "./alarm-baseline-session.ts";
export { advanceAlarmTagDeltaBaseline } from "./alarm-tag-delta.ts";
export type {
  AlarmTagDeltaRejectReason,
  AlarmTagDeltaRequest,
  AlarmTagDeltaResult,
} from "./alarm-tag-delta.ts";
export { establishAlarmSnapshotBaseline } from "./alarm-snapshot-baseline.ts";
export type {
  AlarmSnapshotBaseline,
  AlarmSnapshotBaselineRequest,
  AlarmSnapshotBaselineResult,
} from "./alarm-snapshot-baseline.ts";
export { classifySessionBoundNumericAlarmSample } from "./alarm-session-generation.ts";
export type {
  AlarmSessionGenerations,
  SessionBoundNumericAlarmSample,
} from "./alarm-session-generation.ts";
export { classifyOrderedNumericAlarmSample } from "./alarm-tag-sequence.ts";
export type { OrderedNumericAlarmSample } from "./alarm-tag-sequence.ts";
export { classifyTimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
export type { TimelyNumericAlarmSample } from "./alarm-tag-freshness.ts";
export type { NumericAlarmSample } from "./alarm-tag-quality.ts";
export { replayAlarmEvents } from "./alarm-replay.ts";
export type { AlarmReplayResult, AlarmReplayStep } from "./alarm-replay.ts";
export { WaterTreatmentSimulator } from "./simulator.ts";
export { renderSvgPage } from "./svg.ts";
export {
  waterTreatmentDemoDocument,
  waterTreatmentStudioDocument,
  waterTreatmentShowcaseDocument,
  STUDIO_DEFAULT_PAGE_SIZE,
  createBlankStudioDocument,
  waterTreatmentDemoTagDefinitions,
  waterTreatmentDemoTagCatalog,
  waterTreatmentDemoTagOptions,
} from "./demo-document.ts";
export type { WaterTreatmentDemoTagOption } from "./demo-document.ts";
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
export {
  studioViewportRect,
  studioFocusTransform,
  STUDIO_CANVAS_FIT_MARGIN,
} from "./studio-viewport-rect.ts";
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
  ProjectListQuery,
  ProjectVersionQuery,
  ProjectVersionSummary,
} from "./project-version-repository.ts";
export { parseServerProjectSaveRequest } from "./server-project-contract.ts";
export type { ServerProjectSaveRequest } from "./server-project-contract.ts";
export { parsePublishedRelease } from "./published-release.ts";
export type { PublishedRelease } from "./published-release.ts";
export { validateProjectReleasePreflight } from "./release-preflight.ts";
export type {
  ProjectReleasePreflightIssue,
  ProjectReleasePreflightResult,
} from "./release-preflight.ts";
export { compareProjectDocuments } from "./project-version-compare.ts";
export type {
  ProjectDocumentMetrics,
  ProjectDocumentComparison,
} from "./project-version-compare.ts";
