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
  | 'employees';     // the firm's employee/staff list upload

export const SOURCE_LABELS: Record<SourceType, string> = {
  cipc: 'CIPC',
  sars: 'SARS',
  sage: 'Sage',
  xero: 'Xero',
  excel: 'Manual Excel',
  employees: 'Employee List',
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
export const DEFAULT_PRIORITY: readonly SourceType[] = [
  'cipc',
  'sars',
  'sage',
  'xero',
  'excel',
  'employees',
];

export const FIELD_PRIORITY: Record<string, readonly SourceType[]> = {
  // Registration & identity — CIPC authoritative
  client_name:         ['cipc', 'sars', 'sage', 'xero', 'excel'],
  entity_type:         ['cipc', 'sars', 'sage', 'xero', 'excel'],
  registration_nr:     ['cipc', 'sars', 'sage', 'xero', 'excel'],
  registration_date:   ['cipc', 'sars', 'sage', 'xero', 'excel'],
  trust_deed_number:   ['cipc', 'sars', 'sage', 'xero', 'excel'],

  // Tax identifiers — SARS authoritative
  tax_nr:              ['sars', 'sage', 'xero', 'excel'],
  paye_nr:             ['sars', 'sage', 'xero', 'excel'],
  vat_nr:              ['sars', 'sage', 'xero', 'excel'],
  uif_reg:             ['sars', 'sage', 'xero', 'excel'],
  customs_nr:          ['sars', 'sage', 'xero', 'excel'],
  workmans_ref_nr:     ['sars', 'sage', 'xero', 'excel'],

  // Contact / address — Sage primary, Xero fallback, Excel last
  primary_contact:     ['sage', 'xero', 'excel', 'sars', 'cipc'],
  contact_nr:          ['sage', 'xero', 'excel', 'cipc', 'sars'],
  contact_email:       ['sage', 'xero', 'excel', 'cipc', 'sars'],
  physical_line1:      ['sage', 'xero', 'cipc', 'excel'],
  physical_line2:      ['sage', 'xero', 'cipc', 'excel'],
  physical_line3:      ['sage', 'xero', 'cipc', 'excel'],
  physical_line4:      ['sage', 'xero', 'cipc', 'excel'],
  physical_city:       ['sage', 'xero', 'cipc', 'excel'],
  physical_province:   ['sage', 'xero', 'cipc', 'excel'],
  physical_postal:     ['sage', 'xero', 'cipc', 'excel'],
  physical_country:    ['sage', 'xero', 'cipc', 'excel'],
  postal_line1:        ['sage', 'xero', 'cipc', 'excel'],
  postal_city:         ['sage', 'xero', 'cipc', 'excel'],

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
