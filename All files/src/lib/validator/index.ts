/**
 * Validation layer.
 *
 * After matching + merging + rules, validate each record:
 *  - Hard-required fields (Client Name, Entity Type, Year End) must be set.
 *    Missing = blocks export.
 *  - Conditional requirements (reg nr for PTY LTD, ID for INDIVIDUAL, etc.)
 *    Missing = warning, does NOT block export (clerk can still fix).
 *  - Enum validation: value must be in enum list.
 *  - Date format check.
 *  - Email format check.
 */

import {
  DATAGROWS_FIELDS,
  REQUIRED_FIELDS,
  type ClientRecord,
  type FieldDef,
} from '../schema/datagrows';
import {
  validateSAID,
  validateCIPCRegNumber,
  validateTaxNumber,
  validateVATNumber,
} from './id-validator';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;         // no errors
  issues: Issue[];
}

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const EMAIL_RE = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

function validateField(field: FieldDef, value: unknown): Issue[] {
  const issues: Issue[] = [];
  if (isEmpty(value)) return issues;

  switch (field.type) {
    case 'date': {
      if (!DATE_RE.test(String(value))) {
        issues.push({
          severity: 'warning',
          field: field.key,
          message: `Date must be dd/mm/yyyy, got "${value}"`,
        });
      }
      break;
    }
    case 'enum': {
      if (field.enum && !field.enum.includes(String(value))) {
        issues.push({
          severity: 'warning',
          field: field.key,
          message: `Value "${value}" not in allowed list for ${field.header}`,
        });
      }
      break;
    }
    case 'email': {
      const parts = String(value).split(',').map((p) => p.trim()).filter(Boolean);
      for (const p of parts) {
        if (!EMAIL_RE.test(p)) {
          issues.push({
            severity: 'warning',
            field: field.key,
            message: `Invalid email: ${p}`,
          });
        }
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        issues.push({
          severity: 'warning',
          field: field.key,
          message: `Expected TRUE/FALSE, got "${value}"`,
        });
      }
      break;
    }
  }
  return issues;
}

export function validateRecord(record: ClientRecord): ValidationResult {
  const issues: Issue[] = [];

  // Hard-required
  for (const field of REQUIRED_FIELDS) {
    if (isEmpty((record as Record<string, unknown>)[field.key])) {
      issues.push({
        severity: 'error',
        field: field.key,
        message: `${field.header} is required`,
      });
    }
  }

  // Conditional requirements
  for (const field of DATAGROWS_FIELDS) {
    if (field.conditionalRequired && field.conditionalRequired(record as Record<string, unknown>)) {
      if (isEmpty((record as Record<string, unknown>)[field.key])) {
        issues.push({
          severity: 'warning',
          field: field.key,
          message: `${field.header} is required for this entity type`,
        });
      }
    }
  }

  // Per-field format checks
  for (const field of DATAGROWS_FIELDS) {
    const v = (record as Record<string, unknown>)[field.key];
    issues.push(...validateField(field, v));
  }

  // SA-specific ID/registration number validation
  const idNumberField = DATAGROWS_FIELDS.find((f) => f.key === 'id_number');
  if (idNumberField) {
    const idValue = (record as Record<string, unknown>)['id_number'];
    if (idValue && !isEmpty(idValue)) {
      const idResult = validateSAID(String(idValue));
      for (const err of idResult.errors) {
        issues.push({
          severity: err.severity,
          field: 'id_number',
          message: err.message,
        });
      }
    }
  }

  const regNumberField = DATAGROWS_FIELDS.find((f) => f.key === 'registration_nr');
  if (regNumberField) {
    const regValue = (record as Record<string, unknown>)['registration_nr'];
    if (regValue && !isEmpty(regValue)) {
      const regResult = validateCIPCRegNumber(String(regValue));
      for (const err of regResult.errors) {
        issues.push({
          severity: err.severity,
          field: 'registration_nr',
          message: err.message,
        });
      }
    }
  }

  const taxNumberField = DATAGROWS_FIELDS.find((f) => f.key === 'tax_nr');
  if (taxNumberField) {
    const taxValue = (record as Record<string, unknown>)['tax_nr'];
    if (taxValue && !isEmpty(taxValue)) {
      const taxResult = validateTaxNumber(String(taxValue));
      for (const err of taxResult.errors) {
        issues.push({
          severity: err.severity,
          field: 'tax_nr',
          message: err.message,
        });
      }
    }
  }

  const vatNumberField = DATAGROWS_FIELDS.find((f) => f.key === 'vat_nr');
  if (vatNumberField) {
    const vatValue = (record as Record<string, unknown>)['vat_nr'];
    if (vatValue && !isEmpty(vatValue)) {
      const vatResult = validateVATNumber(String(vatValue));
      for (const err of vatResult.errors) {
        issues.push({
          severity: err.severity,
          field: 'vat_nr',
          message: err.message,
        });
      }
    }
  }

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

export interface BatchValidationResult {
  byCluster: Record<string, ValidationResult>;
  totals: {
    errors: number;
    warnings: number;
    readyToExport: number;
    blocked: number;
  };
}

export function validateBatch(records: ClientRecord[]): BatchValidationResult {
  const byCluster: Record<string, ValidationResult> = {};
  let errors = 0;
  let warnings = 0;
  let ready = 0;
  let blocked = 0;

  for (const r of records) {
    if (r._archived) continue;
    const id = r._cluster_id ?? '';
    const result = validateRecord(r);
    byCluster[id] = result;
    errors += result.issues.filter((i) => i.severity === 'error').length;
    warnings += result.issues.filter((i) => i.severity === 'warning').length;
    if (result.ok) ready++; else blocked++;
  }

  return {
    byCluster,
    totals: { errors, warnings, readyToExport: ready, blocked },
  };
}
