// v3 signal vocabulary — extended for Delta Engine compatibility.

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

// ── Delta Engine classification vocabulary ───────────────────────────────────

export type FrameworkRole =
  | 'app_route_page'
  | 'app_route_layout'
  | 'app_route_handler'
  | 'app_loading_boundary'
  | 'app_error_boundary'
  | 'pages_route'
  | 'pages_api_route'
  | 'trpc_api_route'
  | 'component'
  | 'hook'
  | 'provider'
  | 'store'
  | 'utility'
  | 'type_definition'
  | 'test'
  | 'generated'
  | 'unknown';

export type ProductDomain =
  | 'booking_creation'
  | 'booking_management'
  | 'booking_audit'
  | 'event_type_configuration'
  | 'availability'
  | 'auth'
  | 'auth_oauth'
  | 'payments'
  | 'payments_webhooks'
  | 'webhooks'
  | 'apps_marketplace'
  | 'calendar_integrations'
  | 'video'
  | 'onboarding'
  | 'settings'
  | 'admin'
  | 'data_table'
  | 'shell_navigation'
  | 'forms'
  | 'embed'
  | 'notifications'
  | 'routing_infrastructure'
  | 'test_infrastructure'
  | 'generated_noise'
  | 'unknown';

export type SideEffect =
  | 'database_write'
  | 'database_read'
  | 'booking_mutation'
  | 'payment_mutation'
  | 'auth_token_mutation'
  | 'webhook_delivery'
  | 'webhook_ingress'
  | 'email_send'
  | 'calendar_mutation'
  | 'redirect'
  | 'analytics_event'
  | 'cache_revalidation'
  | 'local_storage'
  | 'indexed_db'
  | 'external_api_call'
  | 'trpc_mutation'
  | 'server_action'
  | 'none_detected';

export type RiskType =
  | 'state_machine'
  | 'god_component'
  | 'god_hook'
  | 'registry_bottleneck'
  | 'registry_consumer'
  | 'mutation_orchestration'
  | 'route_handler_write_path'
  | 'side_effect_coupling'
  | 'type_boundary_leak'
  | 'storage_persistence_risk'
  | 'async_race_risk'
  | 'error_swallowing'
  | 'complexity_hotspot';

export interface RuntimeEntrypoint {
  path: string;
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  distance: number;
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
  // Delta Engine classification
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  sideEffectProfile: SideEffect[];
}
