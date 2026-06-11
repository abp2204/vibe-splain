import chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { readDossier, writeDossier } from './dossier.js';

export function startWatcher(projectRoot: string, watchedPaths: string[]): void {
  const watcher = chokidar.watch(watchedPaths.length > 0 ? watchedPaths : projectRoot, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.vibe-splainer/**'],
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
          // Match on primaryFile (relative), compare against the per-primaryFile hash stored at write time.
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
      if (mutated) await writeDossier(projectRoot, dossier);
    } catch (err) {
      console.error('[vibe-splain] Watcher error:', err);
    }
  });

  console.error('[vibe-splain] File watcher started');
}
