export { initParser, scanProject, getFileAnalysis, inferFrameworkRole, inferProductDomain, inferSideEffectProfile, type ScanResult, type FileEvidence } from './scanner.js';
export { readAnalysis, writeAnalysis, writeDeltaTargets, readActionBindings, type AnalysisStore, type PersistedFile, type DeltaTarget, type HotSpan, type RawEvidence, type DisplayEvidence, type ObservableOutput, type WriteIntent, type PatchRisk, type TestProbe, type FunctionActionSummary } from './analysis.js';
export { computeSeverity } from './pipeline/scoring.js';
export { computeLoadBearingScore } from './pipeline/classification.js';
export {
  readDossier, validateMermaidNodeCount,
  type Dossier, type DossierViewModel, type Pillar, type DecisionCard, type Evidence,
  type CardCategory, type PillarDef, type ProjectMap,
} from './dossier.js';
export { RecommendationEngine, type Recommendation } from './policy/RecommendationEngine.js';
export {
  type Language, type GravitySignals, type HeatSignals,
  type SmellKind, type SmellHit, type FileAnalysis,
  type FrameworkRole, type ProductDomain, type SideEffect, type RiskType,
  type RuntimeEntrypoint,
} from './signals.js';
export { readGraph, writeGraph, type ImportGraph } from './graph.js';
export type {
  ActionBindingsArtifact,
  FileBindingRecord,
  FunctionRecord,
  CallRecord,
  SemanticActionRecord,
  ImportBinding,
  ActionBindingResult,
} from './pipeline/binding.js';
export { traverseCallChain } from './pipeline/binding.js';
export { ProofValidator, type WorkerReceipt, type ProofPointerRef, type ChangedFileRecord, type ProofDescriptor, type ValidationResult } from './ProofValidator.js';
