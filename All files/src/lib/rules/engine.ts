import type { ClientRecord } from '../schema/datagrows';

/**
 * Represents a single rule for auto-filling fields based on conditions.
 */
export interface Rule {
  id: string;
  when: Record<string, unknown>;
  set: Record<string, unknown>;
}

/**
 * Result of applying rules to a record.
 */
export interface RulesAppliedResult {
  record: ClientRecord;
  autoFilled: string[];
}

/**
 * Evaluates a single condition against a record field.
 * Supports two condition types:
 * 1. Array value check: { "entity_type": ["PTY LTD"] } checks if field is in list
 * 2. Has value check: { "has_value": "vat_nr" } checks if field is non-empty
 *
 * @param record - ClientRecord to evaluate
 * @param fieldName - Name of the field to check
 * @param conditionValue - Value or condition to match
 * @returns True if condition matches
 */
function evaluateCondition(
  record: ClientRecord,
  fieldName: string,
  conditionValue: unknown
): boolean {
  const fieldValue = record[fieldName as keyof ClientRecord];

  // Array value check: field value must be in the array
  if (Array.isArray(conditionValue)) {
    return conditionValue.includes(fieldValue);
  }

  // String value check for "has_value" conditions
  if (conditionValue === 'has_value') {
    return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
  }

  // Direct equality check
  return fieldValue === conditionValue;
}

/**
 * Evaluates whether all conditions in a "when" clause match the record.
 *
 * @param record - ClientRecord to evaluate
 * @param whenClause - Conditions to match
 * @returns True if all conditions match
 */
function evaluateWhenClause(record: ClientRecord, whenClause: Record<string, unknown>): boolean {
  for (const [fieldName, condition] of Object.entries(whenClause)) {
    // Special handling for "has_value" check
    if (condition === 'has_value') {
      if (!evaluateCondition(record, fieldName, condition)) {
        return false;
      }
    } else {
      if (!evaluateCondition(record, fieldName, condition)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Loads rules from the rules.json file.
 * Validates that each rule has required structure (id, when, set).
 *
 * @returns Array of validated Rule objects
 * @throws Error if rules.json is malformed or cannot be loaded
 */
export async function loadRules(): Promise<Rule[]> {
  try {
    // In a real implementation, this would load from a file or API
    // For now, return an empty array and let callers provide rules
    // This is a placeholder for future file-based rule loading
    const response = await fetch('/rules.json');
    if (!response.ok) {
      throw new Error(`Failed to load rules.json: ${response.statusText}`);
    }

    const rulesData = await response.json();

    // Validate rules structure
    if (!Array.isArray(rulesData)) {
      throw new Error('rules.json must contain an array');
    }

    const validatedRules: Rule[] = [];
    for (const rule of rulesData) {
      if (!rule.id || typeof rule.id !== 'string') {
        throw new Error('Each rule must have a string id');
      }
      if (!rule.when || typeof rule.when !== 'object') {
        throw new Error(`Rule ${rule.id} must have a "when" object`);
      }
      if (!rule.set || typeof rule.set !== 'object') {
        throw new Error(`Rule ${rule.id} must have a "set" object`);
      }

      validatedRules.push(rule as Rule);
    }

    return validatedRules;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Error loading rules: ${errorMsg}`);
  }
}

/**
 * Applies rules to a ClientRecord, respecting sticky overrides from manual edits.
 * Only fills empty fields and skips any that have been manually edited.
 *
 * Implements spec sections 6.7 and 8.2: manually reverted fields are "sticky"
 * and will not be re-filled by the rules engine.
 *
 * @param record - ClientRecord to apply rules to
 * @param rules - Array of Rule objects to evaluate
 * @param stickyOverrides - Map of field names to values that were manually set (should not be overwritten)
 * @returns RulesAppliedResult with modified record and list of auto-filled fields
 */
export function applyRules(
  record: ClientRecord,
  rules: Rule[],
  stickyOverrides: Record<string, unknown> = {}
): RulesAppliedResult {
  const modifiedRecord = { ...record };
  const autoFilled: string[] = [];

  for (const rule of rules) {
    // Check if rule conditions match
    if (!evaluateWhenClause(modifiedRecord, rule.when)) {
      continue;
    }

    // Apply each field in the "set" clause
    for (const [fieldName, value] of Object.entries(rule.set)) {
      // Skip if field has been manually edited (sticky override)
      if (fieldName in stickyOverrides) {
        continue;
      }

      // Only fill if field is currently empty/undefined
      const currentValue = modifiedRecord[fieldName as keyof ClientRecord];
      if (currentValue === null || currentValue === undefined || currentValue === '') {
        modifiedRecord[fieldName as keyof ClientRecord] = value as never;
        autoFilled.push(fieldName);
      }
    }
  }

  return {
    record: modifiedRecord,
    autoFilled,
  };
}

/**
 * Applies rules to multiple records in a batch operation.
 * Useful for re-processing an entire dataset.
 *
 * @param records - Array of ClientRecords to process
 * @param rules - Array of Rule objects to evaluate
 * @param stickyOverrides - Map of record field paths to manually-edited values
 * @returns Array of RulesAppliedResult for each record
 */
export function applyRulesBatch(
  records: ClientRecord[],
  rules: Rule[],
  stickyOverrides: Record<string, Record<string, unknown>> = {}
): RulesAppliedResult[] {
  return records.map((record, index) => {
    const recordOverrides = stickyOverrides[String(index)] || {};
    return applyRules(record, rules, recordOverrides);
  });
}
