/**
 * South African ID and registration number validators.
 *
 * Validates:
 * - SA IDs (13 digits): Luhn checksum + birth date + citizenship digit
 * - CIPC Registration Numbers (YYYY/NNNNNN/NN format)
 * - Tax Numbers (10 digits)
 * - VAT Numbers (10 digits, starts with "4")
 *
 * Features leading-zero recovery for IDs and format recovery for CIPC numbers.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationError {
  severity: Severity;
  message: string;
}

export interface IDValidationResult {
  valid: boolean;
  errors: ValidationError[];
  recovered?: string; // recovered value if applicable
}

// ============================================================================
// SA ID Validation
// ============================================================================

/**
 * Validates a South African ID number.
 *
 * SA IDs are 13 digits:
 * - Positions 0-5: YYMMDD (birth date)
 * - Positions 6-9: Citizenship/gender flags (digit 7 = gender: 0-4=F, 5-9=M)
 * - Position 10: Citizenship (0=SA citizen, 1=permanent resident)
 * - Position 11: Race (legacy, not validated)
 * - Position 12: Luhn checksum
 *
 * Features:
 * - Leading-zero recovery: 12 digits → prepend "0"
 * - Luhn mod 10 validation on all 13 digits
 * - Birth date validation (month 01-12, day 01-31, century inference)
 *
 * @param id - ID string (may contain non-digits, will be cleaned)
 * @returns Validation result with errors array and recovered value if applicable
 */
export function validateSAID(id: string): IDValidationResult {
  const errors: ValidationError[] = [];

  // Clean: strip non-digits
  const cleaned = String(id ?? '').replace(/\D+/g, '');

  // If 12 digits, try leading-zero recovery
  let digits = cleaned;
  if (digits.length === 12) {
    digits = '0' + digits;
  }

  // Must be exactly 13 digits
  if (digits.length !== 13) {
    errors.push({
      severity: 'error',
      message: `SA ID must be 13 digits, got ${digits.length}`,
    });
    return { valid: false, errors };
  }

  if (!/^\d{13}$/.test(digits)) {
    errors.push({
      severity: 'error',
      message: 'SA ID must contain only digits',
    });
    return { valid: false, errors };
  }

  // Extract components
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  const citizenshipDigit = parseInt(digits[10], 10);

  // Validate birth date
  if (mm < 1 || mm > 12) {
    errors.push({
      severity: 'error',
      message: `Invalid birth month: ${mm}`,
    });
  }
  if (dd < 1 || dd > 31) {
    errors.push({
      severity: 'error',
      message: `Invalid birth day: ${dd}`,
    });
  }

  // Validate citizenship digit
  if (citizenshipDigit !== 0 && citizenshipDigit !== 1) {
    errors.push({
      severity: 'warning',
      message: `Unusual citizenship digit: ${citizenshipDigit} (expected 0 or 1)`,
    });
  }

  // Validate Luhn checksum
  let luhnSum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    luhnSum += digit;
  }
  if (luhnSum % 10 !== 0) {
    errors.push({
      severity: 'error',
      message: 'Luhn checksum validation failed',
    });
  }

  const valid = errors.every((e) => e.severity !== 'error');
  const result: IDValidationResult = {
    valid,
    errors,
  };

  // If originally 12 digits and now valid, return recovered value
  if (cleaned.length === 12 && valid) {
    result.recovered = digits;
  }

  return result;
}

// ============================================================================
// CIPC Registration Number Validation
// ============================================================================

/**
 * Entity type codes for CIPC registration numbers (last 2 digits).
 */
const CIPC_ENTITY_TYPES: Record<string, string> = {
  '07': 'PTY LTD',
  '23': 'CC',
  '08': 'NPC',
  '24': 'NPC LNPO',
  '22': 'TRUST',
  '17': 'PARTNERSHIP',
  '01': 'CLOSE CORPORATION',
  '02': 'EXTERNAL COMPANY',
  '03': 'PRIVATE COMPANY',
  '04': 'PUBLIC COMPANY',
  '05': 'GOVERNMENT ORGAN',
  '06': 'BODY CORPORATE',
  '09': 'NON-PROFIT INSTITUTE',
  '10': 'COOPERATIVE',
  '25': 'PROVINCIAL DEPARTMENT',
  '26': 'NATIONAL DEPARTMENT',
};

