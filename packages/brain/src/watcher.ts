import chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
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
          if (card.evidence.some(e => e.file === filepath || filepath.endsWith(e.file))) {
            if (card.lastScannedHash !== newHash) {
              card.status = 'stale';
              if (!dossier.stalePaths.includes(filepath)) dossier.stalePaths.push(filepath);
              mutated = true;
            }
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
