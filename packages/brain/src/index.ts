export { initParser, scanProject, getFileAnalysis, type ScanResult, type FileEvidence } from './scanner.js';
export { readAnalysis, writeAnalysis, type AnalysisStore, type PersistedFile } from './analysis.js';
export {
  readDossier, writeDossier, regenerateUI, validateMermaidNodeCount,
  type Dossier, type Pillar, type DecisionCard, type Evidence,
  type CardCategory, type PillarDef, type ProjectMap,
} from './dossier.js';
export {
  type Language, type GravitySignals, type HeatSignals,
  type SmellKind, type SmellHit, type FileAnalysis,
} from './signals.js';
export { readGraph, writeGraph, type ImportGraph } from './graph.js';
export { startWatcher } from './watcher.js';
