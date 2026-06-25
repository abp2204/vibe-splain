export { initParser, scanProject, getFileAnalysis, inferFrameworkRole, inferProductDomain, inferSideEffectProfile, type ScanResult, type FileEvidence } from './scanner.js';
export { readAnalysis, writeAnalysis, type AnalysisStore, type PersistedFile, type HotSpan, type WriteIntent } from './analysis.js';
export { computeSeverity } from './pipeline/scoring.js';
export { computeLoadBearingScore } from './pipeline/classification.js';
export {
  readDossier, validateMermaidNodeCount,
  type Dossier, type DossierViewModel, type Pillar, type DecisionCard, type Evidence,
  type CardCategory, type PillarDef, type ProjectMap,
} from './dossier.js';
export {
  type Language, type GravitySignals, type HeatSignals,
  type SmellKind, type SmellHit, type FileAnalysis,
  type FrameworkRole, type ProductDomain, type SideEffect, type RiskType,
  type RuntimeEntrypoint,
} from './signals.js';
export { readGraph, writeGraph, type ImportGraph } from './graph.js';
export { AdapterRegistry, adapterRegistry, type DomainAdapter } from './pipeline/adapters/index.js';

