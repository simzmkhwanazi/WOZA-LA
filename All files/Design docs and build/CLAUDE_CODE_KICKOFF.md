# CLAUDE CODE KICKOFF: Woza La v2

**READ THIS FIRST.** Then read `docs/UI_REDESIGN_SPEC.md`, then `src/lib/schema/datagrows.ts` before writing any code.

---

## What Is Woza La?

Woza La ("Get In Stay In") is DataGrows' internal client data onboarding tool. Accounting firms across South Africa have client data scattered across Sage, Xero, SARS eFiling, CIPC, and manual Excel. A DataGrows clerk uploads all files, the app normalizes columns, deduplicates records, validates data, and exports a populated .xlsx masterfile (86 columns, x14 dropdown validations) ready for DataGrows import.

**Who uses it:** DataGrows clerks (entry-level staff doing 10-50 onboardings per month)

**The contract:** Input files (any combination of .xlsx, .xls, .csv from SA systems) → Output file (valid DataGrows masterfile, 86 columns A-CH, all enum values correct, all validations preserved)

**What changed in v2:** Redesigned from 7-step to 3-step pipeline, identified & fixed 20 failure modes, added session locking + conflict detection + audit trail, designed for SA data edge cases (ID recovery, CIPC validation, Afrikaans headers).

---

## The 3-Step Pipeline

### Step 1: Import
File upload, column mapping, staff matching, deduplication with operator confirmation.

**What happens:**
1. Upload .xlsx/.xls/.csv file(s)
2. Auto-detect column headers (English + Afrikaans synonyms)
3. Propose mapping to DataGrows fields with confidence scores
4. Match staff names against firm staff list (fuzzy matching)
5. Identify duplicate records (name similarity, ID match, CIPC match)
6. Operator confirms each merge decision
7. Normalize data (ID leading zeros, CIPC format, encoding, tax ID format)

**Modules involved:**
- `lib/normalizer.ts` — Column detection, encoding detection, SA field normalization
- `lib/mappers/headers.ts` — Column header to field mapping
- `lib/mappers/afrikaans.ts` — Afrikaans synonym mapping + diacritic stripping
- `lib/matchers/staff.ts` — Fuzzy name matching against firm staff
- `lib/matchers/dedup.ts` — Find duplicate candidates (name, ID, CIPC, address)
- `lib/validators/sa-id.ts` — ID validation & leading zero recovery
- `lib/validators/cipc.ts` — CIPC format validation & recovery
- `lib/validators/tax.ts` — Tax/VAT format validation
- `components/ImportStep.tsx` — UI
- `components/MappingConfirmation.tsx` — Mapping review & approval
- `components/DedupConfirmation.tsx` — Dedup review & approval
- `components/StaffMatching.tsx` — Staff name review & approval

**Outputs:**
- Records stored in `sessions.records` (JSON array)
- Merges logged in `sessions.merge_history`
- Staff matches in `sessions.staff_mappings`

---

### Step 2: Review
Inspect data, apply business rules, resolve conflicts, make manual edits.

**What happens:**
1. View all records by company or client
2. Run field-level validation (enum values, required fields, format checks)
3. Apply rules engine (auto-assign missing fields, standardize formats)
4. Detect conflicts from incremental imports (record may be overwritten by new source)
5. Manual edits (change individual fields, bulk edits with confirmation)
6. Undo/redo support

**Modules involved:**
- `lib/validator.ts` — Field validation (enum, required, format)
- `lib/engine.ts` — Rules engine with sticky reverts
- `lib/conflicts.ts` — Conflict detection (incremental imports)
- `lib/merger.ts` — Merge logic with conflict resolution
- `components/ReviewStep.tsx` — UI
- `components/RecordTable.tsx` — Paginated/virtualized record list
- `components/ValidationStatus.tsx` — Status badge (Ready/Errors/Warnings)
- `components/RulesPanel.tsx` — Rules engine UI
- `components/ConflictResolver.tsx` — Conflict resolution UI

**Outputs:**
- Updated records in `sessions.records`
- Rule applications logged in `sessions.rule_log`
- Conflicts resolved in `sessions.conflicts`
- Manual edits logged in `sessions.edit_history`

---

### Step 3: Export
Final validation, version history, download .xlsx with validations preserved.

**What happens:**
1. Verify 86 columns present and in correct order (A-CH)
2. Verify all enum values match DataGrows schema
3. Load DataGrows template from Supabase Storage
4. Write cell values to template (preserves x14 validations)
5. Save version to history
6. Generate audit log
7. User downloads .xlsx

