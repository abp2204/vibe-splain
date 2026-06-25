import chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { readDossier } from '@vibesplain/brain';
import { ExportOrchestrator } from './ExportOrchestrator.js';

const activeWatchers = new Map<string, chokidar.FSWatcher>();

export async function startWatcher(projectRoot: string, watchedPaths: string[]): Promise<void> {
  // Clean up existing watcher for this project to prevent resource leaks
  const existing = activeWatchers.get(projectRoot);
  if (existing) {
    await existing.close();
    activeWatchers.delete(projectRoot);
  }

  const watcher = chokidar.watch(watchedPaths.length > 0 ? watchedPaths : projectRoot, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.vibesplain/**'],
    persistent: true,
  });

  watcher.on('change', async (filepath) => {
    try {
      const dossier = await readDossier(projectRoot);
      if (!dossier) return;
      
      const content = await readFile(filepath, 'utf8');
      const newHash = createHash('sha256').update(content).digest('hex');
      let mutated = false;
      
      for (const pillar of dossier.pillars) {
        for (const card of pillar.decisions) {
          if (!card.primaryFile) continue;
          const absMatch = filepath === join(projectRoot, card.primaryFile) || filepath.endsWith('/' + card.primaryFile);
          if (absMatch && card.lastScannedHash !== newHash) {
            card.status = 'stale';
            const rel = card.primaryFile;
            if (!dossier.stalePaths.includes(rel)) dossier.stalePaths.push(rel);
            mutated = true;
          }
        }
      }
      
      if (mutated) {
        const orchestrator = new ExportOrchestrator(projectRoot);
        await orchestrator.writeBundle(dossier);
        console.error(`[vibesplain] File changed: ${filepath}. Dossier artifacts updated.`);
      }
    } catch (err) {
      console.error('[vibesplain] Watcher error:', err);
    }
  });

  activeWatchers.set(projectRoot, watcher);
  console.error('[vibesplain] File watcher started');
}
