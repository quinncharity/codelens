import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AnalysisResultData } from "./models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisRecord {
  id: string;
  gitUrl: string;
  ref: string;
  status: string; // RUNNING | SUCCEEDED | FAILED
  result: AnalysisResultData | null;
  error: string;
}

export interface RepoSummaryRecord {
  gitUrl: string;
  ref: string;
  lastAnalysisId: string;
  lastStatus: string;
  lastUpdatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class SQLiteStore {
  private db: Database.Database | null = null;

  constructor(private dbPath: string) {}

  init(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        git_url TEXT NOT NULL,
        ref TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        result_json TEXT,
        error TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_analyses_repo_updated
      ON analyses (git_url, ref, updated_at)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_analyses_updated
      ON analyses (updated_at)
    `);
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error("Store not initialized. Call init() first.");
    return this.db;
  }

  create(params: { id: string; gitUrl: string; ref: string }): void {
    const now = nowIso();
    this.getDb()
      .prepare(
        `INSERT INTO analyses (id, git_url, ref, status, created_at, updated_at, result_json, error)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '')`,
      )
      .run(params.id, params.gitUrl, params.ref, "RUNNING", now, now);
  }

  setSucceeded(params: { id: string; result: AnalysisResultData }): void {
    const now = nowIso();
    const payload = JSON.stringify(params.result);
    this.getDb()
      .prepare(
        `UPDATE analyses
         SET status = ?, updated_at = ?, result_json = ?, error = ''
         WHERE id = ?`,
      )
      .run("SUCCEEDED", now, payload, params.id);
  }

  setFailed(params: { id: string; error: string }): void {
    const now = nowIso();
    this.getDb()
      .prepare(
        `UPDATE analyses
         SET status = ?, updated_at = ?, error = ?
         WHERE id = ?`,
      )
      .run("FAILED", now, params.error, params.id);
  }

  get(params: { id: string }): AnalysisRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT id, git_url, ref, status, result_json, error
         FROM analyses WHERE id = ?`,
      )
      .get(params.id) as
      | {
          id: string;
          git_url: string;
          ref: string;
          status: string;
          result_json: string | null;
          error: string | null;
        }
      | undefined;

    if (!row) return null;

    let result: AnalysisResultData | null = null;
    if (row.result_json) {
      try {
        result = JSON.parse(row.result_json) as AnalysisResultData;
      } catch {
        result = null;
      }
    }

    return {
      id: row.id,
      gitUrl: row.git_url,
      ref: row.ref,
      status: row.status,
      result,
      error: row.error ?? "",
    };
  }

  listRepos(params: {
    limit: number;
    offset: number;
  }): RepoSummaryRecord[] {
    const rows = this.getDb()
      .prepare(
        `SELECT git_url, ref, id, status, updated_at
         FROM (
           SELECT
             id, git_url, ref, status, updated_at, created_at,
             ROW_NUMBER() OVER (
               PARTITION BY git_url, ref
               ORDER BY updated_at DESC, created_at DESC, id DESC
             ) AS rn
           FROM analyses
         )
         WHERE rn = 1
         ORDER BY updated_at DESC, git_url ASC, ref ASC
         LIMIT ? OFFSET ?`,
      )
      .all(params.limit, params.offset) as Array<{
      git_url: string;
      ref: string;
      id: string;
      status: string;
      updated_at: string;
    }>;

    return rows.map((r) => ({
      gitUrl: r.git_url,
      ref: r.ref,
      lastAnalysisId: r.id,
      lastStatus: r.status,
      lastUpdatedAt: r.updated_at,
    }));
  }

  deleteRepo(params: { gitUrl: string; ref: string }): number {
    const info = this.getDb()
      .prepare(`DELETE FROM analyses WHERE git_url = ? AND ref = ?`)
      .run(params.gitUrl, params.ref);
    return info.changes;
  }
}
