import { join } from 'path';
import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type {
  Language, GravitySignals, HeatSignals, SmellHit,
  FrameworkRole, ProductDomain, SideEffect, RiskType, RuntimeEntrypoint,
} from './signals.js';

// ── PersistedFile — stored in analysis.json ────────────────────────────────
export interface HotSpan {
  startLine: number;
  endLine: number;
  rawExcerpt: string;   // exact source bytes, no transforms, no truncation
  snippet: string;      // stripLeadingComments + .slice(0, 2000)
  reason: string;
}

export interface PersistedFile {
  relativePath: string;
  language: Language;
  isRealSource: boolean;
  demoteReason: string | null;
  gravity: number;
  heat: number;
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: SmellHit[];
  pillarHint: string | null;
  importedBy: string[];
  imports: string[];
  importsUnresolved: string[];
  // Delta Engine fields
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  sideEffectProfile: SideEffect[];
  hotSpans: HotSpan[];
  // Pipeline-computed classification (populated by classification + scoring stages)
  riskTypes: RiskType[];
  writeIntents: WriteIntent[];
  canonicalSeverity: 1 | 2 | 3 | 4 | 5;
  canonicalLoadBearing: boolean;
}

export interface AnalysisStore {
  files: Record<string, PersistedFile>;
}

export async function readAnalysis(projectRoot: string): Promise<AnalysisStore | null> {
  const p = join(projectRoot, '.vibe-splainer', 'analysis.json');
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as AnalysisStore;
  } catch {
    return null;
  }
}

export async function writeAnalysis(projectRoot: string, store: AnalysisStore): Promise<void> {
  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, 'analysis.json');
  const tmp = dest + '.tmp';
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  const { rename } = await import('fs/promises');
  await rename(tmp, dest);
}

// ── DeltaTarget — stored in delta_targets.json ────────────────────────────

export type ObservableOutput =
  | 'redirect_url'
  | 'http_status'
  | 'json_response_shape'
  | 'booking_uid'
  | 'payment_status'
  | 'auth_token'
  | 'webhook_payload'
  | 'calendar_event_id'
  | 'email_payload'
  | 'sdk_event_name'
  | 'ui_state_transition'
  | 'filter_state'
  | 'selected_segment';

export type WriteIntent =
  | 'create_booking'
  | 'reschedule_booking'
  | 'cancel_booking'
  | 'create_recurring_booking'
  | 'update_event_type'
  | 'update_availability'
  | 'create_payment'
  | 'handle_payment_webhook'
  | 'issue_auth_token'
  | 'refresh_auth_token'
  | 'send_webhook'
  | 'update_user_settings'
  | 'persist_local_state'
  | 'none_detected';

export interface PatchRisk {
  level: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
}

export interface TestProbe {
  name: string;
  scenario: string;
  expectedObservable: ObservableOutput[];
}

export interface RawEvidence {
  file: string;
  startLine: number;
  endLine: number;
  rawSourceExcerpt: string;
  evidenceHash: string;
}

export interface DisplayEvidence {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;       // stripLeadingComments + truncated — for humans
  isTruncated: boolean;  // true when rawExcerpt.length > 2000
}

export interface DeltaTarget {
  path: string;
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  gravity: number;
  heat: number;
  severity: 1 | 2 | 3 | 4 | 5;
  confidence: 'low' | 'medium' | 'high';
  isLoadBearing: boolean;
  loadBearingScore: number;
  riskTypes: RiskType[];
  sideEffectProfile: SideEffect[];
  blastRadius: string[];
  runtimeEntrypoints: RuntimeEntrypoint[];
  entrypointTraceStatus:
    | 'complete'
    | 'partial'
    | 'partial_wrong_surface'
    | 'blocked_by_alias_resolution'
    | 'no_runtime_entrypoint_found';
  blockedImports: string[];
  observableOutputs: ObservableOutput[];
  writeIntents: WriteIntent[];
  patchRisk: PatchRisk;
  safePatchStrategy: string;
  doNotTouch: string[];
  testProbes: TestProbe[];
  rawEvidence: RawEvidence[];
  displayEvidence: DisplayEvidence[];
  analysisAnnotation: string;
  hashes: {
    fileHash: string;
    evidenceHash: string;
  };
}

