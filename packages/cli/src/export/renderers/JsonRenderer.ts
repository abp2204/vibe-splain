import type { DossierViewModel, AnalysisStore } from '@vibesplain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class JsonRenderer implements Renderer {
  render(viewModel: DossierViewModel, _store: AnalysisStore): Artifact[] {
    return [
      {
        type: 'dossier',
        path: 'dossier.json',
        content: JSON.stringify(viewModel, null, 2),
      }
    ];
  }
}
