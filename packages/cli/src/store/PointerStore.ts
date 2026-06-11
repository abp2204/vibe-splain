import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { Mutex } from 'async-mutex';

export interface PointerRow {
  pointerId: string;
  scanId: string;
  artifactName: string;
  contentHash: string;
  blobPath: string;
  schemaVersion: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface WorkOrderRow {
  workOrderId: string;
  intent: string;
  allowedFiles: string;   // JSON array
  allowedGlobs: string;   // JSON array
  deniedGlobs: string;    // JSON array
  requiredProof: string;  // JSON array of ProofDescriptor
  status: 'pending' | 'active' | 'completed' | 'failed' | 'blocked';
  createdAt: number;
}

export interface ProofDescriptor {
  proofId: string;
  schemaName: string;
  description: string;
}

let instance: PointerStore | null = null;

export class PointerStore {
  private db: Database.Database;
  private writeMutex = new Mutex();

  constructor(projectRoot: string) {
    const dir = join(projectRoot, '.vibe-splainer');
    mkdirSync(dir, { recursive: true });
    this.db = new Database(join(dir, 'pointer_store.db'));
    // busy_timeout must be set first — it governs the WAL switch itself
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
  }

  static open(projectRoot: string): PointerStore {
    if (!instance) instance = new PointerStore(projectRoot);
    return instance;
  }

  static reset(): void {
    instance = null;
  }

  private _migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pointers (
        pointerId     TEXT PRIMARY KEY,
        scanId        TEXT NOT NULL,
        artifactName  TEXT NOT NULL,
        contentHash   TEXT NOT NULL,
        blobPath      TEXT NOT NULL,
        schemaVersion TEXT NOT NULL DEFAULT '1.0.0',
        createdAt     INTEGER NOT NULL,
        expiresAt     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pointers_scan ON pointers(scanId);
      CREATE INDEX IF NOT EXISTS idx_pointers_hash ON pointers(contentHash);

      CREATE TABLE IF NOT EXISTS work_orders (
        workOrderId   TEXT PRIMARY KEY,
        intent        TEXT NOT NULL,
        allowedFiles  TEXT NOT NULL DEFAULT '[]',
        allowedGlobs  TEXT NOT NULL DEFAULT '[]',
        deniedGlobs   TEXT NOT NULL DEFAULT '[]',
        requiredProof TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'pending',
        createdAt     INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        receiptId     TEXT PRIMARY KEY,
        workOrderId   TEXT NOT NULL REFERENCES work_orders(workOrderId),
        status        TEXT NOT NULL,
        proofPointers TEXT NOT NULL DEFAULT '[]',
        changedFiles  TEXT NOT NULL DEFAULT '[]',
        summary       TEXT NOT NULL DEFAULT '',
        createdAt     INTEGER NOT NULL,
        FOREIGN KEY (workOrderId) REFERENCES work_orders(workOrderId)
      );
    `);
  }

  async insertPointer(row: PointerRow): Promise<void> {
    await this.writeMutex.runExclusive(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO pointers
          (pointerId, scanId, artifactName, contentHash, blobPath, schemaVersion, createdAt, expiresAt)
        VALUES
          (@pointerId, @scanId, @artifactName, @contentHash, @blobPath, @schemaVersion, @createdAt, @expiresAt)
      `).run(row);
    });
  }

  getPointer(pointerId: string): PointerRow | null {
    return (this.db.prepare('SELECT * FROM pointers WHERE pointerId = ?').get(pointerId) as PointerRow | undefined) ?? null;
  }

  listPointersByScan(scanId: string): PointerRow[] {
    return this.db.prepare('SELECT * FROM pointers WHERE scanId = ?').all(scanId) as PointerRow[];
  }

  async insertWorkOrder(row: WorkOrderRow): Promise<void> {
    await this.writeMutex.runExclusive(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO work_orders
          (workOrderId, intent, allowedFiles, allowedGlobs, deniedGlobs, requiredProof, status, createdAt)
        VALUES
          (@workOrderId, @intent, @allowedFiles, @allowedGlobs, @deniedGlobs, @requiredProof, @status, @createdAt)
      `).run(row);
    });
  }

  getWorkOrder(workOrderId: string): WorkOrderRow | null {
    return (this.db.prepare('SELECT * FROM work_orders WHERE workOrderId = ?').get(workOrderId) as WorkOrderRow | undefined) ?? null;
  }

  async updateWorkOrderStatus(workOrderId: string, status: WorkOrderRow['status']): Promise<void> {
    await this.writeMutex.runExclusive(() => {
      this.db.prepare('UPDATE work_orders SET status = ? WHERE workOrderId = ?').run(status, workOrderId);
    });
  }

  async insertReceipt(receipt: {
    receiptId: string;
    workOrderId: string;
    status: string;
    proofPointers: unknown[];
    changedFiles: unknown[];
    summary: string;
  }): Promise<void> {
    await this.writeMutex.runExclusive(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO receipts
          (receiptId, workOrderId, status, proofPointers, changedFiles, summary, createdAt)
        VALUES
          (@receiptId, @workOrderId, @status, @proofPointers, @changedFiles, @summary, @createdAt)
      `).run({
        ...receipt,
        proofPointers: JSON.stringify(receipt.proofPointers),
        changedFiles: JSON.stringify(receipt.changedFiles),
        createdAt: Date.now(),
      });
    });
  }

  /** GC: delete pointers older than cutoffMs and not pinned, return deleted count */
  async gcScanPointers(keepScanIds: string[]): Promise<number> {
    return await this.writeMutex.runExclusive(() => {
      const placeholders = keepScanIds.map(() => '?').join(',');
      const whereClause = keepScanIds.length > 0
        ? `WHERE scanId NOT IN (${placeholders})`
        : '';
      const result = this.db.prepare(`DELETE FROM pointers ${whereClause}`).run(...keepScanIds);
      return result.changes;
    });
  }

  listAllScanIds(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT scanId FROM pointers').all() as { scanId: string }[];
    return rows.map(r => r.scanId);
  }

  countPointers(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM pointers').get() as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
    instance = null;
  }
}
