import { scanProject, readDossier } from '@vibe-splain/brain';
import type { Dossier } from '@vibe-splain/brain';
import { ExportOrchestrator } from '../../export/ExportOrchestrator.js';
import { startWatcher } from '../../export/Watcher.js';

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

export async function handleScanProject(args: Record<string, unknown>, options: any = {}): Promise<unknown> {
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
    map: { 
      ...result.map, 
      brief,
      validation: result.validation ? {
        passed: result.validation.passed,
        errors: result.validation.errors,
        warnings: result.validation.warnings,
      } : undefined
    },
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

  const scanId = `scan_${Date.now()}`;
  const orchestrator = new ExportOrchestrator(projectRoot);
  const { manifestPointer } = await orchestrator.writeBundle(dossier, {
    format: options.format,
    budget: options.budget ? parseInt(options.budget, 10) : undefined,
    scope: options.scope,
  }, result.store, result.graph, scanId);

  // Watch the real-source files for staleness.
  await startWatcher(projectRoot, result.files.map(f => f.path));

  console.error(`[vibe-splain] Scan complete. ${result.totalFilesScanned} files, ${result.realSourceCount} real-source, ${result.wildCandidates.length} wild candidates.`);

  const validation = result.validation ?? { passed: true, errors: 0, warnings: 0, reportPath: '.vibe-splainer/validation_report.json' };

  let statusMsg = 'Scan complete.';
  if (!validation.passed) {
    statusMsg = `SCAN QUALITY WARNING: ${validation.errors} errors and ${validation.warnings} warnings found in validation report. Delta Engine automation may be blocked.`;
  }

  return {
    ok: true,
    message: statusMsg,
    scanId,
    manifestPointer,
    validation: result.fullValidationReport || {
      passed: validation.passed,
      errors: validation.errors,
      warnings: validation.warnings,
      reportPath: validation.reportPath,
    },
    artifacts: {
      analysis: '.vibe-splainer/analysis.json',
      deltaTargets: '.vibe-splainer/delta_targets.json',
      dossier: '.vibe-splainer/dossier.json',
      graph: '.vibe-splainer/graph.json',
      html: '.vibe-splainer/ui/index.html',
    },
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