**Modules involved:**
- `lib/exporter.ts` — ExcelJS integration, cell writing
- `lib/export-validator.ts` — 86-column count/order assertion, enum validation
- `lib/versioning.ts` — Version history management
- `lib/template-version.ts` — Template SHA-256 hash tracking
- `lib/audit-log.ts` — Audit trail generation
- `components/ExportStep.tsx` — UI
- `components/VersionHistory.tsx` — Version dropdown & download
- `api/export.ts` — Export endpoint (POST /api/export)

**Outputs:**
- Exported .xlsx file (download)
- Version metadata in Supabase Storage
- Audit log in `sessions.audit_log`

---

## What Changed from v1

### Pipeline Architecture
- **v1:** Upload → Staff → Map → Review → Services → Validate → Export (7 steps, horizontal tabs)
- **v2:** Import → Review → Export (3 steps, vertical sidebar + breadcrumbs)

### Removed
- Services step (dead code, no functionality)
- Portfolio PDF (artifact, not used downstream)
- Completion percentages (misleading, replaced with validation status badges)

### Added
- Dedup confirmation gate (operator reviews all merges)
- Session locking (Supabase Realtime presence + heartbeat)
- Conflict detection (incremental imports)
- Sticky reverts (manual edits persist across rule engine re-runs)
- Export versioning (version history with download)
- Template version tracking (SHA-256 hash)
- 20 failure mode fixes (ID recovery, CIPC validation, Afrikaans headers, encoding detection, etc.)

### Database Schema Changes
**New columns in `sessions` table:**
- `active_editor_id` (UUID, references auth.users)
- `active_editor_since` (timestamp, for 10-min fallback)
- `records` (JSONB, stores all records for session)
- `merge_history` (JSONB, logs all merge decisions)
- `staff_mappings` (JSONB, staff name matches)
- `rule_log` (JSONB, rules applied)
- `conflicts` (JSONB, incremental import conflicts)
- `edit_history` (JSONB, manual edits with timestamps)
- `audit_log` (JSONB, full audit trail)
- `validation_status` (enum: 'ready', 'errors', 'warnings', 'skipped')
- `export_version` (integer, version counter for exports)
- `template_hash` (varchar, SHA-256 of template)

**New tables:**
- `export_versions` — Store export metadata & download links
  - `id` (UUID primary key)
  - `session_id` (UUID, foreign key to sessions)
  - `version_number` (integer)
  - `exported_at` (timestamp)
  - `exported_by` (UUID, references auth.users)
  - `file_url` (text, Supabase Storage URL)
  - `record_count` (integer)
  - `template_hash` (varchar)
  - `audit_log` (JSONB)

---

## Key Files to Create/Modify

### Core Data Pipeline

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/schema/datagrows.ts` | 86-column schema with enum values, field priorities, dropdowns | REFERENCE (read before coding) |
| `src/lib/normalizer.ts` | Parse files, detect encoding, normalize columns | NEW |
| `src/lib/mappers/headers.ts` | Map source columns to DataGrows fields | NEW |
| `src/lib/mappers/afrikaans.ts` | Afrikaans synonym dictionary + mapping | NEW |
| `src/lib/matchers/staff.ts` | Fuzzy match staff names against firm list | NEW |
| `src/lib/matchers/dedup.ts` | Find duplicate record candidates | NEW |
| `src/lib/merger.ts` | Merge records with conflict resolution | NEW |
| `src/lib/validators/sa-id.ts` | SA ID validation, leading zero recovery, Luhn | NEW |
| `src/lib/validators/cipc.ts` | CIPC format validation & normalization | NEW |
| `src/lib/validators/tax.ts` | Tax/VAT format validation | NEW |
| `src/lib/validator.ts` | Field-level validation (enum, required, format) | NEW |
| `src/lib/engine.ts` | Rules engine with sticky reverts | NEW |
| `src/lib/conflicts.ts` | Conflict detection for incremental imports | NEW |

### Export & Versioning

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/exporter.ts` | ExcelJS integration, cell writing, template loading | NEW |
| `src/lib/export-validator.ts` | Verify 86 columns, order, enum values | NEW |
| `src/lib/versioning.ts` | Export version history management | NEW |
| `src/lib/template-version.ts` | Template SHA-256 tracking | NEW |
| `src/lib/audit-log.ts` | Audit trail generation (JSON structured) | NEW |

