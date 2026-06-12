# VIBE-SPLAIN Target Market and Public Codebase Strategy

## Purpose

This document converts the strategic market pivot into an LLM-ingestible planning artifact.

The goal is to move beyond Cal.com as a generic stress test and instead select a first commercial target market, then build a public codebase benchmark corpus that resembles the real modernization pain of that market.

This document is meant to be handed to an agent for market refinement, public repository discovery, benchmark design, and go-to-market planning.

---

## Core Strategic Shift

Cal.com was useful as a stress test, but it should not define the market.

The next phase should not be:

```txt
Find another random large TypeScript repo.
```

The next phase should be:

```txt
Identify the first profitable and realistic buyer segment.
Then build the codebase benchmark corpus around that buyer segment.
```

VIBE-SPLAIN should train and prove itself on codebases that resemble the kinds of businesses most likely to pay for legacy modernization.

---

## Strategic Thesis

The best first wedge is not general developer tooling.

The best first wedge is:

```txt
Mid-market industrial and operations-heavy software companies modernizing ERP, MES, QMS, CRM, inventory, scheduling, order management, and field-service systems.
```

This includes companies in or serving:

```txt
manufacturing
distribution
field services
logistics
industrial services
B2B workflow SaaS
vertical ERP and CRM vendors
PE-backed software rollups
```

These companies often have software that is:

```txt
mission critical
workflow heavy
database write heavy
integration heavy
permission heavy
full of hidden business logic
expensive to rewrite manually
too risky to modernize casually
```

That is exactly the kind of environment where VIBE-SPLAIN can be valuable.

---

## Why This Segment Is Strong

### 1. Real Modernization Pain

These companies often run long-lived internal or customer-facing systems that contain deeply embedded business rules.

Examples of common legacy workflows:

```txt
quote to cash
order to shipment
inventory adjustment
production scheduling
work order management
inspection and quality workflows
customer account management
field technician dispatch
billing and invoicing
supplier and purchase order workflows
returns and claims
```

These workflows are difficult to modernize because the important logic is rarely isolated in one clean service. It is spread across forms, route handlers, permissions, database writes, integrations, scheduled jobs, and UI state.

### 2. Better First Buyer Than Highly Regulated Enterprises

Banking, insurance, and healthcare have large budgets, but they also bring slower procurement, heavier compliance, legal review, data restrictions, and higher trust barriers.

Industrial and vertical B2B software markets are often still serious enough to pay, but more accessible for a first product wedge.

### 3. Better Codebase Fit Than Cal.com

Cal.com is primarily scheduling and booking.

The target market codebases should include:

```txt
financial side effects
inventory mutations
CRM workflows
ERP modules
permissions
audit trails
complex forms
external integrations
stateful business processes
```

These are closer to modernization problems buyers care about.

### 4. Natural Fit for VIBE-SPLAIN's Strengths

VIBE-SPLAIN is designed to identify:

```txt
load-bearing files
mutation hubs
write intents
side-effect profiles
function-level action bindings
runtime entrypoints
patch risk
test probes
safe patch strategies
```

Those are especially valuable in business workflow systems where changes can break billing, orders, inventory, compliance, or customer operations.

---

## Recommended First Target Market

### Primary Market

```txt
PE-backed or mid-market B2B software companies with ERP, CRM, workflow, manufacturing, distribution, logistics, or field-service products.
```

### Ideal First Customer Profile

```txt
Company size:
  50 to 500 employees

Engineering org:
  5 to 75 engineers

Codebase profile:
  legacy JavaScript, TypeScript, React, Node, Next.js, Express, Rails, Django, PHP, or older monoliths

Business profile:
  owns a workflow-heavy vertical software product
  has customers depending on the software daily
  is under pressure to modernize
  cannot afford a risky rewrite
  may be PE-backed or undergoing platform consolidation

Pain:
  slow feature delivery
  brittle legacy code
  lack of architectural understanding
  fear of breaking customer workflows
  expensive manual audits before modernization
```

### Buyer Personas

```txt
CTO
VP Engineering
Head of Platform
Director of Engineering
PE operating partner for software modernization
Engineering lead responsible for migration
Technical founder of vertical SaaS company
```

### Core Sales Message

```txt
VIBE-SPLAIN maps hidden business logic before modernization, identifies high-risk mutation paths, and enables scoped agents to make verified patches without context collapse.
```

### Simple Positioning

```txt
The MRI for legacy business software modernization.
```

Expanded version:

```txt
VIBE-SPLAIN analyzes legacy TypeScript and JavaScript systems, maps their risky business workflows, identifies load-bearing mutation paths, and gives modernization agents the exact context needed to patch safely.
```

---

## Why Not Start With Healthcare, Banking, or Insurance

