/**
 * Services rules engine.
 *
 * Applies rules from rules.json to normalised client records.
 * Rules are declarative JSON — edit rules.json to change behaviour.
 *
 * Rule shape:
 *   {
 *     id: string,
 *     when: { <field>: [<allowed values>] } | { has_value: "<field>" },
 *     set:  { <field>: <value>, ... }
 *   }
 *
 * Matching fields that are ALREADY set on the record are NOT overwritten —
 * the clerk's prior edits or file-provided values always beat rule defaults.
 */

import rulesData from './rules.json';
import type { ClientRecord } from '../schema/datagrows';

type WhenClause =
  | { has_value: string }
  | Record<string, unknown[]>;

interface Rule {
  id: string;
  when: WhenClause;
  set: Record<string, unknown>;
}

interface RulesFile {
  version: number;
  description?: string;
  rules: Rule[];
}

const RULES = rulesData as RulesFile;

function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function matches(record: ClientRecord, when: WhenClause): boolean {
  if ('has_value' in when) {
    const key = (when as { has_value: string }).has_value;
    return isNonEmpty((record as Record<string, unknown>)[key]);
  }
  for (const [field, allowed] of Object.entries(when)) {
    const value = (record as Record<string, unknown>)[field];
    if (!Array.isArray(allowed) || !allowed.includes(value as never)) return false;
  }
  return true;
}

/**
 * Apply all matching rules to a record. Returns a new record — does not mutate.
 * Rule defaults never overwrite fields that already have a truthy value,
 * UNLESS the rule is marked `force: true` (future extension).
 */
export function applyRules(record: ClientRecord): ClientRecord {
  const out: ClientRecord = { ...record };
  const appliedBy: Record<string, string> = {};

  for (const rule of RULES.rules) {
    if (!matches(out, rule.when)) continue;
    for (const [field, value] of Object.entries(rule.set)) {
      const current = (out as Record<string, unknown>)[field];
      // Don't overwrite a value already set by a source or earlier rule.
      if (current !== undefined && current !== null && current !== '') continue;
      (out as Record<string, unknown>)[field] = value;
      appliedBy[field] = rule.id;
    }
  }

  // Record a flag trail for debugging / UI hints.
  if (Object.keys(appliedBy).length > 0) {
    out._flags = {
      ...(out._flags ?? {}),
      ...Object.fromEntries(
        Object.entries(appliedBy).map(([k, v]) => [k, [`rule:${v}`]]),
      ),
    };
  }

  return out;
}
