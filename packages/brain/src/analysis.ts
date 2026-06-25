import { join } from 'path';
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
  staticGravity: number;   // ADR-034: accepted v1 score, pre-lift
  behavioralLift: number;  // ADR-034: adapter-supplied lift (>= 0); 0 when no adapter fires
  heat: number;
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: SmellHit[];
  pillarHint: string | null;
  importedBy: string[];
  imports: string[];
  importsUnresolved: string[];
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  sideEffectProfile: SideEffect[];
  hotSpans: HotSpan[];
  source: string;
  // Pipeline-computed classification (populated by classification + scoring stages)
  riskTypes: RiskType[];
  writeIntents: WriteIntent[];
  runtimeEntrypoints: RuntimeEntrypoint[];
  entrypointTraceStatus: 'complete' | 'partial' | 'partial_wrong_surface' | 'blocked_by_alias_resolution' | 'no_runtime_entrypoint_found';
  canonicalSeverity: 1 | 2 | 3 | 4 | 5;
  canonicalLoadBearing: boolean;
  isOperationallyCritical: boolean; // ADR-019
  confidence: 'low' | 'medium' | 'high'; // ADR-019
  // ADR-034 adapter-scoped domain taxonomy (additive; emitted only when an
  // adapter classified the file). `productDomain` remains authoritative for now.
  adapterDomain?: string;
  domainTags?: string[];
  executionRole?: string;
  adapterSideEffects?: string[]; // adapter-mirrored domain side effects (additive)
  adapterSeverityContribution?: number; // adapter-computed domain severity points (parallel; not yet applied)
  adapterPillarLabel?: string; // adapter-mirrored pillar labels (additive)
}

// ── Validation report types (stage 12) ───────────────────────────────────────

export interface ValidationFinding {
  file: string;
  rule: string;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface ValidationReport {
  timestamp: string;
  passed: boolean;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  summary: { 
    errorCount: number; 
    warningCount: number; 
    passCount: number;
    entrypointTraceCoverage?: number; 
    entrypointTraceCoverageNumerator?: number;
    entrypointTraceCoverageDenominator?: number;
    entrypointTraceCoverageDefinition?: string;
    coverageBaselineNote?: string;
  };
}

export interface AnalysisStore {
  files: Record<string, PersistedFile>;
  validationReport?: ValidationReport;
  adapterFired?: string[];
  adapterMetrics?: Record<string, number>;
}

export async function readAnalysis(projectRoot: string): Promise<AnalysisStore | null> {
  const p = join(projectRoot, '.vibesplain', 'analysis.json');
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw) as AnalysisStore;
  } catch {
    return null;
  }
}

export async function writeAnalysis(projectRoot: string, store: AnalysisStore): Promise<void> {
  const dir = join(projectRoot, '.vibesplain');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, 'analysis.json');
  const tmp = dest + '.tmp';
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  const { rename } = await import('fs/promises');
  await rename(tmp, dest);
}

export async function readActionBindings(projectRoot: string): Promise<any | null> {
  const p = join(projectRoot, '.vibesplain', 'action_bindings.json');
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Rich Analysis types (used in analysis.json) ──────────────────────────

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