These sectors are attractive but should probably be second-wave markets.

### Healthcare

Pros:

```txt
high modernization pain
mission-critical workflows
legacy systems everywhere
public open-source examples exist
```

Cons:

```txt
compliance-heavy
harder procurement
patient data concerns
higher trust barrier
longer sales cycles
```

### Banking and Fintech

Pros:

```txt
large budgets
high cost of broken workflows
deep modernization need
```

Cons:

```txt
security and compliance review
limited public codebase realism
harder buyer access
more conservative procurement
```

### Insurance

Pros:

```txt
claims workflows map well to VIBE-SPLAIN
legacy code is common
high operational pain
```

Cons:

```txt
public codebases tend to be thinner
enterprise sales cycle may be slower
```

These are good later verticals, but industrial ERP, CRM, and workflow software are a more practical first wedge.

---

## Public Codebase Corpus Strategy

The benchmark corpus should not be a random list of large repositories.

It should be organized around the target buyer's software reality.

### Corpus Goal

Build a benchmark set that tests whether VIBE-SPLAIN can analyze, explain, and support modernization of business workflow systems.

### Codebase Characteristics to Prioritize

```txt
business workflow richness
database write density
permissions and roles
external integrations
stateful CRUD flows
billing or payment side effects
inventory or order side effects
complex forms
workflow orchestration
route and API handlers
long-lived modules
mixed old and modern patterns
```

### Preferred Technical Stack for Primary Corpus

Since VIBE-SPLAIN currently focuses on TypeScript and JavaScript, prioritize:

```txt
TypeScript
JavaScript
React
Next.js
Node.js
Express
Prisma
PostgreSQL
REST APIs
GraphQL APIs
monorepos
```

### Secondary Domain Corpus

Use non-TypeScript systems for domain understanding and strategic comparison, even if VIBE-SPLAIN does not fully analyze them yet.

Examples:

```txt
Python ERP
PHP healthcare systems
large modular ERP platforms
```

These help model the domain even if they are not first-class scanner targets.

---

## Recommended Corpus Tiers

### Tier 1: Primary TypeScript and JavaScript Benchmark Corpus

These should be the first repositories to search, evaluate, and test.

Potential candidates:

```txt
Carbon
Twenty
NextCRM
SaaSHQ
VietERP
open-source inventory management systems
open-source order management systems
open-source field-service systems
open-source CRM systems
open-source workflow automation systems
```

What this tier proves:

```txt
Can VIBE-SPLAIN analyze the current wedge: TypeScript and JavaScript business software?
Can it detect write intents, side effects, auth, forms, integrations, and mutation hubs?
Can dossier.agent.md help an agent safely patch business workflow code?
```

### Tier 2: Domain Realism Corpus

These repositories may not be the main supported stack, but they are useful for understanding realistic business software complexity.

Potential candidates:

```txt
ERPNext
Odoo
OpenEMR
CARE EMR
open-source loan origination systems
open-source insurance claims systems
```

What this tier proves:

```txt
What do real ERP, healthcare, and workflow systems look like?
What domain modules recur across industries?
What modernization tasks would buyers care about?
What should VIBE-SPLAIN eventually support beyond TypeScript and JavaScript?
```

### Tier 3: Synthetic Mutation Corpus

Create controlled modernization tasks on top of selected repositories.

Examples:

```txt
route migration
database adapter swap
permission model extraction
webhook evidence extraction
default import resolution
workflow split
side effect preservation
monolith module extraction
API handler refactor
form state simplification
business rule extraction
```

What this tier proves:

```txt
Can the system not only scan, but guide real modernization tasks?
Can scoped Workers make verified patches?
Can proof receipts show that behavior was preserved?
Can the pointer/context architecture prevent context collapse during long tasks?
```

---

## Candidate Repository Matrix

An agent should build a matrix with these columns:

```txt
repo_name
repo_url
domain
business_type
language
framework
database
license
stars
recent_activity
setup_difficulty
business_workflow_richness
database_write_density
integration_density
auth_permission_complexity
route_handler_complexity
form_complexity
test_coverage
modernization_task_ideas
VIBE_SPLAIN_fit_score
notes
```

### Scoring Criteria

Use a 1 to 5 score for each:

```txt
business_workflow_richness
database_write_density
integration_density
auth_permission_complexity
setup_feasibility
TypeScript_JavaScript_fit
modernization_relevance
```

Suggested total score:

```txt
fit_score =
  business_workflow_richness * 3
  + database_write_density * 3
  + integration_density * 2
  + auth_permission_complexity * 2
  + TypeScript_JavaScript_fit * 3
  + modernization_relevance * 3
  - setup_difficulty
```

