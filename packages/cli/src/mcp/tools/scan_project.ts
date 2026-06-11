import { scanProject, writeDossier, readDossier, startWatcher } from '@vibe-splain/brain';
import type { Dossier } from '@vibe-splain/brain';

export const scanProjectTool = {
  name: 'scan_project',
  description: 'Scans a codebase and returns its structural analysis. CALL THIS FIRST before any other tool. Returns High-Gravity files grouped by pillar, plus wildCandidates for unusual high-complexity files. After calling this tool, call get_file_context for each file in highGravityFiles, synthesize a narrative explaining WHY that code exists, then call write_decision_card to persist it. The uiUrl in the response is a file:// link — share it with the user so they can open the Dossier UI in their browser.',
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

  // Create initial dossier structure
  const existingDossier = await readDossier(projectRoot);
  const dossier: Dossier = existingDossier || {
    version: '1.0.0',
    scannedAt: new Date().toISOString(),
    projectRoot,
    pillars: [],
    wildDiscoveries: [],
    stalePaths: [],
  };

  // Update scan timestamp
  dossier.scannedAt = new Date().toISOString();

  // Create pillar entries from scan results
  for (const group of result.pillarGroups) {
    const existingPillar = dossier.pillars.find(p => p.name === group.name);
    if (!existingPillar) {
      dossier.pillars.push({ name: group.name, cardCount: 0, decisions: [] });
    }
  }

  await writeDossier(projectRoot, dossier);

  // Start file watcher on high-gravity files
  const watchPaths = result.highGravityFiles.map(f => f.path);
  startWatcher(projectRoot, watchPaths);

  console.error(`[vibe-splain] Scan complete. ${result.totalFilesScanned} files scanned, ${result.highGravityFiles.length} high-gravity files found.`);

  return {
    projectRoot: result.projectRoot,
    totalFilesScanned: result.totalFilesScanned,
    highGravityFiles: result.highGravityFiles.map(f => ({
      relativePath: f.relativePath,
      cognitiveWeight: f.cognitiveWeight,
      pillars: f.pillars,
    })),
    pillarGroups: result.pillarGroups.map(g => ({
      name: g.name,
      fileCount: g.files.length,
      files: g.files.map(f => f.relativePath),
    })),
    wildCandidates: result.wildCandidates.map(f => ({
      relativePath: f.relativePath,
      cognitiveWeight: f.cognitiveWeight,
    })),
    uiUrl: result.uiUrl,
  };
}
