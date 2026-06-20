import type { Dossier, DossierViewModel, AnalysisStore } from '@vibe-splain/brain';
import type { Artifact } from '../ArtifactBundleWriter.js';

export interface Renderer {
  render(viewModel: DossierViewModel, store: AnalysisStore): Promise<Artifact[]> | Artifact[];
}
