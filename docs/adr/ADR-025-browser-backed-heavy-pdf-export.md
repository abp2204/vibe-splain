# ADR-025: Browser-Backed Heavy PDF Export

## Status
Accepted

## Context
`dossier.pdf` is a stakeholder artifact. The HTML report already contains complex layouts, Mermaid diagrams, and interactive components. Using a lightweight PDF library would require maintaining a second visual rendering path and would likely fail to accurately reproduce the HTML design.

## Decision
We will treat PDF as a "heavy" optional export generated via a headless browser.

1. **Technology Selection**:
    - Use Playwright (or a similar headless browser library) to render the `dossier.html` and print to PDF.
    - This ensures 100% visual fidelity between the web and PDF versions.

2. **Dependency Management**:
    - PDF support is **optional** and not included in the core installation dependencies.
    - The CLI will only check for the browser runtime if the `--format pdf` flag is explicitly passed.
    - If the runtime is missing, the `ExportOrchestrator` provides clear installation instructions.

3. **Rendering Path**:
    - The Orchestrator first ensures `dossier.html` is successfully written to staging.
    - It then launches the browser, points it at the staged file, waits for Mermaid/React initialization, and triggers the PDF print.

## Consequences
- Core CLI remains lightweight and fast to install.
- Stakeholders get a high-quality, professional report.
- Reduces maintenance overhead by reusing the existing HTML/CSS investment.
