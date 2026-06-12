import { join } from 'path';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import type {
  ProductDomain, SideEffect, RiskType, RuntimeEntrypoint,
} from '../signals.js';
import type {
  PersistedFile, AnalysisStore, DeltaTarget,
  ObservableOutput, WriteIntent, PatchRisk, TestProbe, RawEvidence, DisplayEvidence,
  ValidationFinding, ValidationReport,
} from '../analysis.js';
import type { ClassificationResult, ClassifiedFile } from './classification.js';
import { findRuntimeEntrypoints, computeLoadBearingScore, deriveEntrypointTraceStatus } from './classification.js';

// ── Canonical severity (stage 9) ─────────────────────────────────────────────

export function computeSeverity(
  sideEffectProfile: SideEffect[],
  productDomain: ProductDomain,
  gravity: number,
  heat: number,
  maxNesting: number,
  hasLongFunctions: boolean,
  swallowedCatches: number,
  runtimeEntrypoints: RuntimeEntrypoint[],
): 1 | 2 | 3 | 4 | 5 {
  let score = 0;

  if (sideEffectProfile.includes('database_write')) score += 3;
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

  if (gravity >= 85) score += 2;
  if (heat >= 70) score += 2;
  if (maxNesting >= 4) score += 1;
  if (hasLongFunctions) score += 1;
  if (swallowedCatches >= 1) score += 1;
  if (runtimeEntrypoints.length >= 2) score += 2;

  if (score >= 10) return 5;
  if (score >= 7) return 4;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

export function applyCorrections(file: PersistedFile): void {
  // Invariant: handle_payment_webhook → payment_mutation + webhook_ingress
  if (file.writeIntents.includes('handle_payment_webhook')) {
    if (!file.sideEffectProfile.includes('payment_mutation')) file.sideEffectProfile.push('payment_mutation');
    if (!file.sideEffectProfile.includes('webhook_ingress')) file.sideEffectProfile.push('webhook_ingress');
    file.sideEffectProfile = file.sideEffectProfile.filter(s => s !== 'none_detected');
  }

  // Invariant: payment/booking mutation → severity ≥ 4
  if (
    file.sideEffectProfile.includes('payment_mutation') ||
    file.sideEffectProfile.includes('booking_mutation')
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

// ── Observable outputs ────────────────────────────────────────────────────────

function inferObservableOutputs(
  frameworkRole: import('../signals.js').FrameworkRole,
  productDomain: ProductDomain,
  sideEffectProfile: SideEffect[],
): ObservableOutput[] {
  const outputs: ObservableOutput[] = [];
  const ENTRYPOINT_ROLES = new Set(['app_route_page', 'app_route_handler', 'pages_route', 'pages_api_route', 'trpc_api_route']);

  if (sideEffectProfile.includes('redirect')) outputs.push('redirect_url');
  if (ENTRYPOINT_ROLES.has(frameworkRole)) outputs.push('http_status');
  if (frameworkRole === 'app_route_handler' || frameworkRole === 'pages_api_route') {
    outputs.push('json_response_shape');
  }
  if (productDomain === 'booking_creation' || productDomain === 'booking_management') outputs.push('booking_uid');
  if (productDomain === 'payments' || productDomain === 'payments_webhooks') outputs.push('payment_status');
  if (productDomain === 'auth_oauth') outputs.push('auth_token');
  if (sideEffectProfile.includes('webhook_delivery') || sideEffectProfile.includes('webhook_ingress')) {
    outputs.push('webhook_payload');
  }
  if (sideEffectProfile.includes('calendar_mutation')) outputs.push('calendar_event_id');
  if (sideEffectProfile.includes('email_send')) outputs.push('email_payload');
  if (sideEffectProfile.includes('analytics_event')) outputs.push('sdk_event_name');
  if (frameworkRole === 'hook' || frameworkRole === 'store') outputs.push('ui_state_transition');

  // ADR-009: data_table context providers expose workflow state outputs
  if (productDomain === 'data_table' && frameworkRole === 'provider') {
    outputs.push('ui_state_transition', 'filter_state', 'selected_segment');
  }

  return [...new Set(outputs)];
}

// ── Patch risk ────────────────────────────────────────────────────────────────

function inferPatchRisk(
  productDomain: ProductDomain,
  riskTypes: RiskType[],
  sideEffectProfile: SideEffect[],
  importedByCount: number,
  loadBearingScore: number,
): PatchRisk {
  if (loadBearingScore >= 12 || (productDomain === 'booking_creation' && riskTypes.includes('mutation_orchestration'))) {
    return {
      level: 'critical',
      reason: `${productDomain} domain with ${riskTypes.join(', ')} — any patch risks breaking live booking, payment, or auth flows.`,
    };
  }
  if (loadBearingScore >= 8 || sideEffectProfile.includes('payment_mutation') || sideEffectProfile.includes('auth_token_mutation')) {
    const external = sideEffectProfile.filter(s => ['payment_mutation', 'auth_token_mutation', 'database_write', 'webhook_delivery'].includes(s));
    return {
      level: 'high',
      reason: `${productDomain} writes to external state (${external.join(', ') || 'database'}). Changes require integration testing.`,
    };
  }
  // ADR-008: registry_bottleneck → high floor
  if (riskTypes.includes('registry_bottleneck')) {
    return {
      level: 'high',
      reason: 'registry_bottleneck: central dispatch point — blast radius not measurable by fan-in alone.',
    };
  }

  if (loadBearingScore >= 5 || importedByCount >= 5) {
    return { level: 'medium', reason: `Imported by ${importedByCount} files. Interface changes will cascade.` };
  }

  // ADR-009: data_table state machine → medium floor
  if (productDomain === 'data_table' && riskTypes.includes('state_machine')) {
    return {
      level: 'medium',
      reason: 'data_table state machine: controls user-visible workflow state (filters, segments, pagination) — regression risk not captured by mutation scoring.',
    };
  }

  return { level: 'low', reason: 'Locally contained — limited blast radius.' };
}

// ── Safe patch strategy ────────────────────────────────────────────────────────

function inferSafePatchStrategy(riskTypes: RiskType[], sideEffectProfile: SideEffect[]): string {
  if (riskTypes.includes('mutation_orchestration')) {
    return 'Do not rewrite inline. Extract pure decision logic into a tested reducer or state machine first. Preserve all side-effect call sites (redirect URLs, SDK event names, response shapes) as invariants.';
  }
  if (riskTypes.includes('registry_bottleneck')) {
    return 'Add new entries without removing existing keys. Treat the registry map as append-only until all consumers are verified.';
  }
  if (riskTypes.includes('registry_consumer')) {
    return 'Verify the registry contract (Components.tsx) before patching. Changes to field types must be reflected in both the registry and all rendering paths.';
  }
  if (riskTypes.includes('route_handler_write_path')) {
    return 'Add integration tests covering success and failure paths before modifying. Verify HTTP status codes and response shapes are preserved.';
  }
  if (riskTypes.includes('god_component') || riskTypes.includes('god_hook')) {
    return 'Extract sub-concerns into separate modules first. Only refactor the extraction points after tests confirm equivalence.';
  }
  if (sideEffectProfile.includes('database_write')) {
    return 'Wrap changes in a transaction or use a feature flag. Run against a staging database before production.';
  }
  return 'Review importedBy before patching. Run affected integration tests.';
}

// ── Do-not-touch ──────────────────────────────────────────────────────────────

function inferDoNotTouch(sideEffectProfile: SideEffect[], productDomain: ProductDomain): string[] {
  const items: string[] = [];
  if (sideEffectProfile.includes('payment_mutation')) items.push('payment flow branch');
  if (sideEffectProfile.includes('auth_token_mutation')) items.push('token issuance / refresh branch');
  if (sideEffectProfile.includes('webhook_delivery') || sideEffectProfile.includes('webhook_ingress')) {
    items.push('webhook payload shape');
  }
  if (sideEffectProfile.includes('redirect')) items.push('redirect URL strings');
  if (sideEffectProfile.includes('analytics_event')) items.push('SDK event names');
  if (sideEffectProfile.includes('booking_mutation')) {
    items.push('booking success response shape', 'recurring booking branch');
  }
  if (productDomain === 'auth_oauth') items.push('OAuth callback URLs', 'token scopes');
  return items;
}

// ── Test probes ───────────────────────────────────────────────────────────────

function inferTestProbes(writeIntents: WriteIntent[], observableOutputs: ObservableOutput[]): TestProbe[] {
  const probes: TestProbe[] = [];
  if (writeIntents.includes('create_booking')) {
    probes.push({
      name: 'standard booking success',
      scenario: 'create a standard booking and assert success redirect and booking uid',
      expectedObservable: ['booking_uid', 'redirect_url', 'sdk_event_name'].filter(o => observableOutputs.includes(o as ObservableOutput)) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('reschedule_booking')) {
    probes.push({
      name: 'reschedule booking',
      scenario: 'reschedule an existing booking and assert reschedule event path',
      expectedObservable: ['booking_uid', 'redirect_url'].filter(o => observableOutputs.includes(o as ObservableOutput)) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('create_recurring_booking')) {
    probes.push({
      name: 'recurring booking',
      scenario: 'create recurring booking and assert recurring success behavior',
      expectedObservable: ['booking_uid', 'redirect_url'].filter(o => observableOutputs.includes(o as ObservableOutput)) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('handle_payment_webhook')) {
    probes.push({
      name: 'payment webhook ingestion',
      scenario: 'send a valid payment webhook and assert booking/payment state updated',
      expectedObservable: ['payment_status', 'booking_uid', 'http_status'].filter(o => observableOutputs.includes(o as ObservableOutput)) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('issue_auth_token')) {
    probes.push({
      name: 'token issuance',
      scenario: 'complete OAuth flow and assert access token issued with correct scopes',
      expectedObservable: ['auth_token', 'http_status'].filter(o => observableOutputs.includes(o as ObservableOutput)) as ObservableOutput[],
    });
  }
  return probes;
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
  deltaTargets: DeltaTarget[];
  validationReport: ValidationReport;
}

// ── Main stage implementation ─────────────────────────────────────────────────

import type { ActionBindingResult } from './binding.js';

export async function runScoring(
  projectRoot: string,
  cr: ClassificationResult,
  binding?: ActionBindingResult
): Promise<ScoringResult> {
  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });

  // Load binding artifact if not provided
  let bindingArtifact = binding?.artifact;
  if (!bindingArtifact) {
    try {
      const raw = await readFile(join(projectRoot, '.vibe-splainer', 'action_bindings.json'), 'utf8');
      bindingArtifact = JSON.parse(raw);
    } catch {
      // Optional — continue without criticalFunctions
    }
  }

  // Stage 9: build PersistedFile store + canonical severity
  const persisted: Record<string, PersistedFile> = {};
  const severityBreakdowns: Record<string, string> = {};

  for (const f of cr.classified) {
    const severity = computeSeverity(
      f.sideEffectProfile, f.productDomain, f.gravity, f.heat,
      f.heatSignals.maxNesting, f.heatSignals.longFunctions > 0,
      f.heatSignals.swallowedCatches, f.runtimeEntrypoints,
    );
    
    // ADR-019: Use machine-derived confidence
    const confidence = deriveConfidence(f.gravitySignals.fanIn, f.gravity);

    const pf: PersistedFile = {
      relativePath: f.rel, language: f.lang,
      isRealSource: f.isRealSource, demoteReason: f.demoteReason,
      gravity: Math.round(f.gravity), heat: Math.round(f.heat),
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
    };

    // Apply corrections (mutates pf in place)
    applyCorrections(pf);

    persisted[f.rel] = pf;
    severityBreakdowns[f.rel] = `severity=${pf.canonicalSeverity} loadBearing=${pf.canonicalLoadBearing} effects=${pf.sideEffectProfile.join(',')} domain=${pf.productDomain}`;
  }

  // Stage 10: delta target generation (ADR-019 STRICT 5-FIELD CONTRACT)
  const deltaTargets: DeltaTarget[] = Object.values(persisted)
    .filter(pf => pf.isRealSource)
    .sort((a, b) => b.gravity - a.gravity)
    .map(pf => ({
      path: pf.relativePath,
      gravity: Math.round(pf.gravity),
      isLoadBearing: pf.canonicalLoadBearing, // STRICT: fanIn >= 10
      blastRadius: pf.importedBy,
      pillarHint: pf.pillarHint,
    }));

  const store: AnalysisStore = { files: persisted };

  // Stage 12: validation report
  const validationReport = await buildValidationReport(store, deltaTargets, projectRoot, cr);
  
  // Attach full report to store before returning
  store.validationReport = validationReport;

  // Log any errors
  for (const e of validationReport.errors) {
    console.error(`[vibe-splain] VALIDATION ERROR [${e.rule}] ${e.file}: ${e.detail}`);
  }
  for (const w of validationReport.warnings) {
    console.error(`[vibe-splain] VALIDATION WARN [${w.rule}] ${w.file}: ${w.detail}`);
  }

  return { store, deltaTargets, validationReport };
}

// ── Validation report (stage 12) ─────────────────────────────────────────────

async function buildValidationReport(
  store: AnalysisStore,
  deltaTargets: DeltaTarget[],
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
      (pf.sideEffectProfile.includes('booking_mutation') || pf.source.includes('createBooking') || pf.source.includes('handleNewBooking'))
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
    const hasWebhookIngress = pf.sideEffectProfile.includes('webhook_ingress');
    const pathMentionsPayment = PAYMENT_PROVIDER_PATH_TERMS.some(t => rel.toLowerCase().includes(t));

    // If it has the intent, it MUST be valid.
    // If it has webhook_ingress + path terms but NO intent, that's a validation error (missing classification).
    // (We exclude components as they are likely configuration UI, not the ingress point).
    if (!hasIntent && !(hasWebhookIngress && pathMentionsPayment && pf.frameworkRole !== 'component')) continue;

    const webhookChecks: [boolean, string, string][] = [
      [pf.productDomain !== 'payments_webhooks',
        'webhook_domain', `Payment webhook not classified as payments_webhooks`],
      [!pf.sideEffectProfile.includes('webhook_ingress'),
        'webhook_ingress_missing', `Payment webhook missing webhook_ingress side effect`],
      [!pf.sideEffectProfile.includes('payment_mutation'),
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
    summary: { errorCount: errors.length, warningCount: warnings.length, passCount, entrypointTraceCoverage: coverage },
  };
}

