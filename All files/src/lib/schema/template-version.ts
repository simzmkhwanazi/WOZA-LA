import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Represents a tracked version of the DataGrows template.
 */
export interface TemplateVersion {
  hash: string;
  fieldCount: number;
  fields: string[];
  detectedAt: string;
}

/**
 * Computes a SHA-256 hash of a file.
 * Used to detect template changes across versions.
 *
 * @param filePath - Path to the file
 * @returns SHA-256 hash of the file
 * @throws Error if file cannot be read
 */
export async function hashTemplate(filePath: string): Promise<string> {
  try {
    const fileContent = await readFile(filePath);
    return createHash('sha256').update(fileContent).digest('hex');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to hash template file: ${errorMsg}`);
  }
}

/**
 * Detects if the template has changed by comparing hashes.
 * Returns true if hashes differ, indicating a template change.
 *
 * @param currentHash - Current template hash
 * @param storedHash - Previously stored template hash
 * @returns True if template has changed
 */
export function detectTemplateChanges(currentHash: string, storedHash: string): boolean {
  return currentHash !== storedHash;
}

/**
 * Diffs template field lists to identify additions, removals, and reordering.
 *
 * @param oldFields - Previous field names
 * @param newFields - Current field names
 * @returns Object describing added fields, removed fields, and reorder flag
 */
export function diffTemplateFields(
  oldFields: string[],
  newFields: string[]
): {
  added: string[];
  removed: string[];
  reordered: boolean;
} {
  const added: string[] = [];
  const removed: string[] = [];

  // Find added fields
  for (const field of newFields) {
    if (!oldFields.includes(field)) {
      added.push(field);
    }
  }

  // Find removed fields
  for (const field of oldFields) {
    if (!newFields.includes(field)) {
      removed.push(field);
    }
  }

  // Check for reordering
  // Fields that exist in both should be in the same order
  const commonFieldsOld = oldFields.filter(f => newFields.includes(f));
  const commonFieldsNew = newFields.filter(f => oldFields.includes(f));

  let reordered = false;
  if (commonFieldsOld.length > 0) {
    // Check if order changed
    for (let i = 0; i < Math.min(commonFieldsOld.length, commonFieldsNew.length); i++) {
      if (commonFieldsOld[i] !== commonFieldsNew[i]) {
        reordered = true;
        break;
      }
    }
  }

  return {
    added,
    removed,
    reordered,
  };
}

/**
 * Validates a template version against the current state.
 * Checks that the template matches expected structure.
 *
 * @param currentVersion - Current template version data
 * @param expectedFieldCount - Expected number of fields (86 for DataGrows)
 * @returns Validation result with any issues found
 */
export function validateTemplateVersion(
  currentVersion: TemplateVersion,
  expectedFieldCount: number = 86
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (currentVersion.fieldCount !== expectedFieldCount) {
    issues.push(
      `Field count mismatch: expected ${expectedFieldCount}, got ${currentVersion.fieldCount}`
    );
  }

  if (!currentVersion.hash || currentVersion.hash.length !== 64) {
    issues.push('Invalid template hash (expected 64-character SHA-256)');
  }

  if (!currentVersion.fields || currentVersion.fields.length === 0) {
    issues.push('Template fields list is empty');
  }

  if (!currentVersion.detectedAt || !isValidISO8601(currentVersion.detectedAt)) {
    issues.push('Invalid or missing detectedAt timestamp');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Checks if a string is a valid ISO 8601 timestamp.
 *
 * @param dateString - String to validate
 * @returns True if valid ISO 8601 format
 */
function isValidISO8601(dateString: string): boolean {
  const iso8601Regex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
  return iso8601Regex.test(dateString);
}

/**
 * Compares two template versions and generates a report.
 *
 * @param oldVersion - Previous template version
 * @param newVersion - Current template version
 * @returns Report of changes between versions
 */
export function compareTemplateVersions(
  oldVersion: TemplateVersion,
  newVersion: TemplateVersion
): {
  changed: boolean;
  hashChanged: boolean;
  fieldDiff: ReturnType<typeof diffTemplateFields>;
} {
  const hashChanged = oldVersion.hash !== newVersion.hash;
  const fieldDiff = diffTemplateFields(oldVersion.fields, newVersion.fields);

  return {
    changed: hashChanged || fieldDiff.added.length > 0 || fieldDiff.removed.length > 0 || fieldDiff.reordered,
    hashChanged,
    fieldDiff,
  };
}

/**
 * Creates a template version record from current template state.
 *
 * @param filePath - Path to the template file
 * @param fields - Array of field names
 * @returns TemplateVersion object
 */
export async function createTemplateVersionRecord(
  filePath: string,
  fields: string[]
): Promise<TemplateVersion> {
  const hash = await hashTemplate(filePath);

  return {
    hash,
    fieldCount: fields.length,
    fields,
    detectedAt: new Date().toISOString(),
  };
}
