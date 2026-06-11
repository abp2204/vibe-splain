import { Mutex } from 'async-mutex';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile, mkdir, cp } from 'fs/promises';
import { existsSync, cpSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Types
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

const dossierMutex = new Mutex();

export async function readDossier(projectRoot: string): Promise<Dossier | null> {
  const dossierPath = join(projectRoot, '.vibe-splainer', 'dossier.json');
  try {
    const raw = await readFile(dossierPath, 'utf8');
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}

export async function writeDossier(projectRoot: string, dossier: Dossier): Promise<void> {
  await dossierMutex.runExclusive(async () => {
    const dir = join(projectRoot, '.vibe-splainer');
    await mkdir(dir, { recursive: true });
    const dossierPath = join(dir, 'dossier.json');
    const tmp = dossierPath + '.tmp';
    await writeFile(tmp, JSON.stringify(dossier, null, 2), 'utf8');
    // Atomic rename on POSIX
    const { rename } = await import('fs/promises');
    await rename(tmp, dossierPath);
    // ALWAYS regenerate UI after every write
    await regenerateUI(projectRoot, dossier);
  });
}

export async function regenerateUI(projectRoot: string, dossier: Dossier): Promise<void> {
  const uiDir = join(projectRoot, '.vibe-splainer', 'ui');
  await mkdir(uiDir, { recursive: true });

  // Template index.html lives in CLI's dist/ui (built from packages/ui)
  // When running from brain package, we go: brain/dist -> cli/dist/ui
  const templateDir = join(__dirname, '../../cli/dist/ui');
  
  if (!existsSync(templateDir)) {
    console.error('[vibe-splain] UI template not found at', templateDir, '- skipping UI regeneration');
    return;
  }

  // Copy all assets (JS, CSS chunks) from template to project's .vibe-splainer/ui
  cpSync(templateDir, uiDir, { recursive: true });

  // Read the template index.html
  let html = await readFile(join(templateDir, 'index.html'), 'utf8');
  
  // Inject dossier data as inline script BEFORE closing </head>
  const injection = `<script>window.__VIBE_DOSSIER__ = ${JSON.stringify(dossier)};</script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  
  // Write the data-baked index.html to the project's ui dir
  await writeFile(join(uiDir, 'index.html'), html, 'utf8');
  console.error('[vibe-splain] UI regenerated at', join(uiDir, 'index.html'));
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
