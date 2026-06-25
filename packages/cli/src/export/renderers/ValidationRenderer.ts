import type { DossierViewModel, AnalysisStore } from '@vibesplain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class ValidationRenderer implements Renderer {
  render(viewModel: DossierViewModel, store: AnalysisStore): Artifact[] {
    const report = store.validationReport || viewModel.map.validation;
    if (!report) return [];

    return [
      {
        type: 'validation',
        path: 'validation_report.json',
        content: JSON.stringify(report, null, 2),
      }
    ];
  }
}
