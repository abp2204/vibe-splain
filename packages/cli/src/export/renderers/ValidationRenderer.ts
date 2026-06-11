import type { DossierViewModel, AnalysisStore } from '@vibe-splain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class ValidationRenderer implements Renderer {
  render(viewModel: DossierViewModel, _store: AnalysisStore): Artifact[] {
    if (!viewModel.map.validation) return [];

    return [
      {
        type: 'validation',
        path: 'validation_report.json',
        content: JSON.stringify(viewModel.map.validation, null, 2),
      }
    ];
  }
}
