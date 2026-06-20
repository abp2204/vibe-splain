// Escalation context builder — the deterministic core of the PreToolUse gate.
//
// Given the single file the frontier agent is about to edit, this reads that
// file's record from the gate index and produces a surgical-context block:
// blast radius, the exact list of dependents that would break, and risk
// warnings. No model. No network. No adapter dependency.

import type { SideEffect, RiskType } from '../signals.js';
import { type GateIndex, type GateIndexEntry, isDenoisedImporter } from './gateIndex.js';

export type BlastRadius = 'low' | 'medium' | 'high';

export interface EscalationRiskWarning {
  id: string;
  level: 'info' | 'warning' | 'critical';
  message: string;
  reason: string;
}

export interface SafeChangePolicy {
  summary: string;
  rules: string[];
  forbiddenEditClasses: string[];
}

export interface EscalationContext {
  targetFile: string;        // the file the agent is about to edit (rel path)
  gravity: number;           // 0..100 composite (already includes any adapter lift)
  blastRadius: BlastRadius;  // derived from gravity
  dependents: string[];      // importedBy — the files that break if this changes
  dependentCount: number;
  fanIn: number;             // real-source importers
  fanOut: number;            // distinct modules this file imports
  centrality: number;        // 0..1 PageRank
  severity: 1 | 2 | 3 | 4 | 5;
  sideEffects: SideEffect[];
  riskTypes: RiskType[];
  riskWarnings: EscalationRiskWarning[];
  smallestSafeChange: SafeChangePolicy;
}

// Security heuristic. Path/identifier match is language- and product-agnostic.
const SECURITY_PATH = /\b(auth|credential|secret|token|webhook|payment|password|oauth|session)\b/i;

// Universal write/side-effect classes worth flagging.
const SENSITIVE_EFFECTS: ReadonlySet<SideEffect> = new Set<SideEffect>([
  'database_write', 'server_action', 'trpc_mutation', 'email_send', 'external_api_call',
]);

// RiskTypes that change how surgically the agent must edit.
const NOTABLE_RISKS: ReadonlySet<RiskType> = new Set<RiskType>([
  'state_machine', 'mutation_orchestration', 'side_effect_coupling',
  'async_race_risk', 'registry_bottleneck', 'error_swallowing',
]);

/**
 * Look up the target file in the gate index and build its escalation context.
 * Returns null when the file is not in the index (e.g. a brand-new file).
 */
export function buildEscalationContext(
  targetFile: string,
  gateIndex: GateIndex,
): EscalationContext | null {
  const file = lookupFile(targetFile, gateIndex);
  if (!file) return null;

  const rel = file.relativePath;
  const gravity = file.gravity;
  const dependents = file.dependents;
  const dependentsCount = dependents.length;
  const sideEffects = file.sideEffects;
  const riskTypes = file.riskTypes;
  const severity = file.severity;

  // 1. Calculate gravity tier
  const gravity_tier: BlastRadius = gravity > 70 ? 'high' : (gravity > 40 ? 'medium' : 'low');

  // 2. Calculate raw substance tier
  const raw_substance_tier: BlastRadius =
    file.hasBehavioralSubstance && dependentsCount >= 10
      ? 'high'
      : (file.hasBehavioralSubstance && dependentsCount >= 4 ? 'medium' : 'low');

  // 3. Determine base blast radius by taking the max of gravity_tier and raw_substance_tier
  const tierOrder: Record<BlastRadius, number> = { low: 1, medium: 2, high: 3 };
  let blastRadius: BlastRadius = tierOrder[gravity_tier] >= tierOrder[raw_substance_tier] ? gravity_tier : raw_substance_tier;

  // 4. Force low blast radius if the file itself is generated/vendored
  const isGeneratedOrVendored =
    !isDenoisedImporter(targetFile) ||
    (file.demoteReason !== null && file.demoteReason !== 'no inbound references from application code');

  if (isGeneratedOrVendored) {
    blastRadius = 'low';
  }

  const riskWarnings = buildRiskWarnings(rel, gravity, dependentsCount, severity, sideEffects, riskTypes);

  return {
    targetFile: rel,
    gravity,
    blastRadius,
    dependents,
    dependentCount: dependentsCount,
    fanIn: file.fanIn,
    fanOut: file.fanOut,
    centrality: file.centrality,
    severity,
    sideEffects,
    riskTypes,
    riskWarnings,
    smallestSafeChange: buildSafeChangePolicy(blastRadius),
  };
}

