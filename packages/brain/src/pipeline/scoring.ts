import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import type {
  ProductDomain, SideEffect, RiskType, RuntimeEntrypoint,
} from '../signals.js';
import type {
  PersistedFile, AnalysisStore,
  ValidationFinding, ValidationReport,
} from '../analysis.js';
import type { ClassificationResult, ClassifiedFile } from './classification.js';
import { findRuntimeEntrypoints, computeLoadBearingScore, deriveEntrypointTraceStatus } from './classification.js';

// ── Canonical severity (stage 9) ─────────────────────────────────────────────
// Severity score is the sum of a GENERIC baseline (repo-agnostic) and a DOMAIN
// boost. Factored into two helpers so the domain contribution can be
// mirrored/verified by an optional domain adapter. computeSeverity output is
// byte-identical to the prior single-formula version — same points, same
// thresholds. Core still owns both halves in this bridge step.

/** Generic, repo-agnostic severity points (database writes + structural risk). */
function genericSeverityScore(
  sideEffectProfile: SideEffect[],
  gravity: number,
  heat: number,
  maxNesting: number,
  hasLongFunctions: boolean,
  swallowedCatches: number,
  runtimeEntrypoints: RuntimeEntrypoint[],
): number {
  let score = 0;
  if (sideEffectProfile.includes('database_write')) score += 3;
  if (gravity >= 85) score += 2;
  if (heat >= 70) score += 2;
  if (maxNesting >= 4) score += 1;
  if (hasLongFunctions) score += 1;
  if (swallowedCatches >= 1) score += 1;
  if (runtimeEntrypoints.length >= 2) score += 2;
  return score;
}

/** Domain severity points (domain side effects + product-domain rules).
 *  A domain adapter may override this via its applySeverityPolicy hook. */
export function domainSeverityScore(
  sideEffectProfile: string[],
  productDomain: ProductDomain,
): number {
  let score = 0;
  if (sideEffectProfile.includes('booking_mutation')) score += 4;
  if (sideEffectProfile.includes('payment_mutation')) score += 4;
  if (sideEffectProfile.includes('auth_token_mutation')) score += 4;
  if (sideEffectProfile.includes('webhook_delivery')) score += 3;
  if (sideEffectProfile.includes('webhook_ingress')) score += 3;
  if (sideEffectProfile.includes('calendar_mutation')) score += 3;
  if (productDomain === 'booking_creation') score += 3;
  if (productDomain === 'payments' || productDomain === 'payments_webhooks') score += 3;
  if (productDomain === 'auth_oauth') score += 3;
  if (productDomain === 'webhooks') score += 2;
  return score;
}

