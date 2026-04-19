/**
 * Normalization layer.
 *
 * Cleans strings, standardises dates and numbers, canonicalises common values
 * (entity types, statuses, VAT types). Runs AFTER parsing and BEFORE matching.
 *
 * Deterministic — same input, same output. No external I/O.
 */

import {
  ENTITY_TYPES, STATUS_VALUES, MONTHS,
  DATAGROWS_FIELDS, FIELD_BY_KEY, type ClientRecord, type FieldDef,
} from '../schema/datagrows';

// -----------------------------------------------------------------------------
// String cleaning
// -----------------------------------------------------------------------------

export function cleanString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

export function upperNormalize(v: unknown): string {
  return cleanString(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// -----------------------------------------------------------------------------
// Dates → dd/mm/yyyy literal string (NOT Excel serial)
// -----------------------------------------------------------------------------

export function normalizeDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  // Excel serial number?
  if (typeof v === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + v * 86400000);
    return formatDDMMYYYY(d);
  }
  if (v instanceof Date) return formatDDMMYYYY(v);
  const s = String(v).trim();
  if (!s) return '';
  // Already dd/mm/yyyy?
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
    return `${pad(dd)}/${pad(mm)}/${year}`;
  }
  // ISO yyyy-mm-dd?
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${pad(iso[3])}/${pad(iso[2])}/${iso[1]}`;
  // Last resort: parse via Date
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatDDMMYYYY(d);
  return s; // give up, preserve raw
}

function pad(n: string | number): string {
  return String(n).padStart(2, '0');
}

function formatDDMMYYYY(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// -----------------------------------------------------------------------------
// Booleans — accept many common truthy spellings
// -----------------------------------------------------------------------------

const TRUTHY = new Set(['true', 't', 'yes', 'y', '1', 'x', 'active']);
const FALSY = new Set(['false', 'f', 'no', 'n', '0', '', 'inactive']);

export function normalizeBoolean(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (TRUTHY.has(s)) return true;
  if (FALSY.has(s)) return false;
  return undefined;
}

// -----------------------------------------------------------------------------
// Entity type canonicalization
// -----------------------------------------------------------------------------

const ENTITY_ALIASES: Record<string, string> = {
  'PROPRIETARY LIMITED': 'PTY LTD',
  '(PTY) LTD': 'PTY LTD',
  'PTY LTD': 'PTY LTD',
  'PTYLTD': 'PTY LTD',
  'CC': 'CLOSE CORPORATION',
  'CLOSE CORP': 'CLOSE CORPORATION',
  'NPO': 'NON-PROFIT',
  'NON PROFIT': 'NON-PROFIT',
  'NONPROFIT': 'NON-PROFIT',
  'NPC': 'NON-PROFIT',
  'SOLE PROPRIETOR': 'SOLE PROP',
  'SOLE TRADER': 'SOLE PROP',
  'NATURAL PERSON': 'INDIVIDUAL',
};

export function normalizeEntityType(v: unknown): string {
  const s = cleanString(v).toUpperCase();
  if (!s) return '';
  if ((ENTITY_TYPES as readonly string[]).includes(s)) return s;
  // Check aliases
  const alias = ENTITY_ALIASES[s];
  if (alias) return alias;
  // Try stripping "LIMITED" -> check for PTY LTD
  const stripped = s.replace(/\bLIMITED\b/g, 'LTD').trim();
  if ((ENTITY_TYPES as readonly string[]).includes(stripped)) return stripped;
  if (ENTITY_ALIASES[stripped]) return ENTITY_ALIASES[stripped];
  return s; // leave raw, let validator flag it
}

// -----------------------------------------------------------------------------
// Status canonicalization (also maps source dormant flags)
// -----------------------------------------------------------------------------

export function normalizeStatus(v: unknown): string {
  const s = cleanString(v).toLowerCase();
  if (!s) return '';
  const map: Record<string, string> = {
    active: 'Active',
    inactive: 'Inactive',
    dormant: 'Dormant',
    pending: 'Pending',
    suspended: 'Dormant',
    deregistered: 'Dormant',
    'in business': 'Active',
  };
  return map[s] ?? (STATUS_VALUES.find((x) => x.toLowerCase() === s) ?? '');
}

// -----------------------------------------------------------------------------
// Registration number — strip everything that isn't digits or slashes
// Accepts formats like "2019/123456/07"
// -----------------------------------------------------------------------------

export function normalizeRegistrationNumber(v: unknown): string {
  const s = cleanString(v);
  if (!s) return '';
  // Remove anything that isn't a digit, slash, or dash
  const cleaned = s.replace(/[^0-9/\-]/g, '');
  // Collapse multiple slashes
  let normalized = cleaned.replace(/\/+/g, '/');

  // Attempt CIPC format recovery: if 12 consecutive digits, format as YYYY/NNNNNN/NN
  const digitsOnly = normalized.replace(/\D+/g, '');
  if (digitsOnly.length === 12 && !normalized.includes('/')) {
    normalized = `${digitsOnly.slice(0, 4)}/${digitsOnly.slice(4, 10)}/${digitsOnly.slice(10)}`;
  }

  return normalized;
}

/** Canonical form for matching: digits only. */
export function registrationKey(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/**
 * SA ID number matching key — digits only with leading-zero recovery.
 * If 12 digits, prepends "0" to form 13-digit ID.
 * Returns 13-digit string or empty if invalid length.
 */
export function idNumberKey(v: unknown): string {
  let digits = String(v ?? '').replace(/\D+/g, '');

  // Leading-zero recovery: 12 digits → prepend "0"
  if (digits.length === 12) {
    digits = '0' + digits;
  }

  // Only accept 13-digit IDs for matching
  if (digits.length === 13) {
    return digits;
  }

  return '';
}

// -----------------------------------------------------------------------------
// Email — split & validate comma-separated list, also split concatenated
// emails like "a@x.comb@y.com" by inserting commas before each second @
// -----------------------------------------------------------------------------

export function normalizeEmails(v: unknown): string {
  const raw = cleanString(v);
  if (!raw) return '';
  // Replace whitespace/semicolons with commas
  let s = raw.replace(/[\s;]+/g, ',');
  // Split by @ — if more than one @, insert commas
  if ((s.match(/@/g) ?? []).length > 1 && !s.includes(',')) {
    // Crude heuristic: split on each transition from TLD to next alphanumeric
    s = s.replace(/([.][a-z]{2,})([a-z])/gi, '$1,$2');
  }
  // Dedupe, lowercase, trim each
  const parts = Array.from(
    new Set(
      s.split(',')
        .map((p) => p.trim().toLowerCase())
        .filter((p) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(p)),
    ),
  );
  return parts.join(',');
}

// -----------------------------------------------------------------------------
// Phone — strip non-digits except leading +
// -----------------------------------------------------------------------------

export function normalizePhone(v: unknown): string {
  const s = cleanString(v);
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D+/g, '');
  return hasPlus ? `+${digits}` : digits;
}

// -----------------------------------------------------------------------------
// Month — canonicalise to full name
// -----------------------------------------------------------------------------

export function normalizeMonth(v: unknown): string {
  const s = cleanString(v);
  if (!s) return '';
  const lower = s.toLowerCase();
  const found = MONTHS.find((m) => m.toLowerCase().startsWith(lower.slice(0, 3)));
  return found ?? '';
}

// -----------------------------------------------------------------------------
// Per-field normalization — dispatch by field type
// -----------------------------------------------------------------------------

function normalizeByField(field: FieldDef, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;

  switch (field.key) {
    case 'client_name':
    case 'trading_name':
      return cleanString(value);
    case 'entity_type':
      return normalizeEntityType(value);
    case 'status':
      return normalizeStatus(value);
    case 'registration_nr':
      return normalizeRegistrationNumber(value);
    case 'id_number': {
      // Strip non-digits, apply leading-zero recovery, return 13-digit string
      const key = idNumberKey(value);
      return key || undefined; // return undefined if not valid 13-digit form
    }
    case 'year_end':
    case 'accounting_start_month':
    case 'audit_due_month':
      return normalizeMonth(value);
    case 'contact_email':
      return normalizeEmails(value);
    case 'contact_nr':
      return normalizePhone(value);
    default:
      break;
  }

  switch (field.type) {
    case 'date':
      return normalizeDate(value);
    case 'boolean':
      return normalizeBoolean(value);
    case 'number': {
      const n = Number(String(value).replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'enum': {
      const s = cleanString(value);
      if (field.enum?.includes(s)) return s;
      // Case-insensitive fallback
      const match = field.enum?.find((e) => e.toLowerCase() === s.toLowerCase());
      return match ?? s;
    }
    default:
      return cleanString(value);
  }
}

/**
 * Normalize a whole record. Strips empty strings, standardises all values.
 */
export function normalizeRecord(record: Record<string, unknown>): ClientRecord {
  const out: ClientRecord = {};
  for (const field of DATAGROWS_FIELDS) {
    const raw = record[field.key];
    const normalized = normalizeByField(field, raw);
    if (normalized !== undefined) (out as Record<string, unknown>)[field.key] = normalized;
  }
  return out;
}

export { FIELD_BY_KEY };
