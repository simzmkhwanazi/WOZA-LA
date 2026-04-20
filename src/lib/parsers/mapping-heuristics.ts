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
  status: ['status', 'client status', 'active', 'state', 'account status', 'account state'],
  accounting_program: ['accounting program', 'software', 'system', 'accounting software', 'bookkeeping software'],
  bank_details: ['bank details', 'bank', 'account number', 'bank account'],
  comment: ['comment', 'comments', 'notes', 'note', 'remarks', 'remark', 'memo', 'internal notes', 'client notes', 'description'],
  partner: ['partner', 'director', 'owner', 'principal'],
  manager: ['manager', 'senior manager', 'team lead'],
  accountant: ['accountant', 'clerk', 'bookkeeper', 'job title', 'role', 'designation', 'title', 'position'],
  accounting_role: ['accounting role', 'bookkeeping role', 'accounts role'],
  cipc_role: ['cipc role', 'secretarial role', 'company secretary'],
  financials_role: ['financials role', 'financial statements role', 'financials'],
  hr_role: ['hr role', 'human resources role', 'payroll role'],
  tax_role: ['tax role', 'sars role', 'taxation role'],
  workmans_ref_nr: ["workman's comp", "workmans comp", 'workmens compensation', "workman's compensation", 'wca', 'coida', 'workmans ref', 'workmans reference'],
  internal_client_code: ['client code', 'client ref', 'client reference', 'internal code', 'internal ref', 'account code', 'acc code', 'client id'],
  physical_line2: ['address line 2', 'physical line 2', 'suburb', 'physical suburb'],
  physical_line3: ['address line 3', 'physical line 3'],
  physical_line4: ['address line 4', 'physical line 4'],
  postal_line1: ['postal address', 'postal line 1', 'po box', 'p.o. box'],
  postal_city: ['postal city', 'postal town'],
  postal_province: ['postal province', 'postal state'],
  postal_postal: ['postal code', 'postal zip'],
  tax_nr: ['tax number', 'tax nr', 'income tax number', 'it number', 'it reference', 'sars tax number', 'taxpayer number'],
  pbo_number: ['pbo number', 'pbo', 'public benefit organisation', 'npo number'],
  customs_nr: ['customs number', 'customs nr', 'customs', 'tariff number'],
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
