import { type ImportGraph } from '@vibe-splain/brain';
import type { DossierViewModel, AnalysisStore } from '@vibe-splain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class GraphRenderer implements Renderer {
  constructor(private graph?: ImportGraph) {}

  render(_viewModel: DossierViewModel, _store: AnalysisStore): Artifact[] {
    if (!this.graph) return [];
    
    return [
      {
        type: 'graph',
        path: 'graph.json',
        content: JSON.stringify(this.graph, null, 2),
      }
    ];
  }
}
