/**
 * DataGrows Canonical Schema
 *
 * The 86-column DataGrows "CLIENT IMPORT" template schema.
 * Source of truth: public/datagrows_canonical_template.xlsx (CLIENT IMPORT sheet).
 *
 * DO NOT reorder. Column order is part of the contract with DataGrows.
 * Row 1 = headers, Row 2 = instructions (deleted before import), Row 3+ = data.
 */

export type FieldType =
  | 'string'
  | 'longtext'
  | 'date'         // dd/mm/yyyy literal string, NOT excel date serial
  | 'boolean'      // Excel TRUE/FALSE
  | 'number'
  | 'enum'
  | 'staff'        // references the firm's staff list
  | 'email';       // may contain comma-separated emails

export interface FieldDef {
  /** Excel column letter: A, B, ..., CH */
  col: string;
  /** DataGrows header text, exact string from row 1 */
  header: string;
  /** Canonical snake_case key used in app state & Supabase */
  key: string;
  /** Data type */
  type: FieldType;
  /** For enum/staff: allowed values */
  enum?: readonly string[];
  /** Hard-required before export (the three "pink" mandatory columns) */
  required?: boolean;
  /** Conditionally required — predicate runs over a record */
  conditionalRequired?: (rec: Record<string, unknown>) => boolean;
  /** Max length / display hint */
  maxLength?: number;
  /** Human description for UI tooltips */
  description?: string;
}

// -----------------------------------------------------------------------------
// Enums (extracted from TIPS & FORMATS sheet of the uploaded template)
// -----------------------------------------------------------------------------

export const STATUS_VALUES = [
  'Active',
  'Inactive',
  'Pending',
  'Dormant',
  'Part of Ownership Structure',
] as const;

export const ENTITY_TYPES = [
  'ASSOCIATION',
  'BODY CORPORATE',
  'CC MEMBER',
  'CLOSE CORPORATION',
  'CO-OPERATIVE',
  'DIRECTOR',
  'ESTATE',
  'EXTERNAL COMPANY (CFCs)',
  'GOVERNMENT ORG',
  'INDIVIDUAL',
  'NON-PROFIT',
  'PARTNERSHIP',
  'PLC',
  'PTY LTD',
  'PUBLIC COMPANY',
  'SOLE PROP',
  'TRUST',
] as const;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const ACCOUNTING_TYPES = [
  'Annually', 'Weekly', 'Bi-Monthly', 'Bi-Annually', 'Monthly', 'No', 'Quarterly',
] as const;

export const ACCOUNTING_DUE_DATES = [
  '10th of the Month',
  '14th of the Month',
  '15th of the Month',
  '18th of the Month',
  '1st Friday of the Month',
  '20th of the Month',
  '25th of the Month',
  '2nd last Friday of the Month',
  '7th of the Month',
  'Last day of the Month',
  'Last Friday of the Month',
] as const;

export const VAT_TYPES = ['Monthly', 'Even', 'Odd', 'Bi-Annual'] as const;

export const ACCOUNTING_PROGRAMS = [
  'Sage Banking Only', 'Sage Full Account', 'Evolution', 'Excel',
  'Partner', 'QBDT', 'QBOF', 'QBOO', 'Xero', 'Other',
] as const;

export const BANK_STATEMENTS = ['Bank Feed', 'Request Statement', 'Self-Download'] as const;

export const MARITAL_STATUS = [
  'Divorced', 'Married', 'Registered Partnership', 'Separated', 'Single', 'Widowed',
] as const;

export const AUDIT_DUE_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1)) as readonly string[];

// Entity types that require a CIPC-style registration number
export const REGISTERED_ENTITY_TYPES: readonly string[] = [
  'PTY LTD', 'CLOSE CORPORATION', 'PLC', 'PUBLIC COMPANY', 'NON-PROFIT',
  'CO-OPERATIVE', 'EXTERNAL COMPANY (CFCs)', 'BODY CORPORATE', 'ASSOCIATION',
];

export const INDIVIDUAL_ENTITY_TYPES: readonly string[] = [
  'INDIVIDUAL', 'SOLE PROP', 'DIRECTOR', 'CC MEMBER',
];

export const TRUST_ENTITY_TYPES: readonly string[] = ['TRUST', 'ESTATE'];

