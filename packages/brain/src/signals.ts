// v2 signal vocabulary — the typed vocabulary the scanner produces.
// Pure data definitions; the scanner (Phase 1/2) populates these.

export type Language = 'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'rust' | 'java';

export interface GravitySignals {
  fanIn: number;        // # of real-source files that import this (resolved, deduped)
  fanOut: number;       // # of distinct modules this imports
  centrality: number;   // 0..1 PageRank over the resolved import graph
  cyclomatic: number;   // sum of decision nodes (if/for/while/case/catch/&&/||/?)
  publicSurface: number;// exported symbol count
  loc: number;
}

export interface HeatSignals {
  todos: number;          // TODO|FIXME|HACK|XXX|@deprecated
  suppressions: number;   // @ts-ignore | eslint-disable | ': any' | type:ignore | #nosec
  swallowedCatches: number; // catch blocks that are empty or only log
  maxNesting: number;
  longFunctions: number;  // function bodies over LOC threshold
  magicNumbers: number;
}

export type SmellKind =
  | 'todo' | 'suppression' | 'swallowed-catch'
  | 'deep-nesting' | 'long-function' | 'magic-number' | 'god-file';

export interface SmellHit {
  kind: SmellKind;
  line: number;        // 1-based
  endLine: number;
  text: string;        // the offending line, trimmed
  severity: 1 | 2 | 3 | 4 | 5;
  note: string;        // human-readable, e.g. "catch block swallows error silently"
}

export interface FileAnalysis {
  path: string;
  relativePath: string;
  language: Language;
  isRealSource: boolean;       // false ⇒ docs/mockups/vendored/generated
  demoteReason: string | null; // why it's not real source (transparency)
  gravity: number;             // 0..100 composite
  heat: number;                // 0..100 composite
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: SmellHit[];
  pillarHint: string | null;   // from import-graph community detection
}
