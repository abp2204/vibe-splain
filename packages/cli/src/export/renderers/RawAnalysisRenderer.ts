import type { DossierViewModel, AnalysisStore } from '@vibesplain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class RawAnalysisRenderer implements Renderer {
  render(_viewModel: DossierViewModel, store: AnalysisStore): Artifact[] {
    return [
      {
        type: 'analysis',
        path: 'analysis.json',
        content: JSON.stringify(store, null, 2),
      }
    ];
  }
}