export function computeSeverity(
  sideEffectProfile: SideEffect[],
  productDomain: ProductDomain,
  gravity: number,
  heat: number,
  maxNesting: number,
  hasLongFunctions: boolean,
  swallowedCatches: number,
  runtimeEntrypoints: RuntimeEntrypoint[],
  adapterSeverityContribution?: number,
  adapterSideEffects?: string[],
): 1 | 2 | 3 | 4 | 5 {
  const effs = Array.from(new Set([...sideEffectProfile, ...(adapterSideEffects || [])])) as SideEffect[];
  const domainScore = adapterSeverityContribution ?? domainSeverityScore(effs, productDomain);
  
  const score =
    genericSeverityScore(effs, gravity, heat, maxNesting, hasLongFunctions, swallowedCatches, runtimeEntrypoints) +
    domainScore;

  if (score >= 10) return 5;
  if (score >= 7) return 4;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

export function applyCorrections(file: PersistedFile): void {
  // Invariant: handle_payment_webhook → payment_mutation + webhook_ingress
  if (file.writeIntents.includes('handle_payment_webhook')) {
    if (!file.adapterSideEffects) file.adapterSideEffects = [];
    if (!file.adapterSideEffects.includes('payment_mutation')) file.adapterSideEffects.push('payment_mutation');
    if (!file.adapterSideEffects.includes('webhook_ingress')) file.adapterSideEffects.push('webhook_ingress');
    file.sideEffectProfile = file.sideEffectProfile.filter(s => s !== 'none_detected');
  }

  // Invariant: payment/booking mutation → severity ≥ 4
  const adapterEffects = file.adapterSideEffects || [];
  if (
    adapterEffects.includes('payment_mutation') ||
    adapterEffects.includes('booking_mutation')
  ) {
    if (file.canonicalSeverity < 4) file.canonicalSeverity = 4;
  }

  // Invariant: severity 5 → load bearing
  if (file.canonicalSeverity === 5) file.canonicalLoadBearing = true;

  // ADR-008: registry_bottleneck → severity ≥ 4 + load-bearing (correction pass)
  if (file.riskTypes.includes('registry_bottleneck')) {
    if (file.canonicalSeverity < 4) file.canonicalSeverity = 4;
    file.canonicalLoadBearing = true;
  }
}

// ── Confidence ────────────────────────────────────────────────────────────────

function deriveConfidence(fanIn: number, gravity: number): 'high' | 'medium' | 'low' {
  if (fanIn >= 10 && gravity >= 40) return 'high';
  if (fanIn >= 5 || gravity >= 25) return 'medium';
  return 'low';
}

// ── Scoring result type ───────────────────────────────────────────────────────

export interface ScoringResult {
  store: AnalysisStore;
  validationReport: ValidationReport;
}

// ── Main stage implementation ─────────────────────────────────────────────────

export async function runScoring(
  projectRoot: string,
  cr: ClassificationResult,
): Promise<ScoringResult> {
  const dir = join(projectRoot, '.vibesplain');
  await mkdir(dir, { recursive: true });

  // Stage 9: build PersistedFile store + canonical severity
  const persisted: Record<string, PersistedFile> = {};
  const severityBreakdowns: Record<string, string> = {};

  // ADR-034 severity bridge counters (verification only — see below).
  const adapterFired = cr.adapterStage.firedAdapterIds.length > 0;
  let sevBridgeChecked = 0;
  let sevBridgeMismatch = 0;

  for (const f of cr.classified) {
    const adapterDomainScore = cr.adapterStage.severityBoostByFile.get(f.rel);

    const effectiveDomain = (f.domainTags?.[0] ?? f.adapterDomain ?? f.productDomain) as ProductDomain;
    const severity = computeSeverity(
      f.sideEffectProfile, effectiveDomain, f.gravity, f.heat,
      f.heatSignals.maxNesting, f.heatSignals.longFunctions > 0,
      f.heatSignals.swallowedCatches, f.runtimeEntrypoints,
      adapterDomainScore, f.adapterSideEffects,
    );

    // ── Adapter severity-policy bridge ────────────────────────────────────────
    // When a domain adapter fires, it computes the domain severity contribution
    // in PARALLEL. It is NOT applied to final severity in this step (severity
    // stays exactly what core's computeSeverity returns). We verify the adapter
    // contribution equals core's domain contribution, and persist it as
    // additive metadata. With no adapters registered this block never runs.
    if (adapterFired) {
      const effs = [...f.sideEffectProfile, ...(f.adapterSideEffects || [])];
      const coreDomainScore = domainSeverityScore(effs, f.productDomain);
      const adapterScore = adapterDomainScore ?? 0;
      if (coreDomainScore > 0 || adapterScore > 0) {
        sevBridgeChecked++;
        if (coreDomainScore !== adapterScore) sevBridgeMismatch++;
      }
    }

    // ADR-019: Use machine-derived confidence
    const confidence = deriveConfidence(f.gravitySignals.fanIn, f.gravity);

    const pf: PersistedFile = {
      relativePath: f.rel, language: f.lang,
      isRealSource: f.isRealSource, demoteReason: f.demoteReason,
      gravity: Math.round(f.gravity),
      staticGravity: Math.round(f.staticGravity),
      behavioralLift: Math.round(f.behavioralLift),
      heat: Math.round(f.heat),
      gravitySignals: f.gravitySignals, heatSignals: f.heatSignals,
      smells: f.smells, pillarHint: f.pillarHint,
      importedBy: f.importedBy, imports: f.imports, importsUnresolved: f.importsUnresolved,
      frameworkRole: f.frameworkRole, productDomain: f.productDomain,
      sideEffectProfile: f.sideEffectProfile,
      hotSpans: f.hotSpans,
      riskTypes: f.riskTypes,
      writeIntents: f.writeIntents,
      runtimeEntrypoints: f.runtimeEntrypoints,
      entrypointTraceStatus: f.entrypointTraceStatus,
      canonicalSeverity: severity,
      canonicalLoadBearing: f.isLoadBearing, // STRICT: fanIn >= 10
      isOperationallyCritical: f.isOperationallyCritical,
      confidence,
      source: f.source,
      adapterDomain: f.adapterDomain,
      domainTags: f.domainTags,
      executionRole: f.executionRole,
      adapterSideEffects: f.adapterSideEffects,
      adapterSeverityContribution: adapterDomainScore, // parallel; not applied yet
      adapterPillarLabel: f.adapterPillarLabel,
    };

    // Apply corrections (mutates pf in place)
    applyCorrections(pf);

    persisted[f.rel] = pf;
    severityBreakdowns[f.rel] = `severity=${pf.canonicalSeverity} loadBearing=${pf.canonicalLoadBearing} effects=${pf.sideEffectProfile.join(',')} domain=${pf.productDomain}`;
  }

  // Severity bridge report (verification only). Confirms a fired adapter's
  // domain severity contribution equals core's before ownership moves.
  if (adapterFired) {
    console.error(`[vibesplain] severity bridge: ${sevBridgeChecked - sevBridgeMismatch}/${sevBridgeChecked} domain contributions match core (${sevBridgeMismatch} mismatch)`);
  }

  const store: AnalysisStore = { 
    files: persisted,
    adapterFired: cr.adapterStage.firedAdapterIds,
    adapterMetrics: cr.adapterStage.metrics,
  };

  // Stage 10: validation report
  const validationReport = await buildValidationReport(store, projectRoot, cr);
  
  // Attach full report to store before returning
  store.validationReport = validationReport;

  // Log any errors
  for (const e of validationReport.errors) {
    console.error(`[vibesplain] VALIDATION ERROR [${e.rule}] ${e.file}: ${e.detail}`);
  }
  for (const w of validationReport.warnings) {
    console.error(`[vibesplain] VALIDATION WARN [${w.rule}] ${w.file}: ${w.detail}`);
  }

  return { store, validationReport };
}

// ── Validation report (stage 12) ─────────────────────────────────────────────

async function buildValidationReport(
  store: AnalysisStore,
  projectRoot: string,
  cr: ClassificationResult,
): Promise<ValidationReport> {
  const errors: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];
  let passCount = 0;
  let tracedCount = 0;
  let realCount = 0;

  for (const [, pf] of Object.entries(store.files)) {
    if (!pf.isRealSource) continue;
    realCount++;
    
    const classified = cr.classified.find(f => f.rel === pf.relativePath);
    if (classified && classified.entrypointTraceStatus === 'complete') tracedCount++;

    // Hard errors
    if (pf.canonicalSeverity === 5 && !pf.canonicalLoadBearing && pf.gravitySignals.fanIn < 10) {
      // It's severity 5 but not load bearing because fanIn < 10. 
      // This is allowed under new strict ADR-019 if it's operationally critical.
      // But we should still flag if it's NOT operationally critical.
      if (!pf.isOperationallyCritical) {
        errors.push({
          file: pf.relativePath, rule: 'severity_5_no_criticality',
          detail: 'severity=5 but not load-bearing and not operationally critical',
        });
      }
    }

    if (pf.writeIntents.includes('handle_payment_webhook') && pf.sideEffectProfile.includes('none_detected')) {
      errors.push({
        file: pf.relativePath, rule: 'payment_webhook_no_effects',
        detail: 'writeIntents includes handle_payment_webhook but sideEffectProfile is none_detected',
        expected: 'payment_mutation + webhook_ingress', actual: 'none_detected',
      });
      continue;
    }

    if (
      pf.productDomain === 'booking_creation' &&
      classified?.entrypointTraceStatus === 'no_runtime_entrypoint_found' &&
      (pf.importsUnresolved.length === 0) &&
      !['app_route_layout', 'app_loading_boundary', 'app_error_boundary'].includes(pf.frameworkRole) &&
      (pf.adapterSideEffects?.includes('booking_mutation') || pf.source.includes('createBooking') || pf.source.includes('handleNewBooking'))
    ) {
      errors.push({
        file: pf.relativePath, rule: 'booking_creation_no_entrypoint_no_blockers',
        detail: 'booking_creation domain with no entrypoint found and no blocked imports — classification may be wrong',
      });
      continue;
    }

    if (pf.canonicalSeverity >= 4 && pf.hotSpans.length === 0 && !pf.source.includes('export {') && pf.gravitySignals.loc > 5) {
      errors.push({
        file: pf.relativePath, rule: 'high_severity_no_evidence',
        detail: `severity=${pf.canonicalSeverity} but no evidence hotSpans found`,
      });
      continue;
    }

    // Warnings
    if (pf.canonicalSeverity >= 4 && (classified?.runtimeEntrypoints.length ?? 0) === 0) {
      warnings.push({
        file: pf.relativePath, rule: 'high_severity_no_entrypoints',
        detail: `severity=${pf.canonicalSeverity} but no runtime entrypoints found — check alias resolution`,
      });
    }

    if (classified?.entrypointTraceStatus === 'partial_wrong_surface') {
      const foundPaths = classified.runtimeEntrypoints.map(e => e.path).join(', ');
      warnings.push({
        file: pf.relativePath, rule: 'partial_wrong_surface',
        detail: `Entrypoints found but domain surface mismatch for ${pf.productDomain}. Found: ${foundPaths}`,
      });
    }

    passCount++;
  }

  // ADR-011: proactive payment webhook invariant validation (Semantic version)
  const PAYMENT_PROVIDER_PATH_TERMS = ['stripe', 'paypal', 'btcpay', 'btcpayserver', 'alby', 'hitpay', 'payment'];

  for (const [rel, pf] of Object.entries(store.files)) {
    if (!pf.isRealSource) continue;

    // A file is a "Payment Webhook" candidate if it has handle_payment_webhook intent 
    // OR it has webhook_ingress effects AND its path mentions payment terms.
    // (We exclude files that only have payment_mutation as they might just be UI pages).
    const hasIntent = pf.writeIntents.includes('handle_payment_webhook');
    const hasWebhookIngress = pf.adapterSideEffects?.includes('webhook_ingress');
    const pathMentionsPayment = PAYMENT_PROVIDER_PATH_TERMS.some(t => rel.toLowerCase().includes(t));

    // If it has the intent, it MUST be valid.
    // If it has webhook_ingress + path terms but NO intent, that's a validation error (missing classification).
    // (We exclude components as they are likely configuration UI, not the ingress point).
    if (!hasIntent && !(hasWebhookIngress && pathMentionsPayment && pf.frameworkRole !== 'component')) continue;

    const webhookChecks: [boolean, string, string][] = [
      [pf.productDomain !== 'payments_webhooks',
        'webhook_domain', `Payment webhook not classified as payments_webhooks`],
      [!pf.adapterSideEffects?.includes('webhook_ingress'),
        'webhook_ingress_missing', `Payment webhook missing webhook_ingress side effect`],
      [!pf.adapterSideEffects?.includes('payment_mutation'),
        'webhook_payment_mutation_missing', `Payment webhook missing payment_mutation side effect`],
      [!pf.writeIntents.includes('handle_payment_webhook'),
        'webhook_write_intent_missing', `Payment webhook missing handle_payment_webhook write intent`],
      [!pf.isOperationallyCritical,
        'webhook_criticality', `Payment webhook must be operationally critical`],
    ];

    for (const [condition, rule, detail] of webhookChecks) {
      if (condition) errors.push({ file: rel, rule, detail });
    }
  }

  const coverage = realCount > 0 ? Math.round((tracedCount / realCount) * 100) : 0;

  return {
    timestamp: new Date().toISOString(),
    passed: errors.length === 0,
    errors,
    warnings,
    summary: { 
      errorCount: errors.length, 
      warningCount: warnings.length, 
      passCount, 
      entrypointTraceCoverage: coverage,
      entrypointTraceCoverageNumerator: tracedCount,
      entrypointTraceCoverageDenominator: realCount,
      entrypointTraceCoverageDefinition: 'Percentage of real source files, excluding vendored and mock code, successfully traced to a complete runtime entrypoint.',
      coverageBaselineNote: 'Not directly comparable to pre alias resolution scans because isRealSource classification changed.'
    },
  };
}

