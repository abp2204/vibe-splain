import { readAnalysis } from '@vibesplain/brain';
import type { Dossier, DossierViewModel, AnalysisStore, ImportGraph } from '@vibesplain/brain';
import { ArtifactBundleWriter, type Artifact } from './ArtifactBundleWriter.js';
import { JsonRenderer } from './renderers/JsonRenderer.js';
import { HtmlRenderer } from './renderers/HtmlRenderer.js';
import { AgentMarkdownRenderer } from './renderers/AgentMarkdownRenderer.js';
import { ValidationRenderer } from './renderers/ValidationRenderer.js';
import { RawAnalysisRenderer } from './renderers/RawAnalysisRenderer.js';
import { GraphRenderer } from './renderers/GraphRenderer.js';

export interface ExportOptions {
  format?: 'json' | 'html' | 'markdown' | 'delta';
  budget?: number;
  scope?: string;
}

export class ExportOrchestrator {
  constructor(private projectRoot: string) {}

  async writeBundle(
    dossier: Dossier,
    options: ExportOptions = {},
    store?: AnalysisStore,
    graph?: ImportGraph,
  ): Promise<void> {
    const finalStore = store || await readAnalysis(this.projectRoot);
    if (!finalStore) {
      throw new Error('Analysis store not found. Scan the project first.');
    }

    // Aggressive Boilerplate Culling
    for (const p of dossier.pillars) {
      p.decisions = p.decisions.filter(c => !(c.severity === 1 && c.category === 'Convention'));
      p.cardCount = p.decisions.length;
    }

    const viewModel = this.buildViewModel(dossier, finalStore);

    const artifacts: Artifact[] = [];

    artifacts.push(...await new JsonRenderer().render(viewModel, finalStore));
    artifacts.push(...await new ValidationRenderer().render(viewModel, finalStore));
    artifacts.push(...await new RawAnalysisRenderer().render(viewModel, finalStore));

    if (graph) {
      artifacts.push(...await new GraphRenderer(graph).render(viewModel, finalStore));
    }

    const formats = ['html', 'markdown'];
    if (options.format && options.format !== 'json' && options.format !== 'delta') {
      formats.length = 0;
      formats.push(options.format);
    }

    if (formats.includes('html')) {
      artifacts.push(...await new HtmlRenderer().render(viewModel, finalStore));
    }

    if (formats.includes('markdown')) {
      artifacts.push(...await new AgentMarkdownRenderer(options.budget).render(viewModel, finalStore));
    }

    const writer = new ArtifactBundleWriter(this.projectRoot);
    await writer.writeBundle(artifacts);
  }

  private buildViewModel(dossier: Dossier, _store: AnalysisStore): DossierViewModel {
    return { ...dossier, recommendations: {} };
  }
}
