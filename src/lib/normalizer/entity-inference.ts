/**
 * Deterministic entity type inference.
 *
 * Fires ONLY when entity_type is blank after field normalisation.
 * Returns exact DataGrows enum strings (must match ENTITY_TYPES in datagrows.ts).
 * No AI — purely deterministic from available signals.
 *
 * Priority order (highest to lowest confidence):
 *   1. Trust deed number present → TRUST
 *   2. Registration number suffix → PTY LTD / CLOSE CORPORATION / NON-PROFIT
 *   3. Client name suffix/keyword patterns
 *   4. ID number present, no registration number → INDIVIDUAL
 */

import type { ClientRecord } from '../schema/datagrows';

// Name-suffix patterns → exact DataGrows enum values
const NAME_PATTERNS: Array<{ pattern: RegExp; result: string }> = [
  { pattern: /\(Pty\)\.?\s*Ltd\.?$/i,                  result: 'PTY LTD' },
  { pattern: /\bProprietary\s+Limited\b/i,              result: 'PTY LTD' },
  { pattern: /\bPty\.?\s*Ltd\.?\b/i,                    result: 'PTY LTD' },
  { pattern: /\bClose\s+Corp(oration)?\b/i,             result: 'CLOSE CORPORATION' },
  { pattern: /\bCC\b$/i,                                result: 'CLOSE CORPORATION' },
  { pattern: /\bNPC\b$/i,                               result: 'NON-PROFIT' },
  { pattern: /\bNon[- ]?Profit\s+Company\b/i,           result: 'NON-PROFIT' },
  { pattern: /\bNon[- ]?Profit\b/i,                     result: 'NON-PROFIT' },
  { pattern: /\bTrust\b/i,                              result: 'TRUST' },
  { pattern: /\bEstate\s+(of|late)\b/i,                 result: 'ESTATE' },
  { pattern: /\bEstate\b$/i,                            result: 'ESTATE' },
  { pattern: /\bt\/a\b/i,                               result: 'SOLE PROP' },
  { pattern: /\bTrading\s+[Aa]s\b/,                     result: 'SOLE PROP' },
  { pattern: /\bCo-?operative\b/i,                      result: 'CO-OPERATIVE' },
  { pattern: /\bPartnership\b/i,                        result: 'PARTNERSHIP' },
  { pattern: /\bBody\s+Corporate\b/i,                   result: 'BODY CORPORATE' },
  { pattern: /\bAssociation\b/i,                        result: 'ASSOCIATION' },
  { pattern: /\bPLC\b$/i,                               result: 'PLC' },
  { pattern: /\bPublic\s+Company\b/i,                   result: 'PUBLIC COMPANY' },
  { pattern: /\bDirector\b/i,                           result: 'DIRECTOR' },
  { pattern: /\bCC\s+Member\b/i,                        result: 'CC MEMBER' },
  { pattern: /\bGovernment\b/i,                         result: 'GOVERNMENT ORG' },
];

// Registration number suffix → entity type
const REG_SUFFIX_MAP: Record<string, string> = {
  '07': 'PTY LTD',
  '08': 'CLOSE CORPORATION',
  '10': 'NON-PROFIT',
  '21': 'NON-PROFIT',
  '23': 'NON-PROFIT',
};

/**
 * Infer entity type from available record fields.
 * Returns the exact DataGrows enum string, or '' if it cannot be determined.
 */
export function inferEntityType(rec: ClientRecord): string {
  // 1. Trust deed number → TRUST
  const trustDeed = String(rec.trust_deed_number ?? '').trim();
  if (trustDeed) return 'TRUST';

  // 2. Registration number suffix
  const regNr = String(rec.registration_nr ?? '').trim();
  if (regNr) {
    // Canonical form YYYY/NNNNNN/TT — extract suffix (last 2 digits after final slash)
    const suffixMatch = regNr.match(/\/(\d{2})$/);
    if (suffixMatch) {
      const mapped = REG_SUFFIX_MAP[suffixMatch[1]];
      if (mapped) return mapped;
    }
    // K-series (CC)
    if (/^[Kk]/.test(regNr)) return 'CLOSE CORPORATION';
  }

  // 3. Name patterns
  const name = String(rec.client_name ?? '').trim();
  if (name) {
    for (const { pattern, result } of NAME_PATTERNS) {
      if (pattern.test(name)) return result;
    }
  }

  // 4. ID number present but no registration number → INDIVIDUAL
  const idNr = String(rec.id_number ?? '').replace(/\D+/g, '');
  if (idNr.length === 13 && !regNr) return 'INDIVIDUAL';

  return ''; // Cannot determine — let AI or clerk handle it
}
