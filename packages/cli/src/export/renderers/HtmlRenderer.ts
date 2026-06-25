import { join, dirname, relative, basename } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import type { DossierViewModel, AnalysisStore } from '@vibesplain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = readdirSync(dirPath);

  files.forEach(function(file) {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

export class HtmlRenderer implements Renderer {
  render(viewModel: DossierViewModel, _store: AnalysisStore): Artifact[] {
    // Robust template resolution for bundled/unbundled environments
    const candidatePaths = [
      join(__dirname, 'ui'),                      // bundled: dist/index.js -> dist/ui
      join(__dirname, '..', '..', 'ui'),           // unbundled: dist/export/renderers -> dist/ui
      join(__dirname, '..', 'ui'),                 // alt bundle
      join(__dirname, '..', '..', '..', 'ui', 'dist'), // dev: packages/cli/src/export/renderers -> packages/ui/dist
      join(__dirname, '..', '..', 'packages', 'ui', 'dist'), // repo root -> packages/ui/dist
    ];

    let templateDir = '';
    for (const p of candidatePaths) {
      if (existsSync(p) && existsSync(join(p, 'index.html'))) {
        // Double check it's not the source packages/ui (which has vite.config.ts)
        // We want the BUILT UI in the dist folder.
        if (!existsSync(join(p, 'vite.config.ts')) || p.endsWith('dist')) {
          templateDir = p;
          break;
        }
      }
    }
    
    // Fallback to any 'ui' folder that has index.html as a last resort
    if (!templateDir) {
      for (const p of candidatePaths) {
        if (existsSync(join(p, 'index.html'))) {
          templateDir = p;
          break;
        }
      }
    }
    
    if (!templateDir) {
      console.error('[vibesplain] UI template not found. Checked:', candidatePaths);
      return [];
    }

    const artifacts: Artifact[] = [];
    const allFiles = getAllFiles(templateDir);
    
    for (const file of allFiles) {
      const relPath = relative(templateDir, file);
      
      if (relPath === 'index.html') {
        const templateHtml = readFileSync(file, 'utf8');
        const injection = `<script>window.__VIBE_DOSSIER__ = ${JSON.stringify(viewModel)};</script>`;
        const bakedHtml = templateHtml.replace('<!-- VIBE_DOSSIER_INJECTION_POINT -->', injection);
        
        artifacts.push({
          type: 'html',
          path: join('ui', relPath),
          content: bakedHtml,
        });
      } else {
        artifacts.push({
          type: 'asset',
          path: join('ui', relPath),
          content: readFileSync(file),
        });
      }
    }

    return artifacts;
  }
}
