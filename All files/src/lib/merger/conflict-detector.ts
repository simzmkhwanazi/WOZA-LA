import type { ClientRecord } from '../schema/datagrows';

/**
 * Represents a single manual edit made by an operator.
 */
export interface Edit {
  field: string;
  old_value: unknown;
  new_value: unknown;
  edited_by: string;
  edited_at: string;
}

/**
 * Represents a conflict between a manual edit and new source data.
 */
export interface ConflictEntry {
  field: string;
  manualValue: unknown;
  newSourceValue: unknown;
  source: string;
  editedBy: string;
  editedAt: string;
}

/**
 * Detects conflicts between manual edits and new source data.
 * When re-running the pipeline after adding new files, if a new source value
 * contradicts a previous manual edit, it is flagged for operator review.
 *
 * Implements spec section 4.6.4.
 *
 * @param mergedRecord - The merged ClientRecord after applying new sources
 * @param previousEdits - Array of manual edits from previous pipeline runs
 * @param sourceOrigin - Map of field names to their source file names
 * @returns Array of detected conflicts
 */
export function detectEditConflicts(
  mergedRecord: ClientRecord,
  previousEdits: Edit[],
  sourceOrigin: Record<string, string> = {}
): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];

  for (const edit of previousEdits) {
    const currentValue = mergedRecord[edit.field as keyof ClientRecord];

    // Check if the merged record's value differs from the manual edit value
    if (currentValue !== edit.new_value) {
      // This means a new source overwrote the manual edit
      conflicts.push({
        field: edit.field,
        manualValue: edit.new_value,
        newSourceValue: currentValue,
        source: sourceOrigin[edit.field] || 'Unknown',
        editedBy: edit.edited_by,
        editedAt: edit.edited_at,
      });
    }
  }

  return conflicts;
}

/**
 * Resolves conflicts between manual edits and new source data.
 * Applies operator decisions to either restore manual values or keep new source values.
 *
 * @param record - The ClientRecord with potential conflicts
 * @param conflicts - Array of conflicts to resolve
 * @param decisions - Map of field names to operator decisions ('keep_manual' or 'accept_source')
 * @returns Updated ClientRecord with conflicts resolved
 */
export function resolveConflicts(
  record: ClientRecord,
  conflicts: ConflictEntry[],
  decisions: Record<string, 'keep_manual' | 'accept_source'>
): ClientRecord {
  const resolvedRecord = { ...record };

  for (const conflict of conflicts) {
    const decision = decisions[conflict.field];

    if (decision === 'keep_manual') {
      // Restore the manual value
      resolvedRecord[conflict.field as keyof ClientRecord] = conflict.manualValue as never;
    } else if (decision === 'accept_source') {
      // Keep the source value (already in the record)
      resolvedRecord[conflict.field as keyof ClientRecord] = conflict.newSourceValue as never;
    }
  }

  return resolvedRecord;
}

/**
 * Creates a human-readable description of a conflict for UI display.
 *
 * @param conflict - The ConflictEntry to describe
 * @returns A string describing the conflict
 */
export function describeConflict(conflict: ConflictEntry): string {
  return `Field "${conflict.field}" was manually set to "${conflict.manualValue}" by ${conflict.editedBy} on ${conflict.editedAt}, but new ${conflict.source} file contains "${conflict.newSourceValue}"`;
}

/**
 * Batches conflict detection across multiple records from an incremental import.
 *
 * @param mergedRecords - Array of merged ClientRecords after new sources
 * @param previousEdits - Map of record indices to arrays of previous edits
 * @param sourceOrigins - Map of field names to their source file names
 * @returns Map of record indices to arrays of detected conflicts
 */
export function detectBatchEditConflicts(
  mergedRecords: ClientRecord[],
  previousEdits: Record<number, Edit[]>,
  sourceOrigins: Record<string, string> = {}
): Record<number, ConflictEntry[]> {
  const allConflicts: Record<number, ConflictEntry[]> = {};

  for (let i = 0; i < mergedRecords.length; i++) {
    const edits = previousEdits[i] || [];
    if (edits.length > 0) {
      allConflicts[i] = detectEditConflicts(mergedRecords[i], edits, sourceOrigins);
    }
  }

  return allConflicts;
}
