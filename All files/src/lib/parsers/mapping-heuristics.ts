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
    // Afrikaans
    'klient naam', 'klient name', 'kliënt naam', 'kliënt name',
    'maatskappy naam', 'maatskappy name',
  ],
  entity_type: [
    'entity type', 'type', 'company type', 'legal form', 'entity', 'category',
    // Afrikaans
    'entiteit tipe', 'entiteit type', 'tipe', 'regsvorm',
  ],
  registration_nr: [
    'registration number', 'reg number', 'reg nr', 'registration nr',
    'cipc number', 'company number', 'company reg', 'cipc reg', 'company registration',
    // Afrikaans
    'registrasienommer', 'registrasie nommer', 'registrasie nummer',
    'reg nommer', 'reg nummer', 'reg nr',
  ],
  registration_date: [
    'registration date', 'reg date', 'date registered', 'inc date', 'incorporation date',
    // Afrikaans
    'registrasiedatum', 'registrasie datum',
  ],
  id_number: [
    'id number', 'id', 'sa id', 'id/passport', 'passport number', 'identity number',
    // Afrikaans
    'id nommer', 'id nummer', 'identiteitsnommer', 'identiteits nommer',
  ],
  trust_deed_number: [
    'trust deed', 'trust deed number', 'deed number', 'it reference',
  ],
  tax_nr: [
    'tax number', 'tax nr', 'income tax number', 'it number', 'it reference',
    // Afrikaans
    'belastingnommer', 'belasting nommer', 'belasting nummer', 'belasting nr',
  ],
  paye_nr: [
    'paye number', 'paye nr', 'paye', 'paye reference',
    // Afrikaans (LBS = Loonbelasting)
    'lbs nommer', 'lbs nummer', 'lbs nr', 'loonbelasting',
  ],
  vat_nr: [
    'vat number', 'vat nr', 'vat', 'vat reference', 'vat registration',
    // Afrikaans (BTW = Belasting op Toegevoegde Waarde)
    'btw nommer', 'btw nummer', 'btw nr', 'belasting op toegevoegde waarde',
  ],
  uif_reg: [
    'uif', 'uif number', 'uif reference', 'uif registration',
    // Afrikaans (WVF = Werkloosheidsversekeringsfonds)
    'wvf registrasie', 'wvf registratie', 'wvf registration',
  ],
  contact_email: [
    'email', 'email address', 'contact email', 'primary email',
    // Afrikaans
    'e-pos', 'e-posadres', 'epos', 'eposadres',
  ],
  contact_nr: [
    'phone', 'telephone', 'contact number', 'contact nr', 'mobile', 'cell',
    // Afrikaans
    'kontaknummer', 'kontakt nummer', 'tel nr', 'tel nommer', 'selfoon',
  ],
  primary_contact: [
    'contact', 'contact person', 'primary contact', 'main contact',
    // Afrikaans
    'kontakpersoon', 'kontakt persoon', 'primere kontak',
  ],
  year_end: [
    'year end', 'financial year end', 'fye', 'yearend', 'ye',
    // Afrikaans
    'jaareinde', 'jaar einde', 'finansiele jaareinde', 'finansiële jaareinde',
  ],
  physical_line1: [
    'address', 'physical address', 'street address', 'address line 1', 'physical line 1',
    // Afrikaans
    'fisiese adres', 'fisieke adres', 'straatadres',
  ],
  physical_city: [
    'city', 'town', 'physical city',
    // Afrikaans
    'stad', 'dorp', 'fisiese stad',
  ],
  physical_province: [
    'province', 'state', 'region',
    // Afrikaans
    'provinsie', 'provinsje',
  ],
  physical_postal: [
    'postal code', 'zip', 'zip code', 'post code',
    // Afrikaans
    'poskode', 'pos kode', 'postcode',
  ],
  trading_name: [
    'trading as', 'trading name', 't/a', 'dba',
    // Afrikaans
    'handelsnaam', 'handel naam', 'handelsnaam',
  ],
  status: [
    'status', 'client status', 'active', 'state',
    // Afrikaans (same word in many cases)
    'status', 'klient status',
  ],
  accounting_program: [
    'accounting program', 'software', 'system',
    // Afrikaans
    'rekeningkundige program', 'boekhoudprogram', 'rekening program',
  ],
  bank_details: [
    'bank details', 'bank', 'account number', 'bank account',
    // Afrikaans
    'bankbesonderhede', 'bank besonderhede', 'bankdetails',
  ],
  date_of_birth: [
    'date of birth', 'birth date', 'dob',
    // Afrikaans
    'geboortedatum', 'geboorte datum',
  ],
  partner: [
    'partner', 'partners',
    // Afrikaans
    'vennoot', 'vennote',
  ],
  manager: [
    'manager', 'director',
    // Afrikaans
    'bestuurder', 'bestuurders',
  ],
  accountant: [
    'accountant', 'chartered accountant', 'ca',
    // Afrikaans
    'rekenmeester', 'rekenmeesters',
  ],
};

/**
 * Normalize a string for comparison:
 * - Convert to lowercase
 * - Strip diacritics (é → e, ü → u, ë → e, etc.)
 * - Remove non-alphanumeric characters
 */
function normalize(s: string): string {
  // Strip diacritics using NFD (decomposed form) then remove combining marks
  const normalized = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return normalized;
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