// Resolve the agent-provided path against the index's file keys.
function lookupFile(targetFile: string, gateIndex: GateIndex): GateIndexEntry | null {
  const files = gateIndex?.files;
  if (!files) return null;

  const norm = targetFile.replace(/\\/g, '/');
  if (files[norm]) return files[norm];

  // suffix match (absolute path → repo-relative key)
  const suffixHits: GateIndexEntry[] = [];
  for (const [key, rec] of Object.entries(files)) {
    if (norm === key || norm.endsWith('/' + key) || key.endsWith('/' + norm)) {
      suffixHits.push(rec);
    }
  }
  return suffixHits.length === 1 ? suffixHits[0] : null;
}

function buildRiskWarnings(
  rel: string,
  gravity: number,
  dependentCount: number,
  severity: number,
  sideEffects: SideEffect[],
  riskTypes: RiskType[],
): EscalationRiskWarning[] {
  const warnings: EscalationRiskWarning[] = [];

  if (gravity > 70) {
    warnings.push({
      id: `rw_${rel}_blast_radius`,
      level: 'critical',
      message: `Central file — editing it has a large blast radius. ${dependentCount} file(s) depend on it.`,
      reason: `Gravity ${gravity}/100; fan-in ${dependentCount}.`,
    });
  }

  if (severity >= 4) {
    warnings.push({
      id: `rw_${rel}_severity`,
      level: 'warning',
      message: 'High-severity smells already present here. Avoid making them worse.',
      reason: `Canonical severity ${severity}/5.`,
    });
  }

  if (SECURITY_PATH.test(rel)) {
    warnings.push({
      id: `rw_${rel}_security_path`,
      level: 'critical',
      message: 'Security-sensitive file (auth/credential/webhook/payment). Do not alter auth or credential handling unless that is the explicit task.',
      reason: `Path matches security-sensitive pattern.`,
    });
  }

  const sensitive = sideEffects.filter(e => SENSITIVE_EFFECTS.has(e));
  if (sensitive.length > 0) {
    warnings.push({
      id: `rw_${rel}_side_effects`,
      level: 'warning',
      message: `This file performs side effects (${sensitive.join(', ')}). Preserve existing behavior; do not drop or reorder them.`,
      reason: `Side-effect profile: ${sensitive.join(', ')}.`,
    });
  }

  const notable = riskTypes.filter(r => NOTABLE_RISKS.has(r));
  if (notable.length > 0) {
    warnings.push({
      id: `rw_${rel}_risk_types`,
      level: 'info',
      message: `Structural risk patterns detected (${notable.join(', ')}). Trace the affected paths before editing.`,
      reason: `Risk types: ${notable.join(', ')}.`,
    });
  }

  return warnings;
}

function buildSafeChangePolicy(blastRadius: BlastRadius): SafeChangePolicy {
  const rules = [
    'Locate the exact failure site before editing.',
    'Make the smallest localized change that addresses the task.',
    'Do not perform general cleanup or refactoring.',
    'Do not modify unrelated files, credentials, or auth configuration.',
  ];
  if (blastRadius === 'high') {
    rules.push('This file is load-bearing: verify each dependent still type-checks against the changed surface.');
  }
  return {
    summary: 'Make the smallest localized change that addresses the requested task. Do not modify unrelated files, credentials, auth configuration, or neighboring modules unless the task explicitly requires it.',
    rules,
    forbiddenEditClasses: ['credentials', 'auth_configuration', 'global_refactoring'],
  };
}
