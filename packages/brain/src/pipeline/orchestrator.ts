import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { writeGraph } from '../graph.js';
import { writeAnalysis } from '../analysis.js';
import type { FileAnalysis } from '../signals.js';
import { runInventory } from './inventory.js';
import { runResolution } from './resolution.js';
import { runClassification } from './classification.js';
import { runActionBinding } from './binding.js';
import { runScoring } from './scoring.js';
import type { ValidationReport } from '../analysis.js';

export interface PipelineScanResult {
  projectRoot: string;
  totalFilesScanned: number;
  realSourceCount: number;
  files: FileAnalysis[];
  map: import('../dossier.js').ProjectMap;
  wildCandidates: FileAnalysis[];
  uiUrl: string;
  graph: import('../graph.js').ImportGraph;
  store: import('../analysis.js').AnalysisStore;
  validation: {
    passed: boolean;
    errors: number;
    warnings: number;
    reportPath: string;
  };
  fullValidationReport: import('../analysis.js').ValidationReport;
}

export async function runPipeline(projectRoot: string): Promise<PipelineScanResult> {
  // Stage 1-3: inventory (file collection, parsing, framework/domain classification)
  const inv = await runInventory(projectRoot);

  // Stage 4: alias resolution + graph construction
  const res = await runResolution(projectRoot, inv);

  // Stage 5: action bindings (function-level call edges and semantics)
  const binding = await runActionBinding(projectRoot, inv, res);

  // Stage 6-9: classification (side effects, write intents, risk types, load bearing)
  const cr = await runClassification(projectRoot, inv, res);

  // Stage 10-13: scoring (canonical severity, delta targets, validation report)
  const scoring = await runScoring(projectRoot, cr, binding);

  // Build FileAnalysis array for backward compat with ScanResult
  const files: FileAnalysis[] = cr.classified
    .filter(f => f.isRealSource)
    .sort((a, b) => b.gravity - a.gravity)
    .map(f => ({
      path: f.abs,
      relativePath: f.rel,
      language: f.lang,
      isRealSource: f.isRealSource,
      demoteReason: f.demoteReason,
      gravity: Math.round(f.gravity),
      heat: Math.round(f.heat),
      gravitySignals: f.gravitySignals,
      heatSignals: f.heatSignals,
      smells: f.smells,
      pillarHint: f.pillarHint,
      frameworkRole: f.frameworkRole,
      productDomain: f.productDomain,
      sideEffectProfile: f.sideEffectProfile,
    }));

  const wildCandidates = cr.classified
    .filter(f => f.isRealSource && (f.heat >= 60 || f.smells.some(s => s.severity >= 4)))
    .sort((a, b) => b.heat - a.heat)
    .map(f => ({
      path: f.abs,
      relativePath: f.rel,
      language: f.lang,
      isRealSource: f.isRealSource,
      demoteReason: f.demoteReason,
      gravity: Math.round(f.gravity),
      heat: Math.round(f.heat),
      gravitySignals: f.gravitySignals,
      heatSignals: f.heatSignals,
      smells: f.smells,
      pillarHint: f.pillarHint,
      frameworkRole: f.frameworkRole,
      productDomain: f.productDomain,
      sideEffectProfile: f.sideEffectProfile,
    }));

  const uiUrl = `file://${join(projectRoot, '.vibe-splainer', 'ui', 'index.html')}`;

  return {
    projectRoot,
    totalFilesScanned: cr.classified.length,
    realSourceCount: files.length,
    files,
    map: cr.map,
    wildCandidates,
    uiUrl,
    graph: res.graph,
    store: scoring.store,
    validation: {
      passed: scoring.validationReport.passed,
      errors: scoring.validationReport.summary.errorCount,
      warnings: scoring.validationReport.summary.warningCount,
      reportPath: '.vibe-splainer/validation_report.json',
    },
    fullValidationReport: scoring.validationReport,
  };
}
