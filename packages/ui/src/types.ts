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
  // v2 fields — all optional so v1 dossiers still render.
  thesis?: string;
  category?: CardCategory;
  severity?: 1 | 2 | 3 | 4 | 5;
  narrative: string;
  tradeoff?: string | null;
  blastRadius?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  evidence: Evidence[];
  diagram: string | null;
  gravity?: number;
  heat?: number;
  primaryFile?: string;
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
  stack: string[];
  entrypoints: string[];
  pillars: PillarDef[];
  fileCount: number;
  realSourceCount: number;
  topGravity: string[];
  topHeat: string[];
  brief: string | null;
  validation?: {
    passed: boolean;
    errors: number;
    warnings: number;
  };
}

export interface Dossier {
  version: string;
  scannedAt: string;
  projectRoot: string;
  map?: ProjectMap;       // optional — v1 dossiers lack it
  pillars: Pillar[];
  wildDiscoveries: DecisionCard[];
  stalePaths: string[];
}

declare global {
  interface Window {
    __VIBE_DOSSIER__: Dossier;
  }
}
