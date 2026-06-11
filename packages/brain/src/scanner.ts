import { extname } from 'path';
import { readFile } from 'fs/promises';
import type { FileAnalysis, Language, HeatSignals } from './signals.js';
import type { ProjectMap } from './dossier.js';
import { runPipeline } from './pipeline/orchestrator.js';
import type { ImportGraph } from './graph.js';
import {
  initParser as _initParser,
  analyzeAst,
  parseAs,
  EXT_LANG,
} from './pipeline/inventory.js';

// Re-export classification helpers (used externally via brain/src/index.ts)
export { inferFrameworkRole, inferProductDomain } from './pipeline/inventory.js';
export { inferSideEffectProfile } from './pipeline/classification.js';

export async function initParser(): Promise<import('web-tree-sitter')> {
  return _initParser();
}

// ── Public result types ──────────────────────────────────────────────────────

export interface ScanResult {
  projectRoot: string;
  totalFilesScanned: number;
  realSourceCount: number;
  files: FileAnalysis[];
  map: ProjectMap;
  wildCandidates: FileAnalysis[];
  uiUrl: string;
  graph: ImportGraph;
  validation?: {
    passed: boolean;
    errors: number;
    warnings: number;
    reportPath: string;
  };
}

// ── Main scan — thin shim over pipeline orchestrator ─────────────────────────

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  return runPipeline(projectRoot);
}

// ── Per-file evidence extraction ─────────────────────────────────────────────

export interface FileEvidence {
  language: Language;
  signature: string;
  hotSpans: { startLine: number; endLine: number; rawExcerpt: string; snippet: string; reason: string }[];
  smellSpans: { startLine: number; endLine: number; snippet: string; reason: string }[];
  heatSignals: HeatSignals;
  loc: number;
  cyclomatic: number;
}

export async function getFileAnalysis(absPath: string): Promise<FileEvidence | null> {
  const ext = extname(absPath);
  const lang = EXT_LANG[ext] as Language | undefined;
  if (!lang) return null;
  let source: string;
  try { source = await readFile(absPath, 'utf8'); } catch { return null; }
  const tree = await parseAs(lang, source);
  if (!tree) return null;
  const ast = analyzeAst(source, lang, tree);
  const lines = source.split('\n');

  const smellSpans = ast.smells.map(s => {
    const start = Math.max(0, s.line - 1 - 3);
    const end = Math.min(lines.length, s.endLine + 3);
    return {
      startLine: start + 1, endLine: end,
      snippet: lines.slice(start, end).join('\n').slice(0, 1200),
      reason: `${s.kind}: ${s.note}`,
    };
  });

  return {
    language: lang,
    signature: ast.signature,
    hotSpans: ast.hotSpans,
    smellSpans,
    heatSignals: {
      todos: ast.smells.filter(s => s.kind === 'todo').length,
      suppressions: ast.smells.filter(s => s.kind === 'suppression').length,
      swallowedCatches: ast.swallowedCatches,
      maxNesting: ast.maxNesting,
      longFunctions: ast.longFunctions,
      magicNumbers: ast.magicNumbers,
    },
    loc: ast.loc,
    cyclomatic: ast.cyclomatic,
  };
}
