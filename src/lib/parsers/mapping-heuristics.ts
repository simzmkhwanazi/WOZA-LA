/**
 * Column mapping heuristics.
 *
 * Given a list of detected column headers from an uploaded file, suggest
 * matches to the 86 DataGrows canonical fields. Used to pre-populate the
 * column mapping UI — clerks can accept or override each suggestion.
 */

import { DATAGROWS_FIELDS, type FieldDef } from '../schema/datagrows';

/** Synonyms for common canonical field keys across the 5 source types. */
const SYNONYMS: Record<string, string[]> = {
  client_name: [
    'client', 'client name', 'customer', 'customer name', 'company',
    'company name', 'name', 'entity name', 'legal name', 'account name',
  ],
  entity_type: [
    'entity type', 'type', 'company type', 'legal form', 'entity', 'category',
  ],
  registration_nr: [
    'registration number', 'reg number', 'reg nr', 'registration nr',
    'cipc number', 'company number', 'company reg', 'cipc reg', 'company registration',
  ],
  registration_date: [
    'registration date', 'reg date', 'date registered', 'inc date', 'incorporation date',
  ],
  id_number: [
    'id number', 'id', 'sa id', 'id/passport', 'passport number', 'identity number',
  ],
  trust_deed_number: [
    'trust deed', 'trust deed number', 'deed number', 'it reference',
  ],
  tax_nr: [
    'tax number', 'tax nr', 'income tax number', 'it number', 'it reference',
  ],
  paye_nr: ['paye number', 'paye nr', 'paye', 'paye reference'],
  vat_nr: ['vat number', 'vat nr', 'vat', 'vat reference', 'vat registration'],
  uif_reg: ['uif', 'uif number', 'uif reference', 'uif registration'],
  contact_email: ['email', 'email address', 'contact email', 'primary email'],
  contact_nr: ['phone', 'telephone', 'contact number', 'contact nr', 'mobile', 'cell'],
  primary_contact: ['contact', 'contact person', 'primary contact', 'main contact'],
  year_end: ['year end', 'financial year end', 'fye', 'yearend', 'ye'],
  physical_line1: ['address', 'physical address', 'street address', 'address line 1', 'physical line 1'],
  physical_city: ['city', 'town', 'physical city'],
  physical_province: ['province', 'state', 'region'],
  physical_postal: ['postal code', 'zip', 'zip code', 'post code'],
  trading_name: ['trading as', 'trading name', 't/a', 'dba'],
  status: ['status', 'client status', 'active', 'state'],
  accounting_program: ['accounting program', 'software', 'system'],
  bank_details: ['bank details', 'bank', 'account number', 'bank account'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Suggest a canonical field key for a given detected column header.
 * Returns undefined if no reasonable match.
 */
export function suggestFieldKey(header: string): string | undefined {
  const norm = normalize(header);
  if (!norm) return undefined;

  // Pass 1: exact canonical header match (case-insensitive)
  for (const field of DATAGROWS_FIELDS) {
    if (normalize(field.header) === norm) return field.key;
  }

  // Pass 2: synonym lookup
  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (synonyms.some((syn) => normalize(syn) === norm)) return key;
  }

  // Pass 3: substring match against synonyms (looser)
  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (synonyms.some((syn) => norm.includes(normalize(syn)) || normalize(syn).includes(norm))) {
      return key;
    }
  }

  return undefined;
}

/**
 * Build an initial mapping from detected headers to canonical field keys.
 * Caller passes this to the UI as the default state; clerks can edit per row.
 */
export function initialMapping(detectedHeaders: string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const h of detectedHeaders) {
    result[h] = suggestFieldKey(h);
  }
  return result;
}

export function fieldOptions(): FieldDef[] {
  return [...DATAGROWS_FIELDS];
}
