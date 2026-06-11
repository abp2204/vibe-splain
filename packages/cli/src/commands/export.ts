import { readDossier } from '@vibe-splain/brain';
import { ExportOrchestrator } from '../export/ExportOrchestrator.js';

export async function exportCommand(projectRoot: string, options: any): Promise<void> {
  const root = projectRoot || process.cwd();
  console.error(`[vibe-splain] Exporting dossier for ${root}`);

  const dossier = await readDossier(root);
  if (!dossier) {
    console.error('[vibe-splain] Dossier not found. Run scan first.');
    process.exit(1);
  }

  const orchestrator = new ExportOrchestrator(root);
  await orchestrator.writeBundle(dossier, {
    format: options.format,
    budget: options.budget ? parseInt(options.budget, 10) : undefined,
    scope: options.scope,
  });

  console.error('[vibe-splain] Export complete.');
}
