'use server';

/**
 * All database operations exposed as Next.js Server Actions.
 * Components import from here; no Supabase client needed.
 */

import { getDb, newId, nowIso, toJson, fromJson } from '@/lib/db';
import type { ClientRecord } from '@/lib/schema/datagrows';
import type { SourceType } from '@/lib/schema/sources';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SessionListItem {
  id: string;
  status: string;
  created_at: string;
  operator_name: string | null;
  firm_name: string;
}

export interface SessionDetail {
  id: string;
  firm_id: string;
  status: string;
  operator_name: string | null;
  notes: string | null;
  firm_name: string;
}

export interface UploadRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  row_count: number | null;
  detected_columns: string[] | null;
  created_at: string;
}

export interface UploadWithMapping extends UploadRow {
  column_mapping: Record<string, string> | null;
}

export interface RawRecord {
  id: string;
  data: Record<string, unknown>;
}

export interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[];
  archived: boolean;
  archive_reason: string | null;
  primary_key_value: string;
}

export interface ClusterInsert {
  session_id: string;
  primary_key_type: string;
  primary_key_value: string;
  merged: ClientRecord;
  flags: unknown[];
  conflicts: Record<string, unknown>;
  sources: string[];
  archived: boolean;
  archive_reason: string | null;
}

export interface EditRow {
  id: string;
  cluster_id: string;
  field_key: string;
  old_value: unknown;
  new_value: unknown;
  operator: string | null;
  created_at: string;
  client_name: string;
}

export interface StaffMember {
  id: string;
  name: string;
  roles: string[];
  created_at: string;
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function listSessions(): Promise<SessionListItem[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.status, s.created_at, s.operator_name, f.name AS firm_name
    FROM sessions s
    JOIN firms f ON f.id = s.firm_id
    ORDER BY s.created_at DESC
    LIMIT 50
  `).all() as Array<{
    id: string; status: string; created_at: string;
    operator_name: string | null; firm_name: string;
  }>;
  return rows;
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id, s.firm_id, s.status, s.operator_name, s.notes, f.name AS firm_name
    FROM sessions s
    JOIN firms f ON f.id = s.firm_id
    WHERE s.id = ?
  `).get(id) as (SessionDetail & { firm_name: string }) | undefined;
  return row ?? null;
}

