export { initParser, scanProject, getFileAnalysis, inferFrameworkRole, inferProductDomain, inferSideEffectProfile, type ScanResult, type FileEvidence } from './scanner.js';
export { readAnalysis, writeAnalysis, writeDeltaTargets, computeLoadBearingScore, computeSeverity, type AnalysisStore, type PersistedFile, type DeltaTarget, type HotSpan, type RawEvidence, type DisplayEvidence, type ObservableOutput, type WriteIntent, type PatchRisk, type TestProbe } from './analysis.js';
export {
  readDossier, writeDossier, regenerateUI, validateMermaidNodeCount,
  type Dossier, type Pillar, type DecisionCard, type Evidence,
  type CardCategory, type PillarDef, type ProjectMap,
} from './dossier.js';
export {
  type Language, type GravitySignals, type HeatSignals,
  type SmellKind, type SmellHit, type FileAnalysis,
  type FrameworkRole, type ProductDomain, type SideEffect, type RiskType,
  type RuntimeEntrypoint,
} from './signals.js';
export { readGraph, writeGraph, type ImportGraph } from './graph.js';
export { startWatcher } from './watcher.js';
