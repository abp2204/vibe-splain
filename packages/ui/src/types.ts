export interface Evidence {
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface DecisionCard {
  id: string;
  pillar: string;
  title: string;
  narrative: string;
  evidence: Evidence[];
  diagram: string | null;
  status: 'fresh' | 'stale';
  lastScannedHash: string;
}

export interface Pillar {
  name: string;
  cardCount: number;
  decisions: DecisionCard[];
}

export interface Dossier {
  version: string;
  scannedAt: string;
  projectRoot: string;
  pillars: Pillar[];
  wildDiscoveries: DecisionCard[];
  stalePaths: string[];
}

declare global {
  interface Window {
    __VIBE_DOSSIER__: Dossier;
  }
}