// -----------------------------------------------------------------------------
// Field definitions — 86 columns, A through CH, in exact order
// -----------------------------------------------------------------------------

export const DATAGROWS_FIELDS: readonly FieldDef[] = [
  // A — Client Name (REQUIRED)
  { col: 'A', header: 'Client Name', key: 'client_name', type: 'string', required: true, maxLength: 255,
    description: 'Official client name. When merging sources, CIPC name wins.' },
  // B
  { col: 'B', header: 'Status', key: 'status', type: 'enum', enum: STATUS_VALUES, required: true },
  // C
  { col: 'C', header: 'Comment', key: 'comment', type: 'longtext' },
  // D — Entity Type (REQUIRED)
  { col: 'D', header: 'Entity Type', key: 'entity_type', type: 'enum', enum: ENTITY_TYPES, required: true },
  // E — Year End (REQUIRED)
  { col: 'E', header: 'Year End', key: 'year_end', type: 'enum', enum: MONTHS, required: true,
    description: 'Required for CIPC and Tax tasks to schedule correctly.' },
  // F
  { col: 'F', header: 'ID/Passport Number', key: 'id_number', type: 'string',
    conditionalRequired: (r) => INDIVIDUAL_ENTITY_TYPES.includes(String(r.entity_type ?? '')),
    description: 'Required for Individuals, Sole Props, Directors, CC Members.' },
  // G
  { col: 'G', header: 'Date of Birth', key: 'date_of_birth', type: 'date' },
  // H
  { col: 'H', header: 'Trust Deed Number', key: 'trust_deed_number', type: 'string',
    conditionalRequired: (r) => TRUST_ENTITY_TYPES.includes(String(r.entity_type ?? '')) },
  // I
  { col: 'I', header: 'Agreement Date', key: 'agreement_date', type: 'date' },
  // J
  { col: 'J', header: 'Registration Nr', key: 'registration_nr', type: 'string',
    conditionalRequired: (r) => REGISTERED_ENTITY_TYPES.includes(String(r.entity_type ?? '')),
    description: 'CIPC registration number. Primary key for deduplication of registered entities.' },
  // K
  { col: 'K', header: 'Registration Date', key: 'registration_date', type: 'date',
    conditionalRequired: (r) => REGISTERED_ENTITY_TYPES.includes(String(r.entity_type ?? '')) },
  // L
  { col: 'L', header: 'PBO Number', key: 'pbo_number', type: 'string',
    description: 'Non-profit clients only.' },
  // M
  { col: 'M', header: 'Trading Name', key: 'trading_name', type: 'string' },
  // N
  { col: 'N', header: 'Group', key: 'group', type: 'string' },
  // O
  { col: 'O', header: 'Marital Status', key: 'marital_status', type: 'enum', enum: MARITAL_STATUS },
  // P
  { col: 'P', header: 'Date of Birth of Partner', key: 'partner_dob', type: 'date' },
  // Q
  { col: 'Q', header: 'Primary Contact', key: 'primary_contact', type: 'string' },
  // R
  { col: 'R', header: 'Contact Nr', key: 'contact_nr', type: 'string' },
  // S
  { col: 'S', header: 'Contact Email', key: 'contact_email', type: 'email',
    description: 'Multiple emails separated by comma.' },
  // T
  { col: 'T', header: 'Email Client from DG', key: 'email_client_from_dg', type: 'boolean' },
  // U
  { col: 'U', header: 'Customs Nr', key: 'customs_nr', type: 'string' },
  // V
  { col: 'V', header: 'PAYE Nr', key: 'paye_nr', type: 'string' },
  // W
  { col: 'W', header: 'Tax Nr', key: 'tax_nr', type: 'string' },
  // X
  { col: 'X', header: 'UIF Reg', key: 'uif_reg', type: 'string' },
  // Y
  { col: 'Y', header: 'VAT Nr', key: 'vat_nr', type: 'string' },
  // Z
  { col: 'Z', header: "Workman`s Ref Nr", key: 'workmans_ref_nr', type: 'string' },
  // AA–AH — Staff assignments (per-firm, from the firm's uploaded employee list)
  { col: 'AA', header: 'Partner', key: 'partner', type: 'staff' },
  { col: 'AB', header: 'Manager', key: 'manager', type: 'staff' },
  { col: 'AC', header: 'Accountant', key: 'accountant', type: 'staff', required: true },
  { col: 'AD', header: 'Accounting Role', key: 'accounting_role', type: 'staff' },
  { col: 'AE', header: 'CIPC Role', key: 'cipc_role', type: 'staff' },
  { col: 'AF', header: 'Financials Role', key: 'financials_role', type: 'staff' },
  { col: 'AG', header: 'HR Role', key: 'hr_role', type: 'staff' },
  { col: 'AH', header: 'Tax Role', key: 'tax_role', type: 'staff' },
  // AI — Accounting (dropdown)
  { col: 'AI', header: 'Accounting', key: 'accounting', type: 'enum', enum: ACCOUNTING_TYPES },
  // AJ
  { col: 'AJ', header: 'Accounting Start Month', key: 'accounting_start_month', type: 'enum', enum: MONTHS },
  // AK
  { col: 'AK', header: 'Accounting Due Date', key: 'accounting_due_date', type: 'enum', enum: ACCOUNTING_DUE_DATES },
  // AL
  { col: 'AL', header: 'VAT', key: 'vat', type: 'boolean' },
  // AM
  { col: 'AM', header: 'VAT Type', key: 'vat_type', type: 'enum', enum: VAT_TYPES },
  // AN
  { col: 'AN', header: 'Payroll', key: 'payroll', type: 'boolean' },
  // AO
  { col: 'AO', header: 'Payroll Due Date', key: 'payroll_due_date', type: 'enum', enum: ACCOUNTING_DUE_DATES },
  // AP
  { col: 'AP', header: 'Weekly Payroll', key: 'weekly_payroll', type: 'boolean' },
  // AQ
  { col: 'AQ', header: 'Bi-Weekly Payroll', key: 'biweekly_payroll', type: 'boolean' },
  // AR
  { col: 'AR', header: 'Bi-Weekly Pay Date', key: 'biweekly_pay_date', type: 'date' },
  // AS
  { col: 'AS', header: 'Nr of Employees', key: 'nr_of_employees', type: 'number' },
  // AT
  { col: 'AT', header: 'EMP201', key: 'emp201', type: 'boolean' },
  // AU
  { col: 'AU', header: 'EMP501s', key: 'emp501s', type: 'boolean' },
  // AV
  { col: 'AV', header: 'Financials', key: 'financials', type: 'boolean' },
  // AW
  { col: 'AW', header: 'Financials Note', key: 'financials_note', type: 'longtext' },
  // AX
  { col: 'AX', header: 'Audit', key: 'audit', type: 'boolean' },
  // AY
  { col: 'AY', header: 'Audit Due Month', key: 'audit_due_month', type: 'enum', enum: MONTHS },
  // AZ
  { col: 'AZ', header: 'Audit Due Day', key: 'audit_due_day', type: 'enum', enum: AUDIT_DUE_DAYS },
  // BA
  { col: 'BA', header: 'Income Tax', key: 'income_tax', type: 'boolean' },
  // BB
  { col: 'BB', header: 'Provisional Tax', key: 'provisional_tax', type: 'boolean' },
  // BC
  { col: 'BC', header: 'Turnover Tax', key: 'turnover_tax', type: 'boolean' },
  // BD
  { col: 'BD', header: 'UIF', key: 'uif', type: 'boolean' },
  // BE
  { col: 'BE', header: 'Workmans', key: 'workmans', type: 'boolean' },
  // BF
  { col: 'BF', header: 'Documents Folder', key: 'documents_folder', type: 'boolean' },
  // BG
  { col: 'BG', header: 'CIPC Annual Return', key: 'cipc_annual_return', type: 'boolean' },
  // BH
  { col: 'BH', header: 'Accounting Program', key: 'accounting_program', type: 'enum', enum: ACCOUNTING_PROGRAMS },
  // BI
  { col: 'BI', header: 'Management Reports', key: 'management_reports', type: 'boolean' },
  // BJ
  { col: 'BJ', header: 'Bank Statements', key: 'bank_statements', type: 'enum', enum: BANK_STATEMENTS },
  // BK
  { col: 'BK', header: 'eFiling Logins', key: 'efiling_logins', type: 'string' },
  // BL
  { col: 'BL', header: 'UIF / TERS Logins', key: 'uif_ters_logins', type: 'string' },
  // BM
  { col: 'BM', header: "Workman`s Comp Logins", key: 'workmans_comp_logins', type: 'string' },
  // BN
  { col: 'BN', header: 'Bank Details', key: 'bank_details', type: 'string' },
  // BO
  { col: 'BO', header: 'Rating', key: 'rating', type: 'string' },
  // BP
  { col: 'BP', header: 'Referred By', key: 'referred_by', type: 'string' },
  // BQ
  { col: 'BQ', header: 'Internal Client Code', key: 'internal_client_code', type: 'string' },
  // BR
  { col: 'BR', header: 'External Storage Link', key: 'external_storage_link', type: 'string' },
  // BS–BZ physical address
  { col: 'BS', header: 'Physical Address Line 1', key: 'physical_line1', type: 'string' },
  { col: 'BT', header: 'Physical Address Line 2', key: 'physical_line2', type: 'string' },
  { col: 'BU', header: 'Physical Address Line 3', key: 'physical_line3', type: 'string' },
  { col: 'BV', header: 'Physical Address Line 4', key: 'physical_line4', type: 'string' },
  { col: 'BW', header: 'Physical Address City', key: 'physical_city', type: 'string' },
  { col: 'BX', header: 'Physical Address Province', key: 'physical_province', type: 'string' },
  { col: 'BY', header: 'Physical Address Postal/Zip Code', key: 'physical_postal', type: 'string' },
  { col: 'BZ', header: 'Physical Address Country', key: 'physical_country', type: 'string' },
  // CA–CH postal address
  { col: 'CA', header: 'Postal Address Line 1', key: 'postal_line1', type: 'string' },
  { col: 'CB', header: 'Postal Address Line 2', key: 'postal_line2', type: 'string' },
  { col: 'CC', header: 'Postal Address Line 3', key: 'postal_line3', type: 'string' },
  { col: 'CD', header: 'Postal Address Line 4', key: 'postal_line4', type: 'string' },
  { col: 'CE', header: 'Postal Address City', key: 'postal_city', type: 'string' },
  { col: 'CF', header: 'Postal Address Province', key: 'postal_province', type: 'string' },
  { col: 'CG', header: 'Postal Address Postal/Zip Code', key: 'postal_postal', type: 'string' },
  { col: 'CH', header: 'Postal Address Country', key: 'postal_country', type: 'string' },
] as const;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export type DataGrowsKey = (typeof DATAGROWS_FIELDS)[number]['key'];