// ── Runtime entrypoint detection ───────────────────────────────────────────

const ENTRYPOINT_ROLES = new Set<FrameworkRole>([
  'app_route_page', 'app_route_handler',
  'pages_route', 'pages_api_route', 'trpc_api_route',
]);

function findRuntimeEntrypoints(
  relPath: string,
  files: Record<string, PersistedFile>,
  maxDepth = 8,
): RuntimeEntrypoint[] {
  const results: RuntimeEntrypoint[] = [];
  const seen = new Set<string>();
  const queue: { path: string; depth: number }[] = [{ path: relPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.path)) continue;
    seen.add(current.path);

    if (current.path !== relPath) {
      const meta = files[current.path];
      if (meta && ENTRYPOINT_ROLES.has(meta.frameworkRole)) {
        results.push({
          path: current.path,
          frameworkRole: meta.frameworkRole,
          productDomain: meta.productDomain,
          distance: current.depth,
        });
        if (results.length >= 8) break;
        continue; // don't traverse past an entrypoint
      }
    }

    if (current.depth >= maxDepth) continue;

    const meta = files[current.path];
    if (!meta) continue;
    for (const importer of meta.importedBy) {
      if (!seen.has(importer)) {
        queue.push({ path: importer, depth: current.depth + 1 });
      }
    }
  }

  // Dedupe by path, prefer shortest distance
  const byPath = new Map<string, RuntimeEntrypoint>();
  for (const r of results) {
    const existing = byPath.get(r.path);
    if (!existing || r.distance < existing.distance) byPath.set(r.path, r);
  }
  return [...byPath.values()].sort((a, b) => a.distance - b.distance);
}

function deriveEntrypointTraceStatus(
  entrypoints: RuntimeEntrypoint[],
  unresolved: string[],
): DeltaTarget['entrypointTraceStatus'] {
  if (entrypoints.length > 0 && unresolved.length === 0) return 'complete';
  if (entrypoints.length > 0) return 'partial';
  if (unresolved.length > 0) return 'blocked_by_alias_resolution';
  return 'no_runtime_entrypoint_found';
}

// ── Scoring ────────────────────────────────────────────────────────────────

export function computeLoadBearingScore(
  f: PersistedFile,
  entrypoints: RuntimeEntrypoint[],
): number {
  let score = 0;

  if (f.gravity >= 85) score += 2;
  if (f.heat >= 60) score += 1;
  if (entrypoints.length >= 2) score += 2;
  if (f.importedBy.length >= 3) score += 1;

  if (f.sideEffectProfile.includes('database_write')) score += 3;
  if (f.sideEffectProfile.includes('booking_mutation')) score += 3;
  if (f.sideEffectProfile.includes('payment_mutation')) score += 3;
  if (f.sideEffectProfile.includes('auth_token_mutation')) score += 3;
  if (f.sideEffectProfile.includes('webhook_delivery')) score += 2;
  if (f.sideEffectProfile.includes('webhook_ingress')) score += 2;
  if (f.sideEffectProfile.includes('calendar_mutation')) score += 2;
  if (f.sideEffectProfile.includes('redirect')) score += 1;
  if (f.sideEffectProfile.includes('analytics_event')) score += 1;

  const highImpactDomains: ProductDomain[] = [
    'booking_creation', 'payments', 'auth_oauth', 'webhooks', 'payments_webhooks',
  ];
  if (highImpactDomains.includes(f.productDomain)) score += 2;

  const maxSeverity = f.smells.length > 0 ? Math.max(...f.smells.map(s => s.severity)) : 0;
  if (maxSeverity === 5) score += 3;

  return score;
}