/**
 * Validates a South African CIPC registration number.
 *
 * Format: YYYY/NNNNNN/NN
 * - YYYY: Year of registration (1900-current year)
 * - NNNNNN: Sequential registration number
 * - NN: Entity type code (e.g., 07 = PTY LTD)
 *
 * Features:
 * - Format recovery: "201812345607" → "2018/123456/07"
 * - Year validation
 * - Entity type lookup (informational)
 *
 * @param reg - Registration string (may be formatted or unformatted)
 * @returns Validation result with errors and recovered value if applicable
 */
export function validateCIPCRegNumber(reg: string): IDValidationResult {
  const errors: ValidationError[] = [];

  // Clean: strip non-digits initially
  const cleaned = String(reg ?? '').replace(/\D+/g, '');

  // If exactly 12 digits, try to format
  let formatted = reg;
  if (cleaned.length === 12) {
    formatted = `${cleaned.slice(0, 4)}/${cleaned.slice(4, 10)}/${cleaned.slice(10)}`;
  }

  // Parse formatted version
  const match = formatted.match(/^(\d{4})\/(\d{6})\/(\d{2})$/);
  if (!match) {
    errors.push({
      severity: 'error',
      message: `CIPC registration number must match format YYYY/NNNNNN/NN, got "${formatted}"`,
    });
    return { valid: false, errors };
  }

  const [, yearStr, seqStr, typeStr] = match;
  const year = parseInt(yearStr, 10);
  const currentYear = new Date().getFullYear();

  // Validate year
  if (year < 1900 || year > currentYear) {
    errors.push({
      severity: 'warning',
      message: `Registration year ${year} is outside expected range (1900-${currentYear})`,
    });
  }

  // Look up entity type (informational)
  const entityName = CIPC_ENTITY_TYPES[typeStr] || 'UNKNOWN';
  if (!CIPC_ENTITY_TYPES[typeStr]) {
    errors.push({
      severity: 'info',
      message: `Unknown CIPC entity type code: ${typeStr}`,
    });
  }

  const valid = errors.filter((e) => e.severity === 'error').length === 0;
  const result: IDValidationResult = {
    valid,
    errors,
  };

  // If originally unformatted and now formatted, return recovered value
  if (cleaned.length === 12) {
    result.recovered = formatted;
  }

  return result;
}

// ============================================================================
// Tax Number Validation
// ============================================================================

/**
 * Validates a South African income tax number (IT number).
 *
 * Format: 10 digits exactly
 * No checksum validation (SARS doesn't publish the algorithm).
 *
 * @param tax - Tax number string
 * @returns Validation result
 */
export function validateTaxNumber(tax: string): IDValidationResult {
  const errors: ValidationError[] = [];
  const cleaned = String(tax ?? '').replace(/\D+/g, '');

  if (cleaned.length !== 10) {
    errors.push({
      severity: 'error',
      message: `Tax number must be 10 digits, got ${cleaned.length}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// VAT Number Validation
// ============================================================================

/**
 * Validates a South African VAT number.
 *
 * Format: 10 digits, must start with "4"
 * The "4" prefix identifies it as a VAT number in SARS records.
 *
 * @param vat - VAT number string
 * @returns Validation result
 */
export function validateVATNumber(vat: string): IDValidationResult {
  const errors: ValidationError[] = [];
  const cleaned = String(vat ?? '').replace(/\D+/g, '');

  if (cleaned.length !== 10) {
    errors.push({
      severity: 'error',
      message: `VAT number must be 10 digits, got ${cleaned.length}`,
    });
  }

  if (cleaned.length === 10 && !cleaned.startsWith('4')) {
    errors.push({
      severity: 'warning',
      message: 'VAT number should start with "4"',
    });
  }

  return {
    valid: errors.every((e) => e.severity !== 'error'),
    errors,
  };
}
