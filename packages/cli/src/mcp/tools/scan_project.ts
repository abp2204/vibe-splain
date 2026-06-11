import { scanProject, writeDossier, readDossier, startWatcher } from '@vibe-splain/brain';
import type { Dossier } from '@vibe-splain/brain';

export const scanProjectTool = {
  name: 'scan_project',
  description: 'Scans a codebase (TS/JS/Python/Go/Rust/Java) and returns a structural analysis. CALL THIS FIRST, then call get_project_map. Files are scored on two axes: GRAVITY (importance — fan-in + PageRank centrality) and HEAT (smell/tech-debt). Mockups, vendored code, and orphan files are demoted (isRealSource:false) so cards target the real application. After scanning, call get_project_map to get the fixed pillar set, Start-Here (top gravity) and Wild-Discovery (top heat) lists. The uiUrl is a file:// link — share it with the user.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root directory to scan',
      },
    },
    required: ['projectRoot'],
  },
};

export async function handleScanProject(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  if (!projectRoot) throw new Error('projectRoot is required');

  console.error(`[vibe-splain] Scanning project: ${projectRoot}`);
  const result = await scanProject(projectRoot);

  // Preserve any existing cards; replace the structural map every scan.
  const existing = await readDossier(projectRoot);
  const brief = existing?.map?.brief ?? null;

  const dossier: Dossier = {
    version: '2.0.0',
    scannedAt: new Date().toISOString(),
    projectRoot,
    map: { ...result.map, brief },
    pillars: existing?.pillars ?? [],
    wildDiscoveries: existing?.wildDiscoveries ?? [],
    stalePaths: existing?.stalePaths ?? [],
  };

  // Seed empty pillar buckets from the fixed graph-derived pillar set.
  for (const def of result.map.pillars) {
    if (!dossier.pillars.find(p => p.name === def.name)) {
      dossier.pillars.push({ name: def.name, cardCount: 0, decisions: [] });
    }
  }

  await writeDossier(projectRoot, dossier);

  // Watch the real-source files for staleness.
  startWatcher(projectRoot, result.files.map(f => f.path));

  console.error(`[vibe-splain] Scan complete. ${result.totalFilesScanned} files, ${result.realSourceCount} real-source, ${result.wildCandidates.length} wild candidates.`);

  return {
    projectRoot: result.projectRoot,
    totalFilesScanned: result.totalFilesScanned,
    realSourceCount: result.realSourceCount,
    stack: result.map.stack,
    entrypoints: result.map.entrypoints,
    pillars: result.map.pillars.map(p => ({ name: p.name, fileCount: p.memberFiles.length })),
    startHere: result.map.topGravity,
    wildDiscoveryCandidates: result.wildCandidates.map(f => ({
      relativePath: f.relativePath,
      heat: Math.round(f.heat),
      gravity: Math.round(f.gravity),
      topSmells: f.smells.filter(s => s.severity >= 3).slice(0, 3).map(s => s.note),
    })),
    nextStep: 'Call get_project_map, write a project brief via set_project_brief, THEN write cards starting from the Start-Here files.',
    uiUrl: result.uiUrl,
  };
}
