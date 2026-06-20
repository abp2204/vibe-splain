import type { RiskType, SideEffect, ProductDomain } from '../signals.js';
import type { PersistedFile } from '../analysis.js';

export interface Recommendation {
  strategy: string;
  description: string;
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
}

function getEffortValue(effort: 'low' | 'medium' | 'high'): number {
  if (effort === 'low') return 1;
  if (effort === 'medium') return 2;
  return 3;
}

function getImpactValue(impact: 'low' | 'medium' | 'high'): number {
  if (impact === 'low') return 1;
  if (impact === 'medium') return 2;
  return 3;
}

export class RecommendationEngine {
  public static generateRecommendations(
    file: PersistedFile
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Map risk types to recommendations
    if (file.riskTypes.includes('mutation_orchestration')) {
      recommendations.push({
        strategy: 'Extract Decision Logic',
        description: 'Do not rewrite inline. Extract pure decision logic into a tested reducer or state machine first. Preserve all side-effect call sites (redirect URLs, SDK event names, response shapes) as invariants.',
        effort: 'high',
        impact: 'high',
      });
    }

    if (file.riskTypes.includes('registry_bottleneck')) {
      recommendations.push({
        strategy: 'Append-Only Registry Updates',
        description: 'Add new entries without removing existing keys. Treat the registry map as append-only until all consumers are verified.',
        effort: 'low',
        impact: 'medium',
      });
    }

    if (file.riskTypes.includes('registry_consumer')) {
      recommendations.push({
        strategy: 'Verify Registry Contract',
        description: 'Verify the registry contract before patching. Changes to field types must be reflected in both the registry and all rendering paths.',
        effort: 'medium',
        impact: 'low',
      });
    }

    if (file.riskTypes.includes('route_handler_write_path')) {
      recommendations.push({
        strategy: 'Integration Testing First',
        description: 'Add integration tests covering success and failure paths before modifying. Verify HTTP status codes and response shapes are preserved.',
        effort: 'medium',
        impact: 'high',
      });
    }

    if (file.riskTypes.includes('god_component') || file.riskTypes.includes('god_hook')) {
      recommendations.push({
        strategy: 'Extract Sub-Concerns',
        description: 'Extract sub-concerns into separate modules first. Only refactor the extraction points after tests confirm equivalence.',
        effort: 'high',
        impact: 'high',
      });
    }
    
    // Map side effects to recommendations
    if (file.sideEffectProfile.includes('database_write')) {
      recommendations.push({
        strategy: 'Feature Flags & Staging',
        description: 'Wrap changes in a transaction or use a feature flag. Run against a staging database before production.',
        effort: 'medium',
        impact: 'high',
      });
    }

    // Default if none matched but there are high gravity signals
    if (recommendations.length === 0 && file.importedBy.length >= 5) {
      recommendations.push({
        strategy: 'Review Blast Radius',
        description: 'Review importedBy before patching. Run affected integration tests.',
        effort: 'medium',
        impact: 'medium',
      });
    }

    // Sort recommendations by impact/effort ratio (highest impact for lowest effort first)
    recommendations.sort((a, b) => {
      const ratioA = getImpactValue(a.impact) / getEffortValue(a.effort);
      const ratioB = getImpactValue(b.impact) / getEffortValue(b.effort);
      return ratioB - ratioA;
    });

    return recommendations;
  }
}
