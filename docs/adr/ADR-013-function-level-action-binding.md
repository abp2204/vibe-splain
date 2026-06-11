# ADR-013 — Function-Level Action Binding as the Core Grounding Layer

**Status:** Accepted — Pending Implementation  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

VIBE-SPLAIN currently produces per-file semantic signals: `frameworkRole`, `productDomain`, `sideEffectProfile`, `writeIntents`, `riskTypes`, `runtimeEntrypoints`, gravity, heat, and hotSpans. These signals are correct at the file level. The import graph gives file-to-file relationships. The entrypoint tracing gives file-to-entrypoint relationships.

The fundamental limitation is that all of these signals are **file-level**. A concrete failure illustrates the gap:

**Agent question:** "Explain the booking creation flow. Start from the API entrypoint. Trace the exact functions involved. Tell me where the Booking record is created, where availability is checked, where payment is handled, and where calendar and email side effects happen. Which function do I modify to prevent booking creation unless payment authorization succeeds?"

**What VIBE-SPLAIN can answer today:**  
"A booking-related route exists. This file has a runtime entrypoint. It writes to the database. It has calendar or email side effects. It belongs to the booking_creation domain."

**Why that is insufficient:**  
The answer is true but not actionable. It does not give a grounded chain:

```
POST /api/bookings
→ exported handler (POST, line 12)
→ validateInput (line 24)
→ checkAvailability (line 38)
→ authorizePayment (line 51)
→ prisma.booking.create (line 72)
→ createCalendarEvent (line 89)
→ sendConfirmationEmail (line 95)
```

The agent cannot identify the safe edit point, the exact function responsible for a behavior, or the evidence for each step. Without function-level grounding, the agent fills gaps with LLM inference, which produces hallucinated chains that are plausible-sounding but wrong.

**The core problem:** VIBE-SPLAIN can say "this file writes to the database." It cannot say "function `createBooking` at lines 47–110 calls `prisma.booking.create` at line 72 with arguments A, B, C."

The missing primitive is **action binding**: connecting a semantic claim to the smallest reliable code unit that supports it, with a source location and evidence text.

---

## Decision

Add **function-level action binding** as a first-class extraction pass (Stage 4.5) in the pipeline, producing a new artifact `action_bindings.json` and powering a new MCP tool `get_call_chain`.

**What action binding means:**  
For each function in each real-source file, extract:
1. The function's identity (name, kind, location)
2. The call expressions it contains (what it calls and where)
3. The semantic actions it performs (database reads/writes, external API calls, validation, auth checks, side effects)
4. Cross-file resolution for call targets where possible

**What action binding explicitly does not mean:**
- It is not a full language adapter or compiler pipeline
- It is not a natural language explanation generator
- It is not a replacement for the existing file-level signals
- It does not resolve type-level ambiguity (generics, overloads, dynamic dispatch)

**The test for whether action binding is working:**

> Given a booking-related entrypoint, can the system return a step-by-step chain with exact function names, file paths, line numbers, action kinds, and evidence text? Does it explicitly mark uncertain edges instead of pretending the chain is complete?

If yes, action binding is working. If no, inspect the failed edge and improve accordingly.

---

## Rationale

**Why function-level granularity is the right target (not deeper, not shallower):**

Statement-level granularity (individual AST nodes) is too fine — it produces enormous output with no semantic meaning per unit. File-level granularity (current) is too coarse — it cannot distinguish which function inside a 200-line file does the load-bearing work. Function-level is the right unit: it is the natural boundary for "who is responsible for this behavior," it maps to the safe edit point, and it matches what engineers think about when navigating a codebase.

**Why this beats the "full language adapter" approach:**

The language adapters document (Section 22) recommends building a canonical IR, then building a TypeScript + framework adapter, then building graph queries. That is the right long-term architecture. However, the immediate product failure is not "missing abstraction layer" — it is "cannot name the function that writes Booking." Action binding fixes the product failure directly, using the existing Tree-Sitter AST infrastructure, without requiring a multi-month IR design phase. The schemas chosen here (see ADR-014) are forward-compatible with the long-term IR, so the work is not wasted.

**Why the existing hotSpans do not solve this:**

`hotSpans` returns the top 3 most complex function bodies by cyclomatic complexity. They are evidence of code gnarliness, not evidence of behavior. The most complex function is rarely the function that writes the Booking model. A simple five-line `prisma.booking.create()` wrapper has low complexity but high semantic importance. Action binding targets semantic importance, not complexity.

**Why agents cannot reconstruct this by calling `get_file_context` repeatedly:**

An agent following import edges through `get_file_context` calls would need 10–20 calls to trace a single flow, with no guarantee it picks the correct traversal path at each branch. Each call returns raw hotSpans and import lists — the agent must read and parse code excerpts to find call targets. This is exactly the hallucination surface action binding is designed to eliminate. The traversal must happen inside `brain`, deterministically, before the agent sees the result.

---

## Consequences

- A new pipeline stage `runActionBinding` is added between `runResolution` and `runClassification` in `orchestrator.ts`.
- A new artifact `action_bindings.json` is written to `.vibe-splainer/` on every `scan_project` call.
- A new MCP tool `get_call_chain` is registered in the MCP server.
- `delta_targets.json` gains an optional `criticalFunctions` field (see ADR-017).
- The existing file-level signals (`sideEffectProfile`, `riskTypes`, etc.) are not replaced — they remain the primary signals for the Delta Engine's file-level ranking. Action binding is additive.
- The watcher does not need to re-run action binding on individual file changes in the first implementation. Full rescans regenerate the artifact. Incremental binding updates are deferred.
- `packages/brain/src/pipeline/` gains a new file: `binding.ts`.