### UI Components

| File | Purpose | Status |
|------|---------|--------|
| `src/components/ImportStep.tsx` | Import step container (tabs: upload, mapping, staff, dedup) | NEW |
| `src/components/FileUpload.tsx` | Drag-drop file upload | NEW |
| `src/components/MappingConfirmation.tsx` | Column mapping review & approval | NEW |
| `src/components/StaffMatching.tsx` | Staff name matching UI | NEW |
| `src/components/DedupConfirmation.tsx` | Duplicate review & merge decisions (364 lines) | NEW |
| `src/components/ReviewStep.tsx` | Review step container | NEW |
| `src/components/RecordTable.tsx` | Paginated/virtualized record list (react-window) | NEW |
| `src/components/ValidationStatus.tsx` | Status badge (Ready/Errors/Warnings/Skipped) | NEW |
| `src/components/RulesPanel.tsx` | Rules engine UI | NEW |
| `src/components/ConflictResolver.tsx` | Conflict resolution UI | NEW |
| `src/components/ExportStep.tsx` | Export step container | NEW |
| `src/components/VersionHistory.tsx` | Version dropdown & download | NEW |

### API & Layout

| File | Purpose | Status |
|------|---------|--------|
| `src/app/sessions/[id]/page.tsx` | Session page (sidebar + main content) | MODIFY |
| `src/app/api/sessions/[id]/import.ts` | Import endpoint (POST) | NEW |
| `src/app/api/sessions/[id]/validate.ts` | Validation endpoint (POST) | NEW |
| `src/app/api/sessions/[id]/export.ts` | Export endpoint (POST) | NEW |

---

## Rules While You Work

### Don't Change DATAGROWS_FIELDS Order
The 86 columns must be in exact order A-CH as defined in `src/lib/schema/datagrows.ts`. Never reorder, add, or remove columns. The exporter asserts this.

