/**
 * Merge layer.
 *
 * Takes a cluster (multiple records for the same end-client from different
 * sources) and produces ONE canonical ClientRecord.
 *
 * Rules:
 *  - For each field, iterate FIELD_PRIORITY[key] in order and take the first
 *    non-empty value.
 *  - If two sources disagree on a field that's in neither's first-place slot,
 *    the priority winner still takes it, but the loser is recorded in
 *    _conflicts for the review UI to display.
 *  - Sources that contributed are listed in _sources.
 */

import { DATAGROWS_FIELDS, type ClientRecord, type FieldDef } from '../schema/datagrows';
import { priorityFor, type SourceType } from '../schema/sources';
import type { Cluster } from '../matcher';

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

export function mergeCluster(cluster: Cluster): ClientRecord {
  const merged: ClientRecord = {};
  const conflicts: Record<string, Array<{ source: string; value: unknown }>> = {};
  const sourcesSet = new Set<SourceType>();

  // Index members by source for quick priority lookup
  const bySource = new Map<SourceType, ClientRecord[]>();
  for (const m of cluster.members) {
    sourcesSet.add(m.source);
    const list = bySource.get(m.source) ?? [];
    list.push(m.data);
    bySource.set(m.source, list);
  }

  for (const field of DATAGROWS_FIELDS) {
    const key = field.key;
    const priority = priorityFor(key);

    let winner: { value: unknown; source: SourceType } | null = null;
    const seenValues: Array<{ source: SourceType; value: unknown }> = [];

    for (const src of priority) {
      const records = bySource.get(src);
      if (!records) continue;
      for (const rec of records) {
        const v = (rec as Record<string, unknown>)[key];
        if (isEmpty(v)) continue;
        seenValues.push({ source: src, value: v });
        if (!winner) winner = { value: v, source: src };
      }
    }

    // Also check sources that aren't in the priority list — for audit trail
    for (const [src, records] of bySource.entries()) {
      if (priority.includes(src)) continue;
      for (const rec of records) {
        const v = (rec as Record<string, unknown>)[key];
        if (isEmpty(v)) continue;
        seenValues.push({ source: src, value: v });
        if (!winner) winner = { value: v, source: src };
      }
    }

    if (winner) {
      (merged as Record<string, unknown>)[key] = winner.value;

      // If multiple sources had DIFFERENT non-empty values, log conflict
      const distinct = new Set(seenValues.map((s) => JSON.stringify(s.value)));
      if (distinct.size > 1) {
        conflicts[key] = seenValues;
      }
    }
  }

  merged._sources = Array.from(sourcesSet);
  if (Object.keys(conflicts).length > 0) merged._conflicts = conflicts;
  merged._cluster_id = cluster.id;

  // Enum sanitizer — flag any enum field whose merged value is not in the allowed list.
  // Does NOT change the value; validator will catch it. Flag gives Review UI early signal.
  const invalidEnumFlags: Record<string, string> = {};
  for (const field of DATAGROWS_FIELDS as readonly FieldDef[]) {
    if (field.type !== 'enum' || !field.enum) continue;
    const v = (merged as Record<string, unknown>)[field.key];
    if (v === undefined || v === null || v === '') continue;
    if (!field.enum.includes(String(v))) {
      invalidEnumFlags[field.key] = String(v);
    }
  }
  if (Object.keys(invalidEnumFlags).length > 0) {
    merged._invalid_enums = invalidEnumFlags;
  }

  return merged;
}

export function mergeAllClusters(clusters: Cluster[]): ClientRecord[] {
  return clusters.map((c) => {
    const rec = mergeCluster(c);
    if (c.archived) {
      rec._archived = true;
      rec._archive_reason = c.archiveReason;
    }
    return rec;
  });
}