export function computeSeverity(
  f: PersistedFile,
  entrypoints: RuntimeEntrypoint[],
): 1 | 2 | 3 | 4 | 5 {
  let score = 0;

  if (f.sideEffectProfile.includes('database_write')) score += 3;
  if (f.sideEffectProfile.includes('booking_mutation')) score += 4;
  if (f.sideEffectProfile.includes('payment_mutation')) score += 4;
  if (f.sideEffectProfile.includes('auth_token_mutation')) score += 4;
  if (f.sideEffectProfile.includes('webhook_delivery')) score += 3;
  if (f.sideEffectProfile.includes('webhook_ingress')) score += 3;
  if (f.sideEffectProfile.includes('calendar_mutation')) score += 3;

  if (f.productDomain === 'booking_creation') score += 3;
  if (f.productDomain === 'payments' || f.productDomain === 'payments_webhooks') score += 3;
  if (f.productDomain === 'auth_oauth') score += 3;
  if (f.productDomain === 'webhooks') score += 2;

  if (f.gravity >= 85) score += 2;
  if (f.heat >= 70) score += 2;
  if (f.heatSignals.maxNesting >= 4) score += 1;
  if (f.heatSignals.longFunctions >= 1) score += 1;
  if (f.heatSignals.swallowedCatches >= 1) score += 1;
  if (entrypoints.length >= 2) score += 2;

  if (score >= 10) return 5;
  if (score >= 7) return 4;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  return 1;
}

// ── Risk type inference ────────────────────────────────────────────────────

function inferRiskTypes(f: PersistedFile): RiskType[] {
  const types: RiskType[] = [];
  const kinds = new Set(f.smells.map(s => s.kind));

  if (f.gravitySignals.cyclomatic > 20) types.push('state_machine');

  if (kinds.has('god-file')) {
    if (f.frameworkRole === 'hook') types.push('god_hook');
    else types.push('god_component');
  }

  if (f.sideEffectProfile.length > 3 && !f.sideEffectProfile.includes('none_detected')) {
    types.push('side_effect_coupling');
  }

  if (
    f.productDomain === 'forms' &&
    f.gravitySignals.fanIn > 5 &&
    f.gravitySignals.publicSurface > 8
  ) types.push('registry_bottleneck');

  if (
    f.sideEffectProfile.some(s =>
      ['booking_mutation', 'payment_mutation', 'auth_token_mutation'].includes(s)
    ) &&
    f.gravitySignals.cyclomatic > 10
  ) types.push('mutation_orchestration');

  if (
    ENTRYPOINT_ROLES.has(f.frameworkRole) &&
    f.sideEffectProfile.includes('database_write')
  ) types.push('route_handler_write_path');

  if (kinds.has('swallowed-catch')) types.push('error_swallowing');

  if (
    f.sideEffectProfile.includes('local_storage') ||
    f.sideEffectProfile.includes('indexed_db')
  ) types.push('storage_persistence_risk');

  if (types.length === 0) types.push('complexity_hotspot');
  return types;
}

// ── Observable outputs inference ──────────────────────────────────────────

function inferObservableOutputs(f: PersistedFile): ObservableOutput[] {
  const outputs: ObservableOutput[] = [];

  if (f.sideEffectProfile.includes('redirect')) outputs.push('redirect_url');
  if (ENTRYPOINT_ROLES.has(f.frameworkRole)) outputs.push('http_status');

  if (f.frameworkRole === 'app_route_handler' || f.frameworkRole === 'pages_api_route') {
    outputs.push('json_response_shape');
  }

  if (f.productDomain === 'booking_creation' || f.productDomain === 'booking_management') {
    outputs.push('booking_uid');
  }
  if (f.productDomain === 'payments' || f.productDomain === 'payments_webhooks') {
    outputs.push('payment_status');
  }
  if (f.productDomain === 'auth_oauth') {
    outputs.push('auth_token');
  }
  if (f.sideEffectProfile.includes('webhook_delivery') || f.sideEffectProfile.includes('webhook_ingress')) {
    outputs.push('webhook_payload');
  }
  if (f.sideEffectProfile.includes('calendar_mutation')) {
    outputs.push('calendar_event_id');
  }
  if (f.sideEffectProfile.includes('email_send')) {
    outputs.push('email_payload');
  }
  if (f.sideEffectProfile.includes('analytics_event')) {
    outputs.push('sdk_event_name');
  }
  if (f.frameworkRole === 'hook' || f.frameworkRole === 'store') {
    outputs.push('ui_state_transition');
  }

  return [...new Set(outputs)];
}

// ── Write intent inference ─────────────────────────────────────────────────

