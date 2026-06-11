import type { DossierViewModel, AnalysisStore, DecisionCard } from '@vibe-splain/brain';
import type { Renderer } from './Renderer.js';
import type { Artifact } from '../ArtifactBundleWriter.js';

export class AgentMarkdownRenderer implements Renderer {
  constructor(private budget: number = 8000, private bindings: any | null = null) {}

  render(viewModel: DossierViewModel, store: AnalysisStore): Artifact[] {
    let md = `# Architectural Dossier: ${viewModel.projectRoot}\n\n`;
    
    if (viewModel.map.brief) {
      md += `## Project Brief\n${viewModel.map.brief}\n\n`;
    }

    md += `## Stack & Entrypoints\n`;
    md += `- Stack: ${viewModel.map.stack.join(', ')}\n`;
    md += `- Entrypoints: ${viewModel.map.entrypoints.join(', ')}\n\n`;

    // Flatten decisions
    const allDecisions = viewModel.pillars.flatMap(p => p.decisions).concat(viewModel.wildDiscoveries);
    const uniqueDecisions = new Map<string, DecisionCard>();
    for (const d of allDecisions) {
      if (d.primaryFile && !uniqueDecisions.has(d.primaryFile)) {
        uniqueDecisions.set(d.primaryFile, d);
      }
    }

    const tier1: string[] = [];
    const tier2: string[] = [];
    const tier3: string[] = [];

    // Sort files by gravity
    const sortedFiles = Object.values(store.files)
      .filter(f => f.isRealSource)
      .sort((a, b) => b.gravity - a.gravity);

    for (const f of sortedFiles) {
      const card = uniqueDecisions.get(f.relativePath);
      const isCritical = card && card.severity >= 4;
      
      if (f.gravity >= 70 || isCritical) {
        tier1.push(f.relativePath);
      } else if (f.gravity >= 40 || card) {
        tier2.push(f.relativePath);
      } else {
        tier3.push(f.relativePath);
      }
    }

    md += `## Tier 1: Critical Files & Risks\n\n`;
    for (const path of tier1) {
      const f = store.files[path];
      const card = uniqueDecisions.get(path);
      const recs = viewModel.recommendations[path] || [];

      md += `### ${path}\n`;
      md += `- Gravity: ${Math.round(f.gravity)} | Heat: ${Math.round(f.heat)}\n`;
      md += `- Domain: ${f.productDomain} | Role: ${f.frameworkRole}\n`;
      
      if (card) {
        md += `\n**Verdict**: ${card.thesis}\n`;
        md += `**Severity**: ${card.severity} | **Category**: ${card.category}\n`;
        md += `**Narrative**: ${card.narrative}\n`;
      }

      // Add Function-Level Action Bindings for Tier 1
      if (this.bindings && this.bindings.files[path]) {
        const fileBinding = this.bindings.files[path];
        const criticalFunctions = fileBinding.functions.filter((fn: any) => 
          fn.semanticActions.length > 0 || fn.isEntrypoint
        );

        if (criticalFunctions.length > 0) {
          md += `\n**Critical Functions**:\n`;
          for (const fn of criticalFunctions) {
            md += `- \`${fn.displayName}\` (lines ${fn.startLine}-${fn.endLine})${fn.isEntrypoint ? ' [Entrypoint]' : ''}\n`;
            for (const action of fn.semanticActions) {
              md += `  - **${action.actionKind}**${action.targetModel ? ` on ${action.targetModel}` : ''}: \`${action.calleeText}\` (line ${action.sourceLine})\n`;
            }
          }
        }
      }
      
      if (recs.length > 0) {
        md += `\n**Safe Patch Strategies**:\n`;
        for (const r of recs) {
          md += `- **${r.strategy}**: ${r.description}\n`;
        }
      }
      md += `\n---\n\n`;
    }

    md += `## Tier 2: Important Files\n\n`;
    for (const path of tier2) {
      const f = store.files[path];
      const card = uniqueDecisions.get(path);
      
      md += `- **${path}** (Gravity: ${Math.round(f.gravity)})`;
      if (card) {
        md += ` — ${card.thesis}`;
      }
      md += `\n`;
    }
    md += `\n`;

    md += `## Tier 3: Index\n\n`;
    for (const path of tier3) {
      const f = store.files[path];
      md += `- ${path} (Gravity: ${Math.round(f.gravity)})\n`;
    }

    // In a real robust implementation, we would truncate tiers starting from Tier 3 to fit the budget.
    // Given the simplicity, we'll return the full markdown. 

    return [
      {
        type: 'markdown',
        path: 'dossier.agent.md',
        content: md,
      }
    ];
  }
}
