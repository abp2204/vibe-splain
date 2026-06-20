import { readAnalysis, RecommendationEngine, buildGateIndex } from '@vibe-splain/brain';
import type { Dossier, DossierViewModel, AnalysisStore, ImportGraph } from '@vibe-splain/brain';
import { ArtifactBundleWriter, type Artifact } from './ArtifactBundleWriter.js';
import { JsonRenderer } from './renderers/JsonRenderer.js';
import { HtmlRenderer } from './renderers/HtmlRenderer.js';
import { AgentMarkdownRenderer } from './renderers/AgentMarkdownRenderer.js';
import { ValidationRenderer } from './renderers/ValidationRenderer.js';
import { RawAnalysisRenderer } from './renderers/RawAnalysisRenderer.js';
import { GraphRenderer } from './renderers/GraphRenderer.js';
import { BlobStore, computeHash } from '../store/BlobStore.js';
import { PointerStore } from '../store/PointerStore.js';
import { v4 as uuidv4 } from 'uuid';

export interface ExportOptions {
  format?: 'json' | 'html' | 'markdown' | 'delta';
  budget?: number;
  scope?: string;
}

export interface ManifestArtifactEntry {
  name: string;
  pointer: string;
  contentHash: string;
  sizeBytes: number;
  indexes?: Record<string, string>;
  hydrators?: string[];
}

export interface ScanManifest {
  schemaVersion: '2.0.0';
  scanId: string;
  generatedAt: string;
  projectRoot: string;
  artifacts: ManifestArtifactEntry[];
}

export class ExportOrchestrator {
  constructor(private projectRoot: string) {}

  async writeBundle(
    dossier: Dossier,
    options: ExportOptions = {},
    store?: AnalysisStore,
    graph?: ImportGraph,
    scanId?: string,
  ): Promise<{ scanId: string; manifestPointer: string }> {
    const finalStore = store || await readAnalysis(this.projectRoot);
    if (!finalStore) {
      throw new Error('Analysis store not found. Scan the project first.');
    }

    // Aggressive Boilerplate Culling
    for (const p of dossier.pillars) {
      p.decisions = p.decisions.filter(c => !(c.severity === 1 && c.category === 'Convention'));
      p.cardCount = p.decisions.length;
    }

    const viewModel = this.buildViewModel(dossier, finalStore);

    const artifacts: Artifact[] = [];

    artifacts.push(...await new JsonRenderer().render(viewModel, finalStore));
    artifacts.push(...await new ValidationRenderer().render(viewModel, finalStore));
    artifacts.push(...await new RawAnalysisRenderer().render(viewModel, finalStore));

    if (graph) {
      artifacts.push(...await new GraphRenderer(graph).render(viewModel, finalStore));
    }

    const gateIndex = buildGateIndex(finalStore);
    artifacts.push({
      type: 'gate',
      path: 'gate.json',
      content: JSON.stringify(gateIndex, null, 2),
    });

    // Determine additional formats
    const formats = ['html', 'markdown']; // default
    if (options.format && options.format !== 'json' && options.format !== 'delta') {
      formats.length = 0;
      formats.push(options.format);
    }

    if (formats.includes('html')) {
      artifacts.push(...await new HtmlRenderer().render(viewModel, finalStore));
    }

    if (formats.includes('markdown')) {
      artifacts.push(...await new AgentMarkdownRenderer(options.budget).render(viewModel, finalStore));
    }

    const writer = new ArtifactBundleWriter(this.projectRoot);
    await writer.writeBundle(artifacts);

    // Register artifacts in BlobStore + PointerStore and build manifest
    const effectiveScanId = scanId ?? `scan_${Date.now()}`;
    const blobStore = new BlobStore(this.projectRoot);
    const pointerStore = PointerStore.open(this.projectRoot);
    const now = Date.now();

    const manifestEntries: ManifestArtifactEntry[] = [];

    for (const artifact of artifacts) {
      const content = typeof artifact.content === 'string'
        ? Buffer.from(artifact.content, 'utf8')
        : artifact.content;
      const { contentHash, blobPath } = await blobStore.writeAtomic(content);
      const pointerId = `ptr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

      await pointerStore.insertPointer({
        pointerId,
        scanId: effectiveScanId,
        artifactName: artifact.type,
        contentHash,
        blobPath,
        schemaVersion: '1.0.0',
        createdAt: now,
        expiresAt: null,
      });

      const entry: ManifestArtifactEntry = {
        name: artifact.type,
        pointer: pointerId,
        contentHash,
        sizeBytes: content.length,
      };

      // Attach hydrator hints for the large analysis artifact
      if (artifact.type === 'analysis') {
        entry.hydrators = ['get_project_summary', 'get_start_here'];

        // Generate analysis.index.json (Start-Here + Top-Heat)
        const analysisIndex = {
          schemaVersion: '1.0.0',
          scanId: effectiveScanId,
          startHere: dossier.map.topGravity.slice(0, 12),
          topHeat: dossier.map.topHeat.slice(0, 12),
          pillarSummary: dossier.map.pillars.map(p => ({
            name: p.name,
            fileCount: p.memberFiles?.length ?? 0,
          })),
          totalFiles: Object.keys(finalStore.files).length,
          realSourceFiles: Object.values(finalStore.files).filter(f => f.isRealSource).length,
        };
        const indexContent = Buffer.from(JSON.stringify(analysisIndex, null, 2), 'utf8');
        const indexWrite = await blobStore.writeAtomic(indexContent);
        const indexPointerId = `ptr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
        await pointerStore.insertPointer({
          pointerId: indexPointerId,
          scanId: effectiveScanId,
          artifactName: 'analysis.index',
          contentHash: indexWrite.contentHash,
          blobPath: indexWrite.blobPath,
          schemaVersion: '1.0.0',
          createdAt: now,
          expiresAt: null,
        });
        entry.indexes = { startHere: indexPointerId };
      }

      manifestEntries.push(entry);
    }

    // Write and register the scan manifest itself
    const manifest: ScanManifest = {
      schemaVersion: '2.0.0',
      scanId: effectiveScanId,
      generatedAt: new Date(now).toISOString(),
      projectRoot: this.projectRoot,
      artifacts: manifestEntries,
    };
    const manifestContent = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    const manifestWrite = await blobStore.writeAtomic(manifestContent);
    const manifestPointerId = `ptr_manifest_${effectiveScanId}`;
    await pointerStore.insertPointer({
      pointerId: manifestPointerId,
      scanId: effectiveScanId,
      artifactName: 'artifact_manifest',
      contentHash: manifestWrite.contentHash,
      blobPath: manifestWrite.blobPath,
      schemaVersion: '2.0.0',
      createdAt: now,
      expiresAt: null,
    });

    return { scanId: effectiveScanId, manifestPointer: manifestPointerId };
  }

  private buildViewModel(dossier: Dossier, store: AnalysisStore): DossierViewModel {
    const recommendations: Record<string, any[]> = {};
    
    for (const file of dossier.map.topGravity) {
      const persisted = store.files[file];
      if (persisted) {
        recommendations[file] = RecommendationEngine.generateRecommendations(persisted);
      }
    }
    for (const file of dossier.map.topHeat) {
      if (!recommendations[file]) {
         const persisted = store.files[file];
         if (persisted) {
            recommendations[file] = RecommendationEngine.generateRecommendations(persisted);
         }
      }
    }

    return {
      ...dossier,
      recommendations,
    };
  }
}
