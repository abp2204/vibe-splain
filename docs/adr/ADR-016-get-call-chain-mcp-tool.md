# ADR-016 — get_call_chain MCP Tool: Interface and Traversal Ownership

**Status:** Accepted — Pending Implementation  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

`action_bindings.json` (ADR-014) provides function-level call data, named import bindings, and semantic action records for all real-source files. This data needs to be surfaced to agents in a consumable form.

Two options exist:

**Option 1 — Per-file access:** The agent calls `get_file_context` per file, which now includes `functionActionBindings` for that file. The agent assembles the chain itself by following resolved file paths across multiple calls.

**Option 2 — Pre-assembled chain:** Brain assembles the call chain deterministically from `action_bindings.json` and returns it as a single structured result. The agent receives the complete chain in one call.

The concrete problem with Option 1: tracing the booking creation flow requires visiting the entrypoint file, identifying the handler function, finding its call targets, resolving each to a file, calling `get_file_context` for each resolved file, and repeating until the relevant semantic actions are reached. This is 10–20 tool calls with no guarantee the agent follows the right traversal path at each branch. At each step, the agent reads raw source excerpts and must reason about which call is relevant. This is exactly the hallucination surface action binding is designed to eliminate.

**Brain must own traversal.** If the agent reconstructs the chain, we have not solved the grounding problem — we have moved it from file-level guessing to call-level guessing.

---

## Decision

Add a new MCP tool `get_call_chain` to `packages/cli/src/mcp/tools/get_call_chain.ts` and register it in `packages/cli/src/mcp/server.ts`.

### Tool Interface

```ts
// Input
interface GetCallChainArgs {
  projectRoot: string;
  entrypointPath: string;          // relative path to the entrypoint file
  maxDepth?: number;               // default: 6, max: 12
  targetActionKind?: SemanticActionKind;  // filter: stop at this action kind
  targetModel?: string;            // filter: stop at functions touching this model
  targetOperation?: string;        // narrow targetModel filter to specific operation
  targetFunctionName?: string;     // filter: stop at a specific function name
  includeTests?: boolean;          // default: false — exclude test-role files from traversal
}

// Output
interface CallChainResult {
  entrypoint: ChainNode;
  chain: ChainStep[];
  targetReached: boolean;
  truncatedAtDepth: boolean;
  unresolvedEdges: UnresolvedEdge[];
  confidence: 'high' | 'medium' | 'low';
  evidenceSummary: string;
}

interface ChainNode {
  functionId: string;
  displayName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isEntrypoint: boolean;
  evidenceText: string;
}

interface ChainStep {
  depth: number;
  from: ChainNode;
  to: ChainNode | SemanticActionNode;
  edgeKind: 'call_edge' | 'semantic_action';
  resolutionKind: ResolutionKind;
  callSiteLine: number;
  callExpression: string;
  confidence: 'high' | 'medium' | 'low';
  isTarget: boolean;        // true if this step satisfies the filter
  evidenceText: string;
}

interface SemanticActionNode {
  kind: 'semantic_action';
  actionKind: SemanticActionKind;
  targetModel: string | null;
  targetOperation: string | null;
  filePath: string;
  sourceLine: number;
  evidenceText: string;
}

interface UnresolvedEdge {
  sourceFunctionId: string;
  calleeText: string;
  sourceLine: number;
  reason: string;   // "namespace import — property not resolved", "no import match found", etc.
}
```

### Traversal Algorithm

Brain implements BFS traversal from the entrypoint, visiting `FunctionRecord` nodes across files. Each visited function's `calls` and `semanticActions` are inspected.

**Traversal seed:** `entrypointIndex[entrypointPath]` gives the exported handler function IDs in the entrypoint file. If `entrypointPath` has no entries in `entrypointIndex`, fall back to all `isEntrypoint: true` functions in that file.

**BFS loop:**

```
queue = [entrypoint function]
visited = Set()

while queue not empty and depth < maxDepth:
  current = dequeue
  if current.functionId in visited: skip
  visited.add(current.functionId)

  for each call in current.calls:
    if call.resolutionKind === 'semantic_action_only': skip (handled separately)
    if call.resolvedTargetFunctionId is not null:
      emit ChainStep(call_edge, from=current, to=target function)
      if not filter or target satisfies filter: enqueue target
    else:
      emit UnresolvedEdge(call)

  for each action in current.semanticActions:
    emit ChainStep(semantic_action, from=current, to=action node)
    if action satisfies targetActionKind/targetModel/targetOperation filter:
      mark isTarget=true
```

