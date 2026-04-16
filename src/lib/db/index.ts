/**
 * Local SQLite database — replaces Supabase Postgres.
 * DB file: <project-root>/data/woza-la.db
 * Uploads: <project-root>/data/uploads/
 *
 * Server-only. Never import this from client components.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'woza-la.db');

// Ensure directories exist on first import
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  return _db;
}

export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

// ── Schema ─────────────────────────────────────────────────────────────────

function _initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS firms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS firm_staff (
      id          TEXT PRIMARY KEY,
      firm_id     TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      roles       TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      firm_id       TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'uploading',
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      exported_at   TEXT,
      operator_name TEXT,
      notes         TEXT
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_type      TEXT NOT NULL,
      file_name        TEXT NOT NULL,
      storage_path     TEXT NOT NULL,
      row_count        INTEGER,
      detected_columns TEXT,
      column_mapping   TEXT,
      created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS raw_records (
      id         TEXT PRIMARY KEY,
      upload_id  TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      row_index  INTEGER NOT NULL,
      data       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS raw_records_upload_idx ON raw_records(upload_id);

    CREATE TABLE IF NOT EXISTS mapped_records (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      upload_id    TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      source_type  TEXT NOT NULL,
      row_index    INTEGER NOT NULL,
      data         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mapped_records_session_idx ON mapped_records(session_id);

    CREATE TABLE IF NOT EXISTS clusters (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      primary_key_type  TEXT,
      primary_key_value TEXT,
      merged            TEXT NOT NULL,
      flags             TEXT NOT NULL DEFAULT '[]',
      conflicts         TEXT NOT NULL DEFAULT '{}',
      sources           TEXT NOT NULL DEFAULT '[]',
      archived          INTEGER NOT NULL DEFAULT 0,
      archive_reason    TEXT,
      created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS clusters_session_idx ON clusters(session_id);

    CREATE TABLE IF NOT EXISTS cluster_members (
      cluster_id       TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      mapped_record_id TEXT NOT NULL REFERENCES mapped_records(id) ON DELETE CASCADE,
      PRIMARY KEY (cluster_id, mapped_record_id)
    );

    CREATE TABLE IF NOT EXISTS edits (
      id          TEXT PRIMARY KEY,
      cluster_id  TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
      field_key   TEXT NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      operator    TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

// ── JSON helpers ───────────────────────────────────────────────────────────

export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

export function fromJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}