The first benchmark set should not simply choose the largest repos. It should choose the repos that best represent buyer pain and are feasible to run.

---

## Initial Shortlist

### Primary Shortlist

```txt
Carbon
Twenty
ERPNext
```

Rationale:

```txt
Carbon:
  Manufacturing ERP, MES, QMS, job shops, contract manufacturing, configure-to-order workflows.
  Strong fit for industrial software modernization.

Twenty:
  Modern CRM and business object workflow patterns.
  Strong TypeScript and product workflow fit.

ERPNext:
  Deep ERP domain complexity across accounting, inventory, sales, purchasing, and manufacturing.
  Excellent domain reference even if stack differs from current TypeScript wedge.
```

### Secondary Shortlist

```txt
Odoo
OpenEMR
CARE EMR
NextCRM
SaaSHQ
VietERP
loan origination examples
insurance claims examples
```

---

## Benchmark Design

The goal is not only to scan repositories. The goal is to produce measurable modernization tasks.

### Benchmark Output for Each Repo

For every selected repository, generate:

```txt
scan_summary
delta_targets.json
validation_report.json
action_bindings.json
dossier.agent.md
top mutation hubs
top side-effect surfaces
top permission-sensitive files
top integration-sensitive files
recommended modernization tasks
agent patch simulation results
```

### Example Benchmark Tasks

For ERP or manufacturing systems:

```txt
extract inventory adjustment business rules
identify order creation write path
map quote-to-cash flow
separate UI form state from mutation logic
preserve database write behavior during refactor
identify role permission gates
trace external integration call path
```

For CRM systems:

```txt
map contact creation flow
trace deal stage mutation
identify account ownership permission checks
extract workflow automation rules
refactor activity logging without losing side effects
```

For healthcare or claims systems:

```txt
map patient or claim creation flow
identify audit-sensitive writes
trace role-restricted workflow actions
detect high-risk side-effect paths
```

---

## What Success Looks Like

VIBE-SPLAIN should prove that it can:

```txt
1. Scan a business workflow codebase.
2. Identify load-bearing mutation paths.
3. Surface function-level critical actions.
4. Produce an agent-ingestible dossier.
5. Keep Delta targets strict and machine-readable.
6. Use pointers to avoid context collapse.
7. Spawn scoped Worker tasks.
8. Require verifiable proof receipts.
9. Support safe, bounded modernization patches.
10. Produce artifacts a CTO or engineering lead would trust.
```

The benchmark should answer:

```txt
Would this help a real engineering team modernize risky business software faster and safer?
```

---

## Recommended Next Agent Task

The next agent should not code first.

The next agent should research and build the target corpus matrix.

Prompt:

```txt
You are helping define the first commercial target market and public benchmark corpus for VIBE-SPLAIN.

Strategic thesis:
The first target market should be mid-market industrial and operations-heavy software companies modernizing ERP, MES, QMS, CRM, inventory, scheduling, order management, and field-service systems.

Your task:
Find publicly available repositories that resemble this buyer segment and rank them for VIBE-SPLAIN benchmarking.

Search for:
1. TypeScript and JavaScript ERP systems.
2. TypeScript and JavaScript CRM systems.
3. TypeScript and JavaScript inventory and order management systems.
4. Open-source manufacturing, MES, QMS, logistics, and field-service platforms.
5. Domain reference systems like ERPNext, Odoo, OpenEMR, and CARE EMR.

For each repository, collect:
repo_name
repo_url
domain
language
framework
database
license
stars
recent_activity
business workflow richness
database write density
integration density
auth and permission complexity
setup difficulty
modernization task ideas
VIBE_SPLAIN fit score

Prioritize repositories that:
1. are TypeScript or JavaScript
2. contain real business workflows
3. have database writes
4. include auth or permissions
5. include integrations
6. are feasible to run locally
7. resemble software a mid-market business would actually need to modernize

Output:
1. Market thesis validation.
2. Ranked repository matrix.
3. Recommended first 5 benchmark repositories.
4. Suggested modernization tasks for each.
5. Risks and gaps in the public corpus.
```

---

## Strategic Recommendation

Do not build the first benchmark around Cal.com.

Use Cal.com only as a prior stress test.

Build the next benchmark around:

```txt
ERP
CRM
manufacturing workflows
inventory and order management
field service
B2B workflow systems
```

The first market should be practical, painful, and reachable.

Best current wedge:

```txt
Mid-market and PE-backed vertical B2B software companies with legacy workflow-heavy products.
```

Best current corpus direction:

```txt
Carbon
Twenty
ERPNext
Odoo
OpenEMR
CARE EMR
plus smaller TypeScript ERP, CRM, inventory, and order-management repositories
```

The next milestone is a ranked public codebase matrix and a benchmark suite of modernization tasks.
