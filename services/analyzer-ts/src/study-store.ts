import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InteractionEventRow {
  userId: string;
  sessionId: string;
  eventType: string;
  targetElementId: string;
  timestampMs: number;
  durationMs: number;
  metadataJson: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// StudyStore — thin persistence layer for interaction events
// ---------------------------------------------------------------------------

export class StudyStore {
  constructor(private db: Database.Database) {}

  /** Create the interaction_events table (idempotent). */
  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interaction_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT    NOT NULL,
        session_id    TEXT    NOT NULL,
        event_type    TEXT    NOT NULL,
        target_element_id TEXT NOT NULL DEFAULT '',
        timestamp_ms  INTEGER NOT NULL,
        duration_ms   INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        received_at   TEXT    NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_interaction_session
      ON interaction_events (session_id, timestamp_ms)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_interaction_user
      ON interaction_events (user_id, timestamp_ms)
    `);
  }

  /** Insert a batch of events inside a single transaction. */
  insertBatch(events: InteractionEventRow[]): number {
    if (events.length === 0) return 0;

    const now = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO interaction_events
         (user_id, session_id, event_type, target_element_id, timestamp_ms, duration_ms, metadata_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction((rows: InteractionEventRow[]) => {
      for (const e of rows) {
        insert.run(
          e.userId,
          e.sessionId,
          e.eventType,
          e.targetElementId,
          e.timestampMs,
          e.durationMs,
          e.metadataJson ?? null,
          now,
        );
      }
      return rows.length;
    });

    return tx(events);
  }
}
