/**
 * Source types and source-of-truth hierarchy.
 *
 * When merging records across multiple uploaded files, each canonical field
 * has a priority order of sources. The first non-empty value wins.
 */

export type SourceType =
  | 'cipc'
  | 'sars'
  | 'sage'
  | 'xero'
  | 'excel'          // generic manual Excel from the firm
  | 'employees'      // the firm's employee/staff list upload
  | 'company'        // the firm's own company details / service-provider profile
  | 'contacts'       // standalone contacts directory (contractors, referral partners, etc.)
  | 'suppliers';     // the accounting firm's own supplier list

/** Source types that go through the DataGrows 86-column pipeline */
export const CLIENT_SOURCE_TYPES: readonly SourceType[] = [
  'cipc', 'sars', 'sage', 'xero', 'excel',
];

/** Source types that are processed into their own tables, not into clusters */
export const FIRM_SOURCE_TYPES: readonly SourceType[] = [
  'employees', 'company', 'contacts', 'suppliers',
];

export const SOURCE_LABELS: Record<SourceType, string> = {
  cipc:      'CIPC',
  sars:      'SARS',
  sage:      'Sage',
  xero:      'Xero',
  excel:     'Manual Excel',
  employees: 'Employee List',
  company:   'Company Details',
  contacts:  'Contacts Directory',
  suppliers: 'Supplier List',
};

export const SOURCE_DESCRIPTIONS: Record<SourceType, string> = {
  cipc:      'Company registration data from CIPC',
  sars:      'Tax data from SARS eFiling export',
  sage:      'Client data from Sage accounting software',
  xero:      'Client data from Xero accounting software',
  excel:     'Manual Excel spreadsheet (general client data)',
  employees: 'Firm employee/staff list (HR or payroll export)',
  company:   'Firm own company details (CIPC cert, invoice template, etc.)',
  contacts:  'Standalone contacts directory (contractors, referral partners, etc.)',
  suppliers: 'Firm supplier list',
};

/**
 * Source priority per canonical field key.
 * Order matters: first source with a non-empty value wins.
 *
 * Rules:
 *  - CIPC wins for official registration data (name, entity type, reg nr).
 *  - SARS wins for tax numbers and tax-service flags.
 *  - Sage > Xero > Excel for contacts, addresses, accounting config.
 *
 * Any field not listed falls back to DEFAULT_PRIORITY.
 */
// Priority used when merging client records across sources.
// contacts & suppliers are firm-only and never contribute to client records.
export const DEFAULT_PRIORITY: readonly SourceType[] = [
  'company',
  'cipc',
  'sars',
  'sage',
  'xero',
  'excel',
  'employees',
];

export const FIELD_PRIORITY: Record<string, readonly SourceType[]> = {
  // Registration & identity — Company Details > CIPC authoritative
  client_name:         ['company', 'cipc', 'sars', 'sage', 'xero', 'excel'],
  entity_type:         ['company', 'cipc', 'sars', 'sage', 'xero', 'excel'],
  registration_nr:     ['company', 'cipc', 'sars', 'sage', 'xero', 'excel'],
  registration_date:   ['company', 'cipc', 'sars', 'sage', 'xero', 'excel'],
  trust_deed_number:   ['company', 'cipc', 'sars', 'sage', 'xero', 'excel'],

  // Tax identifiers — SARS authoritative, Company Details as first fallback
  tax_nr:              ['sars', 'company', 'sage', 'xero', 'excel'],
  paye_nr:             ['sars', 'company', 'sage', 'xero', 'excel'],
  vat_nr:              ['sars', 'company', 'sage', 'xero', 'excel'],
  uif_reg:             ['sars', 'company', 'sage', 'xero', 'excel'],
  customs_nr:          ['sars', 'company', 'sage', 'xero', 'excel'],
  workmans_ref_nr:     ['sars', 'company', 'sage', 'xero', 'excel'],

  // Contact / address — Company Details > Sage > Xero > Excel
  primary_contact:     ['company', 'sage', 'xero', 'excel', 'sars', 'cipc'],
  contact_nr:          ['company', 'sage', 'xero', 'excel', 'cipc', 'sars'],
  contact_email:       ['company', 'sage', 'xero', 'excel', 'cipc', 'sars'],
  physical_line1:      ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_line2:      ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_line3:      ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_line4:      ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_city:       ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_province:   ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_postal:     ['company', 'sage', 'xero', 'cipc', 'excel'],
  physical_country:    ['company', 'sage', 'xero', 'cipc', 'excel'],
  postal_line1:        ['company', 'sage', 'xero', 'cipc', 'excel'],
  postal_city:         ['company', 'sage', 'xero', 'cipc', 'excel'],

  // Accounting config — Sage > Xero
  accounting_program:  ['sage', 'xero', 'excel'],
  bank_statements:     ['sage', 'xero', 'excel'],

  // Staff assignments — only from employee list
  partner:             ['employees'],
  manager:             ['employees'],
  accountant:          ['employees'],
  accounting_role:     ['employees'],
  cipc_role:           ['employees'],
  financials_role:     ['employees'],
  hr_role:             ['employees'],
  tax_role:            ['employees'],
};

export function priorityFor(key: string): readonly SourceType[] {
  return FIELD_PRIORITY[key] ?? DEFAULT_PRIORITY;
}
