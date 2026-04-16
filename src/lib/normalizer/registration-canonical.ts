/**
 * Registration number canonicalisation.
 *
 * All South African registration number formats → YYYY/NNNNNN/TT
 *
 * Supported input formats:
 *   "2004/876646/07"  → "2004/876646/07"   (already canonical)
 *   "2004876646"      → "2004/876646/07"   (digits only, suffix assumed 07)
 *   "K2004/876646"    → "2004/876646/08"   (K-series Close Corporation → suffix 08)
 *   "2004/876646"     → "2004/876646/07"   (missing suffix → assume 07)
 *   " 2004 / 876646 / 07 " → "2004/876646/07" (whitespace)
 *
 * The match key (digits-only) is used for deduplication:
 *   "2004/876646/07" and "2004876646" both produce match key "200487664607"
 */

/** Canonical SA registration number format: YYYY/NNNNNN/TT */
export function canonicaliseRegistrationNr(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';

  // Strip all whitespace
  const clean = s.replace(/\s+/g, '');

  // K-series Close Corporation: K2004/876646 or K200487664608
  const kMatch = clean.match(/^[Kk](\d{4})[/\-]?(\d{6})[/\-]?(\d{2})?$/);
  if (kMatch) {
    const [, year, serial] = kMatch;
    return `${year}/${serial}/08`;
  }

  // Already in YYYY/NNNNNN/TT form
  const canonical = clean.match(/^(\d{4})\/(\d{6})\/(\d{2})$/);
  if (canonical) {
    return `${canonical[1]}/${canonical[2]}/${canonical[3]}`;
  }

  // YYYY/NNNNNN — missing suffix
  const noSuffix = clean.match(/^(\d{4})\/(\d{6})$/);
  if (noSuffix) {
    return `${noSuffix[1]}/${noSuffix[2]}/07`;
  }

  // Pure digits: 10 digits = YYYYNNNNNN (assume /07), 12 digits = YYYYNNNNNNTT
  const digits = clean.replace(/\D+/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 10)}/07`;
  }
  if (digits.length === 12) {
    return `${digits.slice(0, 4)}/${digits.slice(4, 10)}/${digits.slice(10, 12)}`;
  }

  // Fallback: strip non-alphanumeric junk and return cleaned
  return clean.replace(/[^0-9/]/g, '').replace(/\/+/g, '/');
}

/**
 * Digits-only key for deduplication matching.
 * "2004/876646/07" → "200487664607"
 * "2004876646"     → "200487664607"  (via canonicalise first)
 */
export function registrationMatchKey(v: unknown): string {
  const canonical = canonicaliseRegistrationNr(v);
  if (!canonical) return String(v ?? '').replace(/\D+/g, '');
  return canonical.replace(/\D+/g, '');
}
