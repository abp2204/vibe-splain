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
  isOperationallyCritical: boolean; // ADR-019
  confidence: 'low' | 'medium' | 'high'; // ADR-019
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

export async function readActionBindings(projectRoot: string): Promise<any | null> {
  const p = join(projectRoot, '.vibe-splainer', 'action_bindings.json');
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── DeltaTarget — stored in delta_targets.json (ADR-019 STRICT CONTRACT) ──

export interface DeltaTarget {
  path: string;
  gravity: number;
  isLoadBearing: boolean; // STRICT: fanIn >= 10
  blastRadius: string[];
  pillarHint: string | null;
}

// ── Rich Analysis types (used in analysis.json) ──────────────────────────

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

export interface FunctionActionSummary {
  functionId: string;
  displayName: string;
  functionKind: string;
  startLine: number;
  endLine: number;
  isEntrypoint: boolean;
  isExported: boolean;
  actionKinds: string[];
  targetModels: string[];
  targetOperations: string[];
  outboundCallCount: number;
  resolvedOutboundCallCount: number;
  semanticActionCount: number;
  evidence: FunctionEvidenceItem[];
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface FunctionEvidenceItem {
  sourceLine: number;
  text: string;
  actionKind: string;
  targetModel: string | null;
  targetOperation: string | null;
  confidence: 'high' | 'medium' | 'low';
}

// ── Legacy IO (kept for backward compat if needed, but pruned of broken logic) ──

export async function writeDeltaTargets(
  projectRoot: string,
  store: AnalysisStore,
  _entrypoints: Set<string> = new Set(),
): Promise<void> {
  // Pruned: scoring.ts now handles the actual delta_targets.json generation.
  // This remains only as a placeholder if other tools still call it.
  const targets: DeltaTarget[] = Object.values(store.files)
    .filter(f => f.isRealSource)
    .sort((a, b) => b.gravity - a.gravity)
    .map(f => ({
        path: f.relativePath,
        gravity: Math.round(f.gravity),
        isLoadBearing: f.canonicalLoadBearing,
        blastRadius: f.importedBy,
        pillarHint: f.pillarHint,
    }));

  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, 'delta_targets.json');
  const tmp = dest + '.tmp';
  await writeFile(tmp, JSON.stringify(targets, null, 2), 'utf8');
  const { rename } = await import('fs/promises');
  await rename(tmp, dest);
}