/** Map: header text → field def */
export const FIELD_BY_HEADER: Record<string, FieldDef> = Object.fromEntries(
  DATAGROWS_FIELDS.map((f) => [f.header, f]),
);

/** Map: canonical key → field def */
export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(
  DATAGROWS_FIELDS.map((f) => [f.key, f]),
);

/** Map: column letter → field def */
export const FIELD_BY_COL: Record<string, FieldDef> = Object.fromEntries(
  DATAGROWS_FIELDS.map((f) => [f.col, f]),
);

/** The 3 hard-required fields. */
export const REQUIRED_FIELDS = DATAGROWS_FIELDS.filter((f) => f.required);

/** Canonical record shape (partial — every field optional at parse time). */
export type ClientRecord = Partial<Record<DataGrowsKey, unknown>> & {
  /** Internal cluster id — not exported */
  _cluster_id?: string;
  /** Which sources contributed to this record */
  _sources?: string[];
  /** Per-field conflict log */
  _conflicts?: Record<string, Array<{ source: string; value: unknown }>>;
  /** Per-field flags raised by validator / normalizer */
  _flags?: Record<string, string[]>;
  /** Archived = excluded from export */
  _archived?: boolean;
  /** Archived reason for the report */
  _archive_reason?: string;
  /** Enum fields whose merged value is not in the DataGrows allowed list */
  _invalid_enums?: Record<string, string>;
  /** Whether AI auto-fix has been applied to this record */
  auto_fixed?: boolean;
};

export const TOTAL_COLUMNS = DATAGROWS_FIELDS.length; // should be 86

if (process.env.NODE_ENV !== 'production' && DATAGROWS_FIELDS.length !== 86) {
  console.warn(`DATAGROWS_FIELDS has ${DATAGROWS_FIELDS.length} fields, expected 86`);
}
