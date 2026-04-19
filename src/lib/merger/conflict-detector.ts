/**
 * Incremental import conflict detection.
 *
 * When a new file is imported into an existing session that already has
 * clusters, this module compares the incoming mapped record against the
 * existing merged cluster value and surfaces field-level conflicts.
 *
 * Conflict resolution modes:
 *   keep_manual  — preserve the clerk's prior edit (sticky)
 *   accept_source — use the new source value (overwrites)
 */

import type { ClientRecord } from '../schema/datagrows';
import { DATAGROWS_FIELDS } from '../schema/datagrows';

export type ResolutionMode = 'keep_manual' | 'accept_source';

export interface FieldConflict {
  field: string;
  header: string;
  existingValue: unknown;
  newValue: unknown;
  existingSource: string;
  newSource: string;
  resolution: ResolutionMode | null; // null = unresolved
}

export interface ConflictResult {
  clusterId: string;
  conflicts: FieldConflict[];
  hasUnresolved: boolean;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/**
 * Compare an incoming record (from a new source upload) against the
 * existing merged cluster value. Returns field-level conflicts where
 * both values are non-empty and different.
 */
export function detectConflicts(
  clusterId: string,
  existing: ClientRecord,
  existingSource: string,
  incoming: ClientRecord,
  incomingSource: string,
  manualEdits: Set<string> = new Set(),
): ConflictResult {
  const conflicts: FieldConflict[] = [];

  for (const field of DATAGROWS_FIELDS) {
    const key = field.key;
    const existingVal = (existing as Record<string, unknown>)[key];
    const incomingVal = (incoming as Record<string, unknown>)[key];

    if (isEmpty(existingVal) || isEmpty(incomingVal)) continue;
    if (JSON.stringify(existingVal) === JSON.stringify(incomingVal)) continue;

    // Manual edits are sticky — auto-resolve as keep_manual
    const resolution: ResolutionMode | null = manualEdits.has(key)
      ? 'keep_manual'
      : null;

    conflicts.push({
      field: key,
      header: field.header,
      existingValue: existingVal,
      newValue: incomingVal,
      existingSource,
      newSource: incomingSource,
      resolution,
    });
  }

  return {
    clusterId,
    conflicts,
    hasUnresolved: conflicts.some((c) => c.resolution === null),
  };
}

/**
 * Apply resolved conflicts back onto the merged record.
 * Fields resolved as accept_source get the new value;
 * fields resolved as keep_manual retain the existing value.
 */
export function applyResolutions(
  existing: ClientRecord,
  incoming: ClientRecord,
  conflicts: FieldConflict[],
): ClientRecord {
  const out: ClientRecord = { ...existing };

  for (const conflict of conflicts) {
    if (conflict.resolution === 'accept_source') {
      (out as Record<string, unknown>)[conflict.field] = conflict.newValue;
    }
    // keep_manual: no change — existing value already in `out`
  }

  return out;
}