### Don't Regenerate Template with openpyxl
The DataGrows template has x14 data validations (Excel's hidden dropdown definitions). openpyxl cannot preserve these. Always load the template from Supabase Storage and write cell values only.

### Check FIELD_PRIORITY When Merging
If two records have conflicting values for the same field, use `FIELD_PRIORITY` from schema to decide which source wins. Example: If Company A has `tax_id: "1234567890"` (from Sage) and `tax_id: "999999999"` (from Xero), and `tax_id` has priority Sage > Xero, keep the Sage value.

### Rules Engine Is Declarative JSON
Don't hardcode business logic. Store rules in JSON and apply them declaratively. Example:
```json
{
  "rule_id": "assign_placeholder_tax",
  "when": { "field": "tax_id", "is": "null", "entity_type": "CC" },
  "then": { "set": "tax_id", "to": "9999999999" },
  "apply_to": "all",
  "operator_can_override": true
}
```

### Exporter Only Writes Cell Values
Don't try to regenerate formulas, styles, or validations. Load template, write data to cells, save. That's it. The template already has all formatting, validations, and hidden sheets.

### Read UI Spec Section by Section as You Implement
`docs/UI_REDESIGN_SPEC.md` is self-contained. As you build each component, read the corresponding section. Don't read the whole spec at once—it's too long. Read in order: ImportStep, Review, Export.

### Run Typecheck, Lint, Build After Every Change
```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
```
If any step fails, fix errors immediately. Don't accumulate technical debt.

---

## Implementation Order

Follow this sequence. Each item depends on previous items.

1. **Schema & Database**
   - Review `src/lib/schema/datagrows.ts` (don't modify, just read)
   - Create DB migrations (add `sessions` columns + `export_versions` table)
   - Update Supabase RLS policies for session isolation

2. **Core Data Pipeline**
   - `lib/normalizer.ts` — File parsing, encoding detection
   - `lib/mappers/headers.ts` — Column mapping logic
   - `lib/mappers/afrikaans.ts` — Afrikaans synonyms
   - `lib/matchers/staff.ts` — Staff fuzzy matching
   - `lib/matchers/dedup.ts` — Dedup candidate finding
   - `lib/merger.ts` — Merge logic with conflict resolution
   - `lib/validators/sa-id.ts` → `cipc.ts` → `tax.ts` → `validator.ts` (in sequence)
   - `lib/engine.ts` — Rules engine

3. **Session Management**
   - `lib/conflicts.ts` — Conflict detection
   - Session locking logic (presence heartbeat, 10-min fallback)
   - Session state persistence (read/write to DB)

4. **Export & Versioning**
   - `lib/exporter.ts` — ExcelJS cell writing
   - `lib/export-validator.ts` — 86-column assertions
   - `lib/versioning.ts` — Version history
   - `lib/template-version.ts` — Hash tracking
   - `lib/audit-log.ts` — Audit trail

5. **API Routes**
   - `api/sessions/[id]/import.ts` (POST) — Parse files, normalize, store in DB
   - `api/sessions/[id]/validate.ts` (POST) — Run validation, return status
   - `api/sessions/[id]/export.ts` (POST) — Generate & download .xlsx

6. **UI Components** (in this order, test each section before moving to next)
   - ImportStep: `FileUpload.tsx` → `MappingConfirmation.tsx` → `StaffMatching.tsx` → `DedupConfirmation.tsx` → `ImportStep.tsx` container
   - ReviewStep: `RecordTable.tsx` → `ValidationStatus.tsx` → `RulesPanel.tsx` → `ConflictResolver.tsx` → `ReviewStep.tsx` container
   - ExportStep: `VersionHistory.tsx` → `ExportStep.tsx` container

7. **Page Layout**
   - Modify `app/sessions/[id]/page.tsx` → Add sidebar nav + breadcrumbs

8. **Home Page**
   - `app/page.tsx` — Sessions list, new session modal, status badges

---

## DataGrows Template: 86 Columns Reference

**The export MUST have exactly these 86 columns in this exact order (A through CH).**

| Column | Field | Type | Required | Enum Values | Notes |
|--------|-------|------|----------|-------------|-------|
| A | company_registration_number | String | Yes | | CIPC number (numeric, 8 digits) |
| B | company_name | String | Yes | | Full legal name |
| C | company_legal_status | String | Yes | CC, (Pty) Ltd, Trust, Partnership, Sole Prop | Entity type |
| D | company_address_line_1 | String | No | | Street address |
| E | company_address_line_2 | String | No | | Suburb |
| F | company_address_city | String | No | | City/town |
| G | company_address_postal_code | String | No | | Postal code |
| H | company_phone | String | No | | Contact number |
| I | company_email | String | No | | Email address |
| J | company_tax_registration_number | String | No | | 10-digit SARS TIN |
| K | company_vat_registration_number | String | No | | 10-digit VAT number |
| L | company_directors | String | No | | Comma-separated director names |
| M | company_shareholders | String | No | | Comma-separated shareholder names |
| N | company_date_of_incorporation | Date | No | | YYYY-MM-DD format |
| O | company_financial_year_end | Date | No | | YYYY-MM-DD format |
| P | company_main_business_activity | String | No | | SIC code or description |
| Q | company_employees_count | Integer | No | | 1-5, 6-10, 11-50, 51-100, 100+ |
| R | company_annual_turnover | Decimal | No | | ZAR amount |
| S | company_bank_account_number | String | No | | 11-digit account number |
| T | company_bank_branch_code | String | No | | 6-digit branch code |
| U | company_bank_account_type | String | No | | Cheque, Savings, Money Market |
| V | company_bank_name | String | No | | Bank name |
| W | company_auditor_name | String | No | | Full name |
| X | company_auditor_email | String | No | | Email address |
| Y | company_auditor_phone | String | No | | Phone number |
| Z | company_accounting_system | String | No | | Sage, Xero, Pastel, Manual |
| AA | company_vat_status | String | No | | Active, Suspended, Cancelled |
| AB | company_sars_pin | String | No | | 7-digit PIN |
| AC | company_paye_ref | String | No | | 10-digit PAYE reference |
| AD | company_uel_registration | String | No | | Yes, No |
| AE | company_annual_itax_filing_status | String | No | | Current, Outstanding, N/A |
| AF | client_id | String | Yes | | Unique identifier (UUID or custom) |
| AG | client_name | String | Yes | | Full name or business name |
| AH | client_type | String | Yes | | Individual, Company, Trust, CC, Partnership |
| AI | client_id_number | String | No | | SA ID (13-digit) or business reg |
| AJ | client_title | String | No | | Mr, Mrs, Ms, Dr, Prof |
| AK | client_first_name | String | No | | First name |
| AL | client_surname | String | No | | Last name |
| AM | client_date_of_birth | Date | No | | YYYY-MM-DD format |
| AN | client_email | String | No | | Email address |
| AO | client_phone | String | No | | Phone number |
| AP | client_mobile | String | No | | Mobile number |
| AQ | client_address_line_1 | String | No | | Street address |
| AR | client_address_line_2 | String | No | | Suburb |
| AS | client_address_city | String | No | | City/town |
| AT | client_address_postal_code | String | No | | Postal code |
| AU | client_country | String | No | | South Africa (default) |
| AV | client_tax_residence | String | No | | Country code (ZA, UK, USA, etc) |
| AW | client_nationality | String | No | | Country name |
| AX | client_marital_status | String | No | | Single, Married, Divorced, Widowed |
| AY | client_spouse_name | String | No | | Full name (if married) |
| AZ | client_employment_status | String | No | | Employed, Self-employed, Retired, Unemployed |
| BA | client_occupation | String | No | | Job title or profession |
| BB | client_employer_name | String | No | | Employer company name |
| BC | client_annual_income | Decimal | No | | ZAR amount |
| BD | client_source_of_income | String | No | | Salary, Self-employment, Investments, Rental, Other |
| BE | client_tax_registration_number | String | No | | 10-digit SARS TIN (if self-employed) |
| BF | client_vat_registration_number | String | No | | 10-digit VAT number (if registered) |
| BG | client_vat_status | String | No | | Active, Suspended, Cancelled, N/A |
| BH | client_banking_details_account_number | String | No | | 11-digit account number |
| BI | client_banking_details_branch_code | String | No | | 6-digit branch code |
| BJ | client_banking_details_bank_name | String | No | | Bank name |
| BK | client_banking_details_account_type | String | No | | Cheque, Savings, Money Market |
| BL | client_banking_details_account_holder | String | No | | Account holder name (if different from client) |
| BM | client_beneficiary_name | String | No | | Beneficiary name (if applicable) |
| BN | client_beneficiary_relationship | String | No | | Spouse, Child, Parent, Sibling, Other |
| BO | client_emergency_contact_name | String | No | | Full name |
| BP | client_emergency_contact_phone | String | No | | Phone number |
| BQ | client_emergency_contact_relationship | String | No | | Spouse, Child, Parent, Sibling, Friend, Other |
| BR | client_dependent_children_count | Integer | No | | 0-10 |
| BS | client_property_residential_address | String | No | | Yes, No, Rented |
| BT | client_property_residential_market_value | Decimal | No | | ZAR amount (estimated) |
| BU | client_property_other_assets | String | No | | Yes, No |
| BV | client_property_other_assets_description | String | No | | Brief description |
| BW | client_liabilities_bonds | Decimal | No | | ZAR amount |
| BX | client_liabilities_loans | Decimal | No | | ZAR amount |
| BY | client_liabilities_other | Decimal | No | | ZAR amount |
| BZ | client_notes | String | No | | Free-text field for clerk notes |
| CA | client_data_source | String | No | | Sage, Xero, SARS, CIPC, Manual |
| CB | client_last_updated | Timestamp | No | | Timestamp of last edit |
| CC | client_updated_by | String | No | | Clerk name or user ID |
| CD | client_import_batch_id | String | No | | Reference to import session |
| CE | compliance_sars_filing_status | String | No | | Current, Outstanding, N/A |
| CF | compliance_annual_audit_required | String | No | | Yes, No |
| CG | compliance_annual_audit_status | String | No | | Current, Outstanding, N/A |
| CH | compliance_last_reviewed_date | Date | No | | YYYY-MM-DD format |

**Key Rules:**
- Columns A-Z: Company-level data (one row per company)
- Columns AA-CH: Client-level data (multiple rows per company, one client per row)
- All required fields (marked Yes) must have values before export
- Enum fields must contain only allowed values (no free text)
- Date fields must be YYYY-MM-DD or empty
- Numeric fields must be valid numbers or empty
- The exporter asserts 86 columns exactly and in this order

---

## Getting Started

1. Read `docs/PROBLEM_DEFINITION.md` to understand the problem space
2. Read `docs/BUILD_LOG.md` to understand design decisions
3. Read this file again (you just read it, but read key sections again)
4. Read `docs/UI_REDESIGN_SPEC.md` section by section as you implement
5. Read `src/lib/schema/datagrows.ts` (the schema file—don't modify it, understand it)
6. Read `docs/TECH_STACK.md` for tech decisions
7. Start implementation from "Core Data Pipeline" section above

**Remember:** The goal is to produce a tool that takes messy SA accounting data and outputs a valid DataGrows masterfile. Every module supports this goal. Focus, execute, test.

Good luck!