function inferWriteIntents(f: PersistedFile): WriteIntent[] {
  const intents: WriteIntent[] = [];

  if (f.productDomain === 'booking_creation') {
    intents.push('create_booking');
    if (
      f.relativePath.includes('reschedule') ||
      f.relativePath.includes('Reschedule')
    ) intents.push('reschedule_booking');
    if (f.relativePath.includes('recurring') || f.relativePath.includes('Recurring')) {
      intents.push('create_recurring_booking');
    }
  }
  if (f.productDomain === 'booking_management') {
    intents.push('cancel_booking');
  }
  if (f.productDomain === 'event_type_configuration') {
    intents.push('update_event_type');
  }
  if (f.productDomain === 'availability') {
    intents.push('update_availability');
  }
  if (f.productDomain === 'payments') {
    intents.push('create_payment');
  }
  if (f.productDomain === 'payments_webhooks') {
    intents.push('handle_payment_webhook');
  }
  if (f.productDomain === 'auth_oauth') {
    intents.push('issue_auth_token');
    intents.push('refresh_auth_token');
  }
  if (f.sideEffectProfile.includes('webhook_delivery')) {
    intents.push('send_webhook');
  }
  if (f.productDomain === 'settings') {
    intents.push('update_user_settings');
  }
  if (f.sideEffectProfile.includes('local_storage') || f.sideEffectProfile.includes('indexed_db')) {
    intents.push('persist_local_state');
  }

  return intents.length > 0 ? intents : ['none_detected'];
}

// ── Patch risk inference ───────────────────────────────────────────────────

function inferPatchRisk(
  f: PersistedFile,
  score: number,
  riskTypes: RiskType[],
): PatchRisk {
  if (score >= 12 || f.productDomain === 'booking_creation' && riskTypes.includes('mutation_orchestration')) {
    return {
      level: 'critical',
      reason: `${f.productDomain} domain with ${riskTypes.join(', ')} — any patch risks breaking live booking, payment, or auth flows.`,
    };
  }
  if (score >= 8 || f.sideEffectProfile.includes('payment_mutation') || f.sideEffectProfile.includes('auth_token_mutation')) {
    return {
      level: 'high',
      reason: `${f.productDomain} writes to external state (${f.sideEffectProfile.filter(s => ['payment_mutation', 'auth_token_mutation', 'database_write', 'webhook_delivery'].includes(s)).join(', ') || 'database'}). Changes require integration testing.`,
    };
  }
  if (score >= 5 || f.importedBy.length >= 5) {
    return {
      level: 'medium',
      reason: `Imported by ${f.importedBy.length} files. Interface changes will cascade.`,
    };
  }
  return {
    level: 'low',
    reason: 'Locally contained — limited blast radius.',
  };
}

// ── Safe patch strategy ────────────────────────────────────────────────────

function inferSafePatchStrategy(f: PersistedFile, riskTypes: RiskType[]): string {
  if (riskTypes.includes('mutation_orchestration')) {
    return 'Do not rewrite inline. Extract pure decision logic into a tested reducer or state machine first. Preserve all side-effect call sites (redirect URLs, SDK event names, response shapes) as invariants.';
  }
  if (riskTypes.includes('registry_bottleneck')) {
    return 'Add new entries without removing existing keys. Treat the registry map as append-only until all consumers are verified.';
  }
  if (riskTypes.includes('route_handler_write_path')) {
    return 'Add integration tests covering success and failure paths before modifying. Verify HTTP status codes and response shapes are preserved.';
  }
  if (riskTypes.includes('god_component') || riskTypes.includes('god_hook')) {
    return 'Extract sub-concerns into separate modules first. Only refactor the extraction points after tests confirm equivalence.';
  }
  if (f.sideEffectProfile.includes('database_write')) {
    return 'Wrap changes in a transaction or use a feature flag. Run against a staging database before production.';
  }
  return 'Review importedBy before patching. Run affected integration tests.';
}

// ── Do-not-touch extraction ────────────────────────────────────────────────

