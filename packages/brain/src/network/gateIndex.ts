import type { AnalysisStore, PersistedFile } from '../analysis.js';
import type { SideEffect, RiskType } from '../signals.js';

export interface GateIndexEntry {
  relativePath: string;
  gravity: number;
  demoteReason: string | null;
  hasBehavioralSubstance: boolean;
  dependents: string[]; // denoised direct dependents list
  fanIn: number;
  fanOut: number;
  centrality: number;
  severity: 1 | 2 | 3 | 4 | 5;
  sideEffects: SideEffect[];
  riskTypes: RiskType[];
}

export interface GateIndex {
  files: Record<string, GateIndexEntry>;
}

/**
 * Filter out generated, vendored, minified, or virtual environment files from importing paths.
 * Keep tests and source files.
 */
export function isDenoisedImporter(relPath: string): boolean {
  if (!relPath) return false;
  // Normalize separators to POSIX forward slash
  const norm = relPath.replace(/\\/g, '/');
  const segs = norm.split('/');

  const excludedDirs = new Set([
    'node_modules',
    'vendor',
    'vendored',
    'site-packages',
    'third_party',
    'third-party',
    '.yarn',
    'bower_components',
    'venv',
    '.venv',
    'env',
    'virtualenv',
    '.git',
    '.vibe-splainer',
    'dist',
    'build',
    'out',
    'target',
    '.next',
    '.nuxt',
    '.docusaurus',
    'coverage',
    '.nyc_output',
    '.cache'
  ]);

  for (const s of segs) {
    const sLower = s.toLowerCase();
    if (excludedDirs.has(sLower)) {
      return false;
    }
    if (sLower.endsWith('.venv')) {
      return false;
    }
  }

  const fileName = segs[segs.length - 1];
  const fileNameLower = fileName.toLowerCase();

  // Minified files
  if (/\.min\.[a-z]+$/.test(fileNameLower) || fileNameLower.includes('.min.')) {
    return false;
  }

  // Generated files
  if (/\.generated\./.test(fileNameLower) || fileNameLower.includes('__generated__')) {
    return false;
  }
  if (fileNameLower.endsWith('.lock')) {
    return false;
  }

  // Virtual protocols/environments
  if (norm.startsWith('virtual:') || norm.startsWith('__virtual:') || norm.startsWith('webpack:')) {
    return false;
  }

  return true;
}

/**
 * Determine if a file has behavioral substance based on:
 * !isTypeDefinition && (cyclomatic >= 5 || hasSideEffects || hasStrongRiskType)
 */
export function hasBehavioralSubstance(file: Partial<PersistedFile>): boolean {
  const isTypeDefinition = file.frameworkRole === 'type_definition';
  const cyclomatic = file.gravitySignals?.cyclomatic ?? 0;
  const hasSideEffects = (file.sideEffectProfile ?? []).some(e => e !== 'none_detected');
  const hasStrongRiskType = (file.riskTypes ?? []).some(r =>
    r === 'state_machine' ||
    r === 'mutation_orchestration' ||
    r === 'registry_bottleneck' ||
    r === 'side_effect_coupling'
  );
  return !isTypeDefinition && (cyclomatic >= 5 || hasSideEffects || hasStrongRiskType);
}

/**
 * Build the scan-time GateIndex from the full AnalysisStore.
 */
export function buildGateIndex(store: AnalysisStore): GateIndex {
  const files: Record<string, GateIndexEntry> = {};

  if (store && store.files) {
    for (const [key, file] of Object.entries(store.files)) {
      const dependents = (file.importedBy ?? []).filter(isDenoisedImporter);
      const sideEffects = (file.sideEffectProfile ?? []).filter(e => e !== 'none_detected');

      files[key] = {
        relativePath: file.relativePath,
        gravity: file.gravity ?? 0,
        demoteReason: file.demoteReason,
        hasBehavioralSubstance: hasBehavioralSubstance(file),
        dependents,
        fanIn: file.gravitySignals?.fanIn ?? dependents.length,
        fanOut: file.gravitySignals?.fanOut ?? 0,
        centrality: file.gravitySignals?.centrality ?? 0,
        severity: file.canonicalSeverity ?? 1,
        sideEffects,
        riskTypes: file.riskTypes ?? [],
      };
    }
  }

  return { files };
}
