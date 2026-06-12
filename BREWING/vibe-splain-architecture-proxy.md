# VIBE-SPLAIN & Shadow Proxy Architecture

## 1. The Dual-Layer Proxy System
To ensure 100% safety during legacy migrations, VIBE-SPLAIN does not just analyze code; it powers a runtime **Dual-Layer Proxy** deployed securely within the client's own VPC (via Docker/Helm).

### Layer 1: The "Risk Router" (Outer Proxy)
This proxy acts as a progressive blast-radius controller. It reads the VIBE-SPLAIN static risk dossier in real-time. 
*   If a network route (e.g., `/checkout`) is marked as **High-Risk** in the dossier, the Risk Router refuses to shadow it. It routes the traffic straight to the legacy JavaScript code, protecting the system from incomplete migrations.
*   It only allows **Low-Risk** or explicitly approved traffic to proceed to the shadowing phase.

### Layer 2: The "Migration Shadow" (Inner Proxy)
When the Risk Router permits traffic to pass through, this inner proxy executes the Strangler Fig pattern. 
*   It duplicates the incoming traffic.
*   It sends the traffic to both the old JS and the newly generated TS code.
*   It drops the TS response from being sent to the user.
*   It mathematically compares the database mutations and JSON payloads of both responses to verify 0% divergence.

## 2. Gravity-Driven Incremental Recalculation (Compute Optimization)
VIBE-SPLAIN runs continuously in the CI/CD pipeline, but it is highly optimized. It uses the AST **Gravity Map** (which measures how many files depend on a given file) to minimize compute:
*   Instead of doing a massive, expensive re-scan of the entire ERP codebase after every merged patch, VIBE-SPLAIN only re-parses the changed file and its immediate dependency radius.
*   It generates a tiny JSON diff.
*   It writes that diff to a **Shared Volume** that the Proxy is watching. The proxy hot-reloads the new risk rules instantly without ever restarting the Docker container. 

## 3. Heat-Driven Shadowing Thresholds (Safety Optimization)
The system uses the AST **Heat Map** (which measures mutation density and database writes) to determine exactly *when* a migration is considered verified and complete.
*   **Low-Heat Migrations:** (e.g., a simple UI component that just reads data) The Shadow Proxy only requires 100 successful, identical requests. Once it hits 100, the Risk Router automatically promotes the new TypeScript code to the primary route.
*   **High-Heat Migrations:** (e.g., core inventory logic that writes to multiple tables) The Shadow Proxy enforces a strict probation. It must process 1,000+ shadowed requests with a mathematically perfect 0% divergence before the Risk Router trusts it.

## 4. Telemetry Feedback Loop (Self-Healing)
If the Shadow Proxy detects that a legacy JavaScript function does something at runtime that VIBE-SPLAIN missed during static analysis (like a dynamic, undocumented API call), the Proxy sends telemetry data backward. VIBE-SPLAIN updates its dossier, the coding agent halts, reads the new "Runtime + Static" truth, and fixes the TypeScript patch.
