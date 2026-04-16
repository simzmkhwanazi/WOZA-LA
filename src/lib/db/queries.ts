/**
 * Direct (non-action) server-side DB helpers.
 * Import only in API routes and server components — never in client components.
 */

import { getDb, fromJson, toJson, newId, nowIso } from '@/lib/db';
import type { ClientRecord } from '@/lib/schema/datagrows';

export interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[];
  archived: boolean;
  archive_reason: string | null;
  primary_key_value: string;
}

export function getSessionWithFirm(sessionId: string): { firmName: string } | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT f.name AS firm_name FROM sessions s JOIN firms f ON f.id = s.firm_id WHERE s.id=?
  `).get(sessionId) as { firm_name: string } | undefined;
  return row ? { firmName: row.firm_name } : null;
}

export function getClusters(sessionId: string): ClusterRow[] {
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

export function setSessionStatus(id: string, status: string): void {
  getDb().prepare('UPDATE sessions SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), id);
}

// Keep toJson/newId available for re-export if needed elsewhere
export { toJson, newId };