**Filter behavior:**

- No filter: return the full reachable tree up to `maxDepth`
- `targetActionKind` or `targetModel`: continue traversal but mark matching `ChainStep.isTarget = true`; stop early if ALL branches from a node are resolved and none are progressing toward the target
- `targetFunctionName`: mark the `ChainNode` as target when `displayName` matches; stop early once found

**Cycle prevention:** Track visited `functionId` strings. Do not re-enter a function already on the current path.

**Cross-file resolution:** When a `CallRecord.resolvedTargetFunctionId` points to a function in another file, load that file's `FileBindingRecord` from `action_bindings.json.files` and look up the function by `functionId`. If `functionId` is not found (possible if the target function was not extracted — e.g., external package), emit `UnresolvedEdge`.

**Test file exclusion:** When `includeTests: false` (default), skip any `FunctionRecord` where the file's `sourceRole === 'test'`.

**Loading `action_bindings.json`:** Read from disk on each `get_call_chain` call. Do not cache in memory between calls. This is consistent with how `analysis.json` is handled by `readAnalysis`.

### Output Format to Agents

The tool returns a structured JSON object. The MCP tool description should guide agents to use structured filters when they know the target, and to use the no-filter form when exploring:

```
"Use get_call_chain to trace how behavior is reached from an entrypoint. 
Prefer structured filters when you know what you're looking for:
  targetModel + targetOperation for 'where is Booking created?'
  targetActionKind: 'auth_check' for 'where is authorization enforced?'
  targetFunctionName for 'how is function X reached?'
No filter returns the full call tree — use maxDepth to limit output size."
```

---

## Rationale

**Why brain owns traversal and not the agent:**

Traversal requires reading `action_bindings.json`, indexing it in memory, running BFS, resolving cross-file edges, and producing evidence text — all in a single computation. If the agent does this via multiple `get_file_context` calls, each call is a round-trip through the MCP protocol. The agent must also decide which branches to follow, which introduces LLM-driven traversal decisions on a graph that should be traversed deterministically. The whole value of the call graph is that the traversal is predetermined by the static structure of the code. Giving the agent raw per-file data and asking it to reconstruct the graph negates this.

**Why structured filters instead of free-text `targetBehavior`:**

A free-text `targetBehavior: "where does booking creation happen?"` would require LLM interpretation inside `brain`. `brain` is a static analysis module — it must not contain LLM calls. Structured filters (`targetModel: "Booking"`, `targetActionKind: "database_write"`) let the agent express the query in terms the static graph can evaluate deterministically. The agent is responsible for translating user intent into a structured filter before calling `get_call_chain`. This is the correct division of intelligence.

**Why `maxDepth` defaults to 6:**

The booking creation flow in Cal.com typically spans 4–7 function hops from the route handler to the Prisma call. A depth of 6 covers this comfortably. A cap of 12 prevents runaway traversal on deeply recursive or highly fan-out codebases. The agent can request a higher depth if the chain appears truncated (`truncatedAtDepth: true`).

**Why `UnresolvedEdge` is explicit in the output:**

The chain is not complete if there are unresolved call edges. Hiding unresolved edges would make the system appear to have a complete chain when it does not. `UnresolvedEdge` gives the agent transparency: "I could not follow this call to `checkAvailability` in the namespace import — the property could not be resolved." This allows the agent to flag uncertainty rather than asserting a false chain.

**Why cycles use visited-set and not path-set:**

Path-set cycle detection (only avoid re-entering a function on the current DFS path) allows the same function to appear in different branches of the BFS. Visited-set (avoid re-entering a function ever) is simpler and avoids exponential blowup in highly connected codebases. The tradeoff: a shared utility function that appears in multiple call paths only appears once in the output. This is acceptable — the goal is to identify where behaviors occur, not to enumerate all paths.

---

## Consequences

- New file: `packages/cli/src/mcp/tools/get_call_chain.ts`
- New handler: `handleGetCallChain` following the same pattern as other tool handlers
- Registration in `packages/cli/src/mcp/server.ts`
- `packages/brain/src/index.ts` must export a `traverseCallChain` function that `handleGetCallChain` calls
- The tool is read-only — it never writes to disk
- The tool does not trigger a rescan — it reads the existing `action_bindings.json`
- If `action_bindings.json` does not exist, the tool returns an error: "Run scan_project first to generate action bindings"
- The tool is additive — no existing MCP tools are modified or removed