function inferDoNotTouch(f: PersistedFile): string[] {
  const items: string[] = [];

  if (f.sideEffectProfile.includes('payment_mutation')) items.push('payment flow branch');
  if (f.sideEffectProfile.includes('auth_token_mutation')) items.push('token issuance / refresh branch');
  if (f.sideEffectProfile.includes('webhook_delivery') || f.sideEffectProfile.includes('webhook_ingress')) {
    items.push('webhook payload shape');
  }
  if (f.sideEffectProfile.includes('redirect')) items.push('redirect URL strings');
  if (f.sideEffectProfile.includes('analytics_event')) items.push('SDK event names');
  if (f.sideEffectProfile.includes('booking_mutation')) {
    items.push('booking success response shape', 'recurring booking branch');
  }
  if (f.productDomain === 'auth_oauth') items.push('OAuth callback URLs', 'token scopes');

  return items;
}

// ── Test probes ───────────────────────────────────────────────────────────

function inferTestProbes(
  f: PersistedFile,
  writeIntents: WriteIntent[],
  observableOutputs: ObservableOutput[],
): TestProbe[] {
  const probes: TestProbe[] = [];

  if (writeIntents.includes('create_booking')) {
    probes.push({
      name: 'standard booking success',
      scenario: 'create a standard booking and assert success redirect and booking uid',
      expectedObservable: ['booking_uid', 'redirect_url', 'sdk_event_name'].filter(o =>
        observableOutputs.includes(o as ObservableOutput)
      ) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('reschedule_booking')) {
    probes.push({
      name: 'reschedule booking',
      scenario: 'reschedule an existing booking and assert reschedule event path',
      expectedObservable: ['booking_uid', 'redirect_url'].filter(o =>
        observableOutputs.includes(o as ObservableOutput)
      ) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('create_recurring_booking')) {
    probes.push({
      name: 'recurring booking',
      scenario: 'create recurring booking and assert recurring success behavior',
      expectedObservable: ['booking_uid', 'redirect_url'].filter(o =>
        observableOutputs.includes(o as ObservableOutput)
      ) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('handle_payment_webhook')) {
    probes.push({
      name: 'payment webhook ingestion',
      scenario: 'send a valid payment webhook and assert booking/payment state updated',
      expectedObservable: ['payment_status', 'booking_uid', 'http_status'].filter(o =>
        observableOutputs.includes(o as ObservableOutput)
      ) as ObservableOutput[],
    });
  }
  if (writeIntents.includes('issue_auth_token')) {
    probes.push({
      name: 'token issuance',
      scenario: 'complete OAuth flow and assert access token issued with correct scopes',
      expectedObservable: ['auth_token', 'http_status'].filter(o =>
        observableOutputs.includes(o as ObservableOutput)
      ) as ObservableOutput[],
    });
  }

  return probes;
}

// ── Raw evidence from hotSpans ─────────────────────────────────────────────

function buildRawEvidence(f: PersistedFile): RawEvidence[] {
  return f.hotSpans.map(span => ({
    file: f.relativePath,
    startLine: span.startLine,
    endLine: span.endLine,
    rawSourceExcerpt: span.rawExcerpt,
    evidenceHash: createHash('sha256').update(span.rawExcerpt).digest('hex').slice(0, 12),
  }));
}

// ── Confidence ───────────────────────────────────────────────────────────

function deriveConfidence(f: PersistedFile): 'high' | 'medium' | 'low' {
  if (f.gravitySignals.fanIn >= 10 && f.gravity >= 40) return 'high';
  if (f.gravitySignals.fanIn >= 5 || f.gravity >= 25) return 'medium';
  return 'low';
}

// ── Validation ────────────────────────────────────────────────────────────

function validateTarget(target: DeltaTarget): void {
  const warn = (msg: string) => console.error(`[vibe-splain] WARN ${target.path}: ${msg}`);
  const err  = (msg: string) => console.error(`[vibe-splain] ERR  ${target.path}: ${msg}`);

  if (target.severity >= 4 && target.runtimeEntrypoints.length === 0) {
    warn('high severity target has no runtime entrypoints — check alias resolution');
  }
  if (target.severity === 5 && !target.isLoadBearing) {
    err('severity 5 target must be load bearing');
  }
  if (
    target.productDomain === 'routing_infrastructure' &&
    !target.path.includes('middleware') &&
    !target.path.includes('router') &&
    !target.path.includes('Navigation')
  ) {
    warn('possible over-classification as routing_infrastructure');
  }
  if (
    (target.path.includes('payment') || target.path.includes('stripe') || target.path.includes('paypal')) &&
    !target.sideEffectProfile.includes('payment_mutation') &&
    !target.sideEffectProfile.includes('webhook_ingress')
  ) {
    warn('payment file missing payment side effect classification');
  }
  if (
    target.rawEvidence.some(e =>
      e.rawSourceExcerpt.includes('// ..') || e.rawSourceExcerpt.includes('/* ...')
    )
  ) {
    err('raw evidence appears summarized or annotated');
  }
}

// ── Main write function ────────────────────────────────────────────────────

export async function writeDeltaTargets(
  projectRoot: string,
  store: AnalysisStore,
  _entrypoints: Set<string> = new Set(),
): Promise<void> {
  const targets: DeltaTarget[] = Object.values(store.files)
    .filter(f => f.isRealSource)
    .sort((a, b) => b.gravity - a.gravity)
    .map(f => {
      const runtimeEntrypoints = findRuntimeEntrypoints(f.relativePath, store.files);
      const entrypointTraceStatus = deriveEntrypointTraceStatus(runtimeEntrypoints, f.importsUnresolved);
      const loadBearingScore = computeLoadBearingScore(f, runtimeEntrypoints);
      const severity: 1 | 2 | 3 | 4 | 5 = f.canonicalSeverity ?? computeSeverity(f, runtimeEntrypoints);
      const riskTypes = (f.riskTypes?.length > 0) ? f.riskTypes : inferRiskTypes(f);
      const observableOutputs = inferObservableOutputs(f);
      const writeIntents = (f.writeIntents?.length > 0 && !f.writeIntents.includes('none_detected' as WriteIntent))
        ? f.writeIntents
        : inferWriteIntents(f);
      const patchRisk = inferPatchRisk(f, loadBearingScore, riskTypes);
      const rawEvidence = buildRawEvidence(f);
      const displayEvidence: DisplayEvidence[] = f.hotSpans.map(span => ({
        file: f.relativePath,
        startLine: span.startLine,
        endLine: span.endLine,
        excerpt: span.snippet,
        isTruncated: span.rawExcerpt.length > 2000,
      }));
      const confidence = deriveConfidence(f);

      const fileHashInput = f.hotSpans.map(h => h.snippet).join('');
      const fileHash = createHash('sha256').update(fileHashInput || f.relativePath).digest('hex').slice(0, 12);

      const target: DeltaTarget = {
        path: f.relativePath,
        frameworkRole: f.frameworkRole,
        productDomain: f.productDomain,
        gravity: Math.round(f.gravity),
        heat: Math.round(f.heat),
        severity,
        confidence,
        isLoadBearing: (f.canonicalLoadBearing ?? false) || loadBearingScore >= 5,
        loadBearingScore,
        riskTypes,
        sideEffectProfile: f.sideEffectProfile,
        blastRadius: f.importedBy,
        runtimeEntrypoints,
        entrypointTraceStatus,
        blockedImports: f.importsUnresolved,
        observableOutputs,
        writeIntents,
        patchRisk,
        safePatchStrategy: inferSafePatchStrategy(f, riskTypes),
        doNotTouch: inferDoNotTouch(f),
        testProbes: inferTestProbes(f, writeIntents, observableOutputs),
        rawEvidence,
        displayEvidence,
        analysisAnnotation: `${f.frameworkRole} in ${f.productDomain} domain. fanIn=${f.gravitySignals.fanIn} cyclomatic=${f.gravitySignals.cyclomatic} loc=${f.gravitySignals.loc}`,
        hashes: {
          fileHash,
          evidenceHash: rawEvidence.map(e => e.evidenceHash).join('-'),
        },
      };

      validateTarget(target);
      return target;
    });

  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, 'delta_targets.json');
  const tmp = dest + '.tmp';
  await writeFile(tmp, JSON.stringify(targets, null, 2), 'utf8');
  const { rename } = await import('fs/promises');
  await rename(tmp, dest);
}
