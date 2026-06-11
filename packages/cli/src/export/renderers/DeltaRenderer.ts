import type { DossierViewModel, AnalysisStore } from '@vibe-splain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class DeltaRenderer implements Renderer {
  render(_viewModel: DossierViewModel, store: AnalysisStore): Artifact[] {
    const deltaTargets = Object.values(store.files)
      .filter(pf => pf.isRealSource)
      .sort((a, b) => b.gravity - a.gravity)
      .map(pf => ({
        path: pf.relativePath,
        gravity: Math.round(pf.gravity),
        isLoadBearing: pf.canonicalLoadBearing,
        blastRadius: pf.importedBy,
        pillarHint: pf.pillarHint,
      }));

    return [
      {
        type: 'delta',
        path: 'delta_targets.json',
        content: JSON.stringify(deltaTargets, null, 2),
      }
    ];
  }
}
