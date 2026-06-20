// Domain adapter contract.
//
// Core stays repo-agnostic and remains the orchestrator. Adapters are the
// interpretation layer: they say what generic structural behavior MEANS inside
// a specific product. Adapters are compiled into brain —
// there is NO dynamic loading, no network, no config.
//
// Every hook is optional. With zero adapters matching, none of these run and
// output is identical to pure generic core. See registry.ts for composition.

import type {
  GravitySignals, HeatSignals, FrameworkRole, ProductDomain, SideEffect, Language,
} from '../../signals.js';

// ── Context passed to adapters ────────────────────────────────────────────────

/** Read-only view of one classified file, handed to adapters for interpretation. */
export interface AdapterFileView {
  readonly rel: string;
  readonly lang: Language;
  readonly isRealSource: boolean;
  readonly frameworkRole: FrameworkRole;
  readonly productDomain: ProductDomain;
  readonly staticGravity: number;       // accepted v1 score, pre-lift
  readonly gravitySignals: GravitySignals;
  readonly heatSignals: HeatSignals;
  readonly sideEffectProfile: readonly SideEffect[];
  readonly importSpecs: readonly string[];
  readonly source: string;
}

/** Project-level context for detection and interpretation. */
export interface AdapterContext {
  readonly projectRoot: string;
  readonly files: readonly AdapterFileView[];
}

// ── Per-hook result shapes ────────────────────────────────────────────────────
// All are keyed by file `rel`. An adapter returns only the files it has an
// opinion about; absent files mean "no contribution".

export interface AdapterClassificationResult {
  byFile: Record<string, {
    adapterDomain?: string;
    domainTags?: string[];
    executionRole?: string;
  }>;
}

export interface AdapterSideEffectResult {
  /** Domain side effects to ADD (e.g. booking_mutation). Never removes generic ones. */
  byFile: Record<string, string[]>;
}

export interface AdapterWriteIntentResult {
  byFile: Record<string, string[]>;
}

export interface AdapterLiftResult {
  /** behavioralLift per file. MUST be nonnegative (lift, never demote). */
  byFile: Record<string, number>;
}

export interface AdapterLoadBearingResult {
  byFile: Record<string, number>;
}

export interface AdapterSeverityResult {
  /** Severity boost per file. MUST be nonnegative; composed via max. */
  byFile: Record<string, number>;
}

export interface AdapterPillarLabelResult {
  /** Parallel pillar labels (bucket names) per file, for the pillar map. */
  byFile?: Record<string, string>;
  /** Optional rename map for pillar labels, keyed by current pillar name. */
  renames?: Record<string, string>;
}

export interface AdapterSurfacePattern {
  domain: string;
  expected: RegExp[];
  wrong: RegExp[];
}

// ── The adapter interface ─────────────────────────────────────────────────────

export interface DomainAdapter {
  /** Stable identifier (e.g. "my-framework"). Used for deterministic ordering. */
  readonly id: string;

  /** Whether this adapter applies to the scanned repo. Pure, no side effects. */
  detect(ctx: AdapterContext): boolean;

  classify?(ctx: AdapterContext): AdapterClassificationResult;
  interpretSideEffects?(ctx: AdapterContext): AdapterSideEffectResult;
  inferWriteIntents?(ctx: AdapterContext): AdapterWriteIntentResult;
  computeBehavioralLift?(ctx: AdapterContext): AdapterLiftResult;
  applySeverityPolicy?(ctx: AdapterContext): AdapterSeverityResult;
  applyLoadBearingPolicy?(ctx: AdapterContext): AdapterLoadBearingResult;
  labelPillars?(ctx: AdapterContext): AdapterPillarLabelResult;
  getSurfacePatterns?(): AdapterSurfacePattern[];
  getMetrics?(): Record<string, number>;
}

// ── Composed stage output ─────────────────────────────────────────────────────
// The registry collapses all firing adapters into one of these. Maps are used
// (not records) for fast per-file lookup at the pipeline seams.

export interface AdapterStageResult {
  readonly firedAdapterIds: string[];
  readonly liftByFile: Map<string, number>;
  readonly severityBoostByFile: Map<string, number>;
  readonly loadBearingBoostByFile: Map<string, number>;
  readonly classificationByFile: Map<string, { adapterDomain?: string; domainTags: string[]; executionRole?: string }>;
  readonly sideEffectsByFile: Map<string, string[]>;
  readonly writeIntentsByFile: Map<string, string[]>;
  readonly pillarLabelsByFile: Map<string, string>;
  readonly pillarRenames: Map<string, string>;
  readonly surfacePatterns: AdapterSurfacePattern[];
  readonly metrics: Record<string, number>;
}

/** The identity / empty result — what every no-adapter scan produces. */
export function emptyAdapterStageResult(): AdapterStageResult {
  return {
    firedAdapterIds: [],
    liftByFile: new Map(),
    severityBoostByFile: new Map(),
    loadBearingBoostByFile: new Map(),
    classificationByFile: new Map(),
    sideEffectsByFile: new Map(),
    writeIntentsByFile: new Map(),
    pillarLabelsByFile: new Map(),
    pillarRenames: new Map(),
    surfacePatterns: [],
    metrics: {},
  };
}
