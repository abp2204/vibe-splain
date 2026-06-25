import { join } from 'path';
import { readFile, mkdir } from 'fs/promises';
export interface Recommendation {
  strategy: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
}

// Types
export interface Evidence {
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export type CardCategory =
  | 'Bottleneck' | 'Hack' | 'Smart-Move' | 'Risk' | 'Convention' | 'Dead-Weight';

export interface DecisionCard {
  id: string;
  pillar: string;
  title: string;
  thesis: string;                 // one-sentence verdict, the headline
  category: CardCategory;
  severity: 1 | 2 | 3 | 4 | 5;
  narrative: string;
  tradeoff: string | null;        // what was given up / why not the obvious way
  blastRadius: string | null;     // "what breaks if this changes"
  confidence: 'low' | 'medium' | 'high';
  evidence: Evidence[];
  diagram: string | null;
  gravity?: number;               // carried from scan for UI plotting
  heat?: number;
  primaryFile?: string;           // the one file this card is about (dedupe key)
  status: 'fresh' | 'stale';
  lastScannedHash: string;
}

export interface Pillar {
  name: string;
  cardCount: number;
  decisions: DecisionCard[];
}

export interface PillarDef {
  name: string;
  description: string;
  memberFiles: string[];
}

export interface ProjectMap {
  stack: string[];          // ["Python 3.13", "PySide6", "pygame"]
  entrypoints: string[];
  pillars: PillarDef[];     // the ONLY legal pillar names
  fileCount: number;
  realSourceCount: number;
  topGravity: string[];     // "Start Here" — ranked relative paths
  topHeat: string[];        // Wild Discovery candidates
  brief: string | null;     // agent fills in Phase 4 global pass
  validation?: {            // ADR-021
    passed: boolean;
    errors: number;
    warnings: number;
  };
}

export interface Dossier {
  version: string;
  scannedAt: string;
  projectRoot: string;
  map: ProjectMap;
  pillars: Pillar[];
  wildDiscoveries: DecisionCard[];
  stalePaths: string[];
}

export interface DossierViewModel extends Dossier {
  recommendations: Record<string, Recommendation[]>;
}

export async function readDossier(projectRoot: string): Promise<Dossier | null> {
  const dossierPath = join(projectRoot, '.vibesplain', 'dossier.json');
  try {
    const raw = await readFile(dossierPath, 'utf8');
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}

// Mermaid node validation (max 7 nodes)
export function validateMermaidNodeCount(diagram: string): boolean {
  if (!diagram) return true;
  const nodePattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\[({|>]/gm;
  const statePattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
  const nodes = new Set<string>();
  for (const match of diagram.matchAll(nodePattern)) nodes.add(match[1]);
  for (const match of diagram.matchAll(statePattern)) nodes.add(match[1]);
  if (diagram.includes('[*]')) nodes.add('[*]');
  return nodes.size <= 7;
}