export async function createFirmAndSession(
  firmName: string,
  operatorName: string | null,
): Promise<{ sessionId: string; error: string | null }> {
  try {
    const db = getDb();
    const firmId = newId();
    const sessionId = newId();
    const ts = nowIso();

    db.transaction(() => {
      db.prepare('INSERT INTO firms (id, name, created_at) VALUES (?,?,?)').run(firmId, firmName, ts);
      db.prepare(
        'INSERT INTO sessions (id, firm_id, status, created_at, updated_at, operator_name) VALUES (?,?,?,?,?,?)',
      ).run(sessionId, firmId, 'uploading', ts, ts, operatorName ?? null);
    })();

    return { sessionId, error: null };
  } catch (err) {
    return { sessionId: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateSessionNotes(id: string, notes: string): Promise<void> {
  getDb().prepare('UPDATE sessions SET notes=?, updated_at=? WHERE id=?').run(notes, nowIso(), id);
}

export async function updateSessionStatus(id: string, status: string): Promise<void> {
  getDb().prepare('UPDATE sessions SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), id);
}

// ── Uploads ────────────────────────────────────────────────────────────────

export async function getUploads(sessionId: string): Promise<UploadRow[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, file_name, source_type, row_count, detected_columns, created_at
    FROM uploads WHERE session_id=? ORDER BY created_at ASC
  `).all(sessionId) as Array<{
    id: string; file_name: string; source_type: string;
    row_count: number | null; detected_columns: string | null; created_at: string;
  }>;
  return rows.map((r) => ({
    ...r,
    source_type: r.source_type as SourceType,
    detected_columns: fromJson<string[]>(r.detected_columns),
  }));
}

export async function getUploadsWithMappings(sessionId: string): Promise<UploadWithMapping[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, file_name, source_type, row_count, detected_columns, column_mapping, created_at
    FROM uploads WHERE session_id=?
  `).all(sessionId) as Array<{
    id: string; file_name: string; source_type: string;
    row_count: number | null; detected_columns: string | null;
    column_mapping: string | null; created_at: string;
  }>;
  return rows.map((r) => ({
    ...r,
    source_type: r.source_type as SourceType,
    detected_columns: fromJson<string[]>(r.detected_columns),
    column_mapping: fromJson<Record<string, string>>(r.column_mapping),
  }));
}

export async function createUpload(input: {
  sessionId: string;
  sourceType: SourceType;
  fileName: string;
  storagePath: string;
  rowCount: number;
  detectedColumns: string[];
}): Promise<{ uploadId: string; error: string | null }> {
  try {
    const db = getDb();
    const id = newId();
    db.prepare(`
      INSERT INTO uploads (id, session_id, source_type, file_name, storage_path, row_count, detected_columns, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      id, input.sessionId, input.sourceType, input.fileName,
      input.storagePath, input.rowCount,
      toJson(input.detectedColumns), nowIso(),
    );
    return { uploadId: id, error: null };
  } catch (err) {
    return { uploadId: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function insertRawRecords(
  uploadId: string,
  rows: Array<{ row_index: number; data: Record<string, unknown> }>,
): Promise<{ error: string | null }> {
  try {
    const db = getDb();
    const stmt = db.prepare('INSERT INTO raw_records (id, upload_id, row_index, data) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const row of rows) {
        stmt.run(newId(), uploadId, row.row_index, toJson(row.data));
      }
    })();
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getRawRecords(uploadId: string): Promise<RawRecord[]> {
  const db = getDb();
  const rows = db.prepare('SELECT id, data FROM raw_records WHERE upload_id=? ORDER BY row_index ASC').all(uploadId) as Array<{ id: string; data: string }>;
  return rows.map((r) => ({ id: r.id, data: fromJson<Record<string, unknown>>(r.data) ?? {} }));
}

export async function saveColumnMapping(uploadId: string, mapping: Record<string, string>): Promise<void> {
  getDb().prepare('UPDATE uploads SET column_mapping=? WHERE id=?').run(toJson(mapping), uploadId);
}

// ── Clusters ───────────────────────────────────────────────────────────────

export async function deleteClusters(sessionId: string): Promise<void> {
  getDb().prepare('DELETE FROM clusters WHERE session_id=?').run(sessionId);
}

export async function insertClusters(rows: ClusterInsert[]): Promise<{ error: string | null }> {
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO clusters
        (id, session_id, primary_key_type, primary_key_value, merged, flags, conflicts, sources, archived, archive_reason, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    db.transaction(() => {
      for (const r of rows) {
        stmt.run(
          newId(), r.session_id, r.primary_key_type, r.primary_key_value,
          toJson(r.merged), toJson(r.flags), toJson(r.conflicts), toJson(r.sources),
          r.archived ? 1 : 0, r.archive_reason ?? null, nowIso(),
        );
      }
    })();
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getClusters(sessionId: string): Promise<ClusterRow[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, merged, sources, archived, archive_reason, primary_key_value
    FROM clusters WHERE session_id=?
  `).all(sessionId) as Array<{
    id: string; merged: string; sources: string;
    archived: number; archive_reason: string | null; primary_key_value: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    merged: fromJson<ClientRecord>(r.merged) ?? ({} as ClientRecord),
    sources: fromJson<string[]>(r.sources) ?? [],
    archived: r.archived === 1,
    archive_reason: r.archive_reason,
    primary_key_value: r.primary_key_value ?? '',
  }));
}

export async function updateClusterMerged(clusterId: string, merged: ClientRecord): Promise<void> {
  getDb().prepare('UPDATE clusters SET merged=? WHERE id=?').run(toJson(merged), clusterId);
}

// ── Edits ──────────────────────────────────────────────────────────────────

export async function insertEdit(input: {
  clusterId: string;
  fieldKey: string;
  oldValue: unknown;
  newValue: unknown;
  operator: string | null;
}): Promise<void> {
  getDb().prepare(`
    INSERT INTO edits (id, cluster_id, field_key, old_value, new_value, operator, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(newId(), input.clusterId, input.fieldKey, toJson(input.oldValue), toJson(input.newValue), input.operator ?? null, nowIso());
}

export async function getEdits(sessionId: string): Promise<EditRow[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.id, e.cluster_id, e.field_key, e.old_value, e.new_value, e.operator, e.created_at,
           c.merged AS cluster_merged
    FROM edits e
    JOIN clusters c ON c.id = e.cluster_id
    WHERE c.session_id = ?
    ORDER BY e.created_at DESC
  `).all(sessionId) as Array<{
    id: string; cluster_id: string; field_key: string;
    old_value: string | null; new_value: string | null;
    operator: string | null; created_at: string; cluster_merged: string;
  }>;
  return rows.map((r) => {
    const merged = fromJson<Record<string, unknown>>(r.cluster_merged) ?? {};
    return {
      id: r.id,
      cluster_id: r.cluster_id,
      field_key: r.field_key,
      old_value: fromJson(r.old_value),
      new_value: fromJson(r.new_value),
      operator: r.operator,
      created_at: r.created_at,
      client_name: merged.client_name ? String(merged.client_name) : r.cluster_id.slice(0, 8),
    };
  });
}

// ── Staff ──────────────────────────────────────────────────────────────────

export async function getStaff(firmId: string): Promise<StaffMember[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, roles, created_at FROM firm_staff WHERE firm_id=? ORDER BY name
  `).all(firmId) as Array<{ id: string; name: string; roles: string; created_at: string }>;
  return rows.map((r) => ({ ...r, roles: fromJson<string[]>(r.roles) ?? [] }));
}

export async function addStaff(input: {
  firmId: string;
  name: string;
  roles: string[];
}): Promise<{ error: string | null }> {
  try {
    const db = getDb();
    db.prepare('INSERT INTO firm_staff (id, firm_id, name, roles, created_at) VALUES (?,?,?,?,?)')
      .run(newId(), input.firmId, input.name, toJson(input.roles), nowIso());
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteStaff(id: string): Promise<void> {
  getDb().prepare('DELETE FROM firm_staff WHERE id=?').run(id);
}

