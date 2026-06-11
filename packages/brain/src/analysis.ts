import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type {
  Language, GravitySignals, HeatSignals, SmellHit,
} from './signals.js';

// Per-file analysis persisted to .vibe-splainer/analysis.json so that
// get_file_context can serve graph-derived data (fanIn/centrality/importedBy)
// without re-running the whole scan.
export interface PersistedFile {
  relativePath: string;
  language: Language;
  isRealSource: boolean;
  demoteReason: string | null;
  gravity: number;
  heat: number;
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: SmellHit[];
  pillarHint: string | null;
  importedBy: string[];
  imports: string[];
}

export interface AnalysisStore {
  files: Record<string, PersistedFile>;
}

export async function readAnalysis(projectRoot: string): Promise<AnalysisStore | null> {
  const p = join(projectRoot, '.vibe-splainer', 'analysis.json');
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as AnalysisStore;
  } catch {
    return null;
  }
}

export async function writeAnalysis(projectRoot: string, store: AnalysisStore): Promise<void> {
  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'analysis.json'), JSON.stringify(store, null, 2), 'utf8');
}
