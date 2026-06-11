# VIBE-SPLAIN: Final Iteration Roadmap
**Document Type:** Engineering Hit List
**Focus:** Final standalone polish and Delta Engine handoff preparation

This document outlines the final five concrete engineering improvements required to perfect VIBE-SPLAIN as a standalone architectural audit tool and seamlessly bridge it to the Delta Engine runtime environment.

---

## 1. Graph & Pillar Mechanics (The Map)

### 1.1 Directory-Weighted Label Propagation
* **What it is trying to fix:** "Domain Bleed." Currently, the community detection algorithm treats all import edges equally. This results in backend logic (e.g., `melody_generator.py` or database controllers) being improperly grouped into frontend `Ui` pillars simply because the frontend imports them heavily.
* **Why this fixes it:** By injecting a penalty weight into the graph edges during the label propagation phase, we can force the algorithm to respect intended architectural boundaries. If an import crosses a top-level directory boundary (e.g., `src/engines/` to `src/ui/`), the algorithm weakens that edge by 50%, ensuring files stay clustered within their actual structural domains.

### 1.2 Mega-Pillar Subdivision
* **What it is trying to fix:** "Bloated Pillars." In modern meta-frameworks like Next.js or React, 80% of the files are often UI components. The current Phase 1 heuristics will successfully group them, but dumping 40+ files into a single "Components" pillar makes the dossier unreadable and un-actionable.
* **Why this fixes it:** Implementing a secondary heuristic split for any pillar exceeding ~15 files breaks the monolith down. By sub-dividing based on statefulness (e.g., separating files containing `useState`/`useEffect` from pure presentational components) or routing conventions (e.g., `app/` routers vs. shared components), the dossier maintains high resolution even on massive codebases.

---

## 2. Agent Calibration & Noise Reduction (The Output)

### 2.1 Dynamic Confidence Prompting
* **What it is trying to fix:** "Eroded Trust." The LLM is currently hardcoding `"confidence": "high"` on every single Decision Card. Claiming high confidence on subjective stylistic choices (like a custom abstraction wrapper) ruins the credibility of the entire dashboard.
* **Why this fixes it:** By updating the `write_decision_card` tool prompt to explicitly ban defaulting to "high", we force the agent to evaluate its own certainty. The agent will be instructed to score subjective abstractions as "low" or "medium", strictly reserving "high" confidence for provable execution anti-patterns (e.g., swallowed exceptions, synchronous thread blocking).

### 2.2 Aggressive Boilerplate Culling
* **What it is trying to fix:** "Framework Noise." The engine still awards "participation trophies" for standard framework conventions, generating Severity 1 cards for files that are just doing what the framework dictates (e.g., a standard Next.js `lib/db.ts` connection pool).
* **Why this fixes it:** Adding a post-processing filter before the JSON dossier renders ensures enterprise-grade signal-to-noise ratio. If a card is tagged as Severity 1 AND its category is "Convention", it is aggressively dropped from the final output unless it contains a highly specific structural deviation. 

---

## 3. The Delta Engine Bridge (The Handoff)

### 3.1 The "Target Lock" Payload
* **What it is trying to fix:** "The Execution Gap." VIBE-SPLAIN successfully acts as the MRI, mapping the blast radius and identifying the bottlenecks. However, Delta Engine (the surgeon) currently has no automated way to ingest this map to begin its shadowing operations.
* **Why this fixes it:** Alongside the visual `index.html` dossier, VIBE-SPLAIN will compile and output a strictly machine-readable `delta_targets.json`. This file isolates only the Severity 4 and 5 files, extracting the file paths, the specific function names of the bottlenecks, and the explicit structural intent. This creates the exact, automated configuration payload that the eBPF proxy requires to lock on and begin cloning traffic.
