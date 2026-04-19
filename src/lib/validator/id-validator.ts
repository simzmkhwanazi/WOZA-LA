/**
 * South African ID, CIPC, Tax, and VAT number validation.
 *
 * SA ID (13 digits): YYMMDD + 4-digit sequence + citizenship + checksum (Luhn)
 * CIPC registration: YYYY/NNNNNN/NN  (year 1900-2100)
 * Tax number: exactly 10 digits
 * VAT number: exactly 10 digits, starts with 4
 */

// ---------------------------------------------------------------------------
// Luhn checksum
// ---------------------------------------------------------------------------

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// SA ID
// ---------------------------------------------------------------------------

export interface SaIdResult {
  valid: boolean;
  recovered?: string;   // set when a 12-digit ID was padded to 13
  error?: string;
}

export function validateSaId(raw: unknown): SaIdResult {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: false, error: 'Empty value' };
  }

  const digits = String(raw).replace(/\D+/g, '');

  // Auto-recover 12-digit IDs (leading zero stripped by Excel)
  let id = digits;
  let recovered: string | undefined;
  if (id.length === 12) {
    id = '0' + id;
    recovered = id;
  }

  if (id.length !== 13) {
    return { valid: false, error: `Expected 13 digits, got ${id.length}` };
  }

  // Parse date of birth (YYMMDD)
  const yy = parseInt(id.slice(0, 2), 10);
  const mm = parseInt(id.slice(2, 4), 10);
  const dd = parseInt(id.slice(4, 6), 10);

  if (mm < 1 || mm > 12) return { valid: false, error: `Invalid month ${mm} in ID` };
  if (dd < 1 || dd > 31) return { valid: false, error: `Invalid day ${dd} in ID` };

  // Century: 00-24 → 2000-2024, else 1900-1999 (allows pre-1900 via Luhn pass-through)
  const year = yy <= 24 ? 2000 + yy : 1900 + yy;
  if (year < 1800 || year > new Date().getFullYear() + 1) {
    return { valid: false, error: `Implausible birth year ${year}` };
  }

  if (!luhn(id)) {
    return { valid: false, error: 'Luhn checksum failed' };
  }

  return { valid: true, recovered };
}

// ---------------------------------------------------------------------------
// CIPC registration number  YYYY/NNNNNN/NN
// ---------------------------------------------------------------------------

const CIPC_RE = /^(\d{4})\/(\d{6})\/(\d{2})$/;

export interface CipcResult {
  valid: boolean;
  canonical?: string;   // YYYY/NNNNNN/NN
  error?: string;
}

export function validateCipc(raw: unknown): CipcResult {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: false, error: 'Empty value' };
  }

  const s = String(raw).trim();

  // Already formatted?
  if (CIPC_RE.test(s)) {
    const [, year] = CIPC_RE.exec(s)!;
    const y = parseInt(year, 10);
    if (y < 1900 || y > 2100) return { valid: false, error: `Invalid CIPC year ${y}` };
    return { valid: true, canonical: s };
  }

  // Unformatted — digits only? Expect 12 digits: YYYYNNNNNNNN
  const digits = s.replace(/\D+/g, '');
  if (digits.length === 12) {
    const year = digits.slice(0, 4);
    const seq  = digits.slice(4, 10);
    const suf  = digits.slice(10, 12);
    const y = parseInt(year, 10);
    if (y < 1900 || y > 2100) return { valid: false, error: `Invalid CIPC year ${y}` };
    const canonical = `${year}/${seq}/${suf}`;
    return { valid: true, canonical };
  }

  return { valid: false, error: `Cannot parse CIPC "${s}"` };
}

// ---------------------------------------------------------------------------
// Tax registration number (10 digits)
// ---------------------------------------------------------------------------

export interface TaxResult {
  valid: boolean;
  error?: string;
}

export function validateTaxNumber(raw: unknown): TaxResult {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: false, error: 'Empty value' };
  }
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length !== 10) {
    return { valid: false, error: `Tax number must be 10 digits, got ${digits.length}` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// VAT registration number (10 digits, starts with 4)
// ---------------------------------------------------------------------------

export function validateVatNumber(raw: unknown): TaxResult {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: false, error: 'Empty value' };
  }
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length !== 10) {
    return { valid: false, error: `VAT number must be 10 digits, got ${digits.length}` };
  }
  if (!digits.startsWith('4')) {
    return { valid: false, error: `VAT number must start with 4, got ${digits[0]}` };
  }
  return { valid: true };
}
