# Problem Definition: Woza La v2

## The Problem

Accounting firms across South Africa manage client data scattered across 5+ independent systems—Sage, Xero, SARS eFiling portals, CIPC registries, and manual Excel spreadsheets. Each source operates with its own schema:

- **Sage** exports client names, ID numbers, and limited contact info
- **Xero** provides invoice history and client classification
- **SARS eFiling** supplies tax registration details and compliance status
- **CIPC** registration databases contain company registration numbers and entity types
- **Manual Excel** entries contain inconsistent column naming, mixed languages (English/Afrikaans), and formatting variations

When DataGrows acquires a new accounting firm as a customer, clerks must manually:

1. Export data from each system (often requiring client/password access or manual CSV export)
2. Open 5+ files simultaneously in Excel
3. Match client records across files (same client might be named "ABC (Pty) Ltd", "ABC", or "ABC CC" in different systems)
4. Deduplicate by hand (comparing ID numbers, registration numbers, addresses)
5. Normalize South African-specific fields:
   - ID numbers lose leading zeros when Excel treats them as numbers (12 digits → 11 displayed)
   - CIPC registration numbers lack consistent formatting (2005/001234 vs 2005001234)
   - Tax ID/VAT numbers sometimes include check digits incorrectly
6. Handle bilingual columns (Afrikaans headers like "Naam" vs English "Name")
7. Manually populate an 86-column DataGrows masterfile (.xlsx) with exact enum values and dropdown validations
8. Send the file back for manual validation and correction

This process takes 4-8 weeks per firm, produces silent data loss (merged records without audit trail), and blocks DataGrows from revenue recognition until onboarding completes.

---

## Who It Affects

### Primary Users
**DataGrows Clerks** (10-50 onboarding operations per month)
- Entry-level staff trained on general Excel but not data engineering
- Process 50-500+ client records per firm
- Often work under deadline pressure (firms want fast onboarding)
- Liable for accuracy but lack visibility into merge decisions

### Secondary Users
**DataGrows Operations** (Reviews exported files)
- Spot-check for data quality
- Cannot audit how merges were made (no trail)
- Manually correct errors, creating rework

### Tertiary Users
**Accounting Firm Partners** (Provide initial data)
- Want fast, accurate setup with no lost client records
- Cannot verify the merge logic applied to their data

---

## Current Pain Points

### 1. No Single Source of Truth
- Clerks must decide which system is "authoritative" for each field
- No documented rules (each clerk develops ad-hoc logic)
- Inconsistent decisions across 10 firms

### 2. Duplicate Client Records
- Same client in Sage and Xero under slightly different names
- Same company in CIPC with abbreviated vs full legal name
- No deduplication logic—manual spot-checking required
- Silent duplicates ship in the export (discovered months later)

### 3. South African ID Number Data Loss
- ID numbers stored as numeric in source systems
- Excel conversion: 12-digit → 11 digits (leading zero lost)
- Example: "0503123456789" becomes "503123456789" in export
- DataGrows downstream validation rejects invalid IDs
- No recovery mechanism in place

### 4. CIPC Registration Number Inconsistency
- Some sources: "2005/001234" (with slash)
- Others: "2005001234" (without slash)
- DataGrows expects "2005001234" (numeric only)
- Clerk must manually reformat or file rejected

### 5. Afrikaans vs English Column Headers
- Xero export (English): "Company Name", "Tax Registration"
- Sage export (South African setup): "Naam", "Belastingverhouding"
- Clerk must manually map 25+ Afrikaans synonyms to English
- Diacritics complicate matching ("Naam" vs "Nä̈m" after encoding issues)

### 6. No Validation Before Export
- File uploaded without schema checks
- Enum dropdowns not enforced (free text can slip through)
- Column count/order never verified (can ship with wrong structure)
- Only discovered when DataGrows import fails

### 7. Merge Decisions Are Invisible
- "I'm pretty sure this is the same client" → no audit trail
- If wrong, no way to trace back and fix
- Rework cost: re-export, find the error, re-merge, re-export

### 8. Rules Engine Overwrites Manual Fixes
- Clerk marks two records as distinct (not a duplicate)
- Re-run import applies automatic merge logic
- Manual fix is lost; clerk must catch and re-fix
- No "sticky" override mechanism

### 9. Incremental Imports Cause Conflicts
- Clerk imports Sage on day 1, Xero on day 3
- Xero merges with existing records (or creates new ones?)
- No conflict detection; silent rework required

### 10. Session Locking Absent
- Two clerks might work the same file simultaneously
- Changes overwrite each other silently
- Discovered only during QA

---

## The Goal

**Build a single tool that takes any combination of source files and produces a valid, audit-trailed DataGrows masterfile in one working session.**

### Functional Goals
- Accept .xlsx, .xls, .csv from any South African accounting system
- Automatically normalize column headers (English + Afrikaans synonyms)
- Detect and recover SA ID numbers (leading zero recovery, Luhn validation)
- Validate and normalize CIPC registration numbers
- Deduplicate records with operator confirmation (no silent merges)
- Apply business rules (e.g., "company must have a tax ID if registered")
- Export a valid 86-column .xlsx with:
  - Exact enum values for all x14 dropdown validations
  - Correct column order (A through CH)
  - All data integrity checks passed
  - Audit trail of all merges and rule applications

### Operational Goals
- Complete onboarding in **one session** (3-4 hours, not weeks)
- **Zero manual fixes** post-export (file accepted by DataGrows immediately)
- **Operator reviews every merge decision** (not automatic)
- **100% audit trail** (who merged what, when, why)
- **Incremental imports supported** (import new data, resolve conflicts, re-export)

---

## Success Criteria

1. **Accepted by DataGrows without manual fixes**
   - Export file passes DataGrows import validation
   - All enum values correct
   - Column structure exact (86 columns, A-CH order)

2. **Zero silent data loss**
   - No records merged without operator confirmation
   - No fields overwritten without audit trail
   - Encoding issues detected and recovered (Windows-1252 → UTF-8)

3. **Operator can review every merge decision**
   - UI shows side-by-side comparison of duplicate records
   - Confidence score displayed (e.g., "95% match based on ID number")
   - Operator clicks "Confirm Merge" or "Keep Separate"
   - Decision logged with operator name, timestamp, reasoning

4. **Audit trail for all changes**
   - Import: which files, timestamp, record count
   - Mapping: which columns mapped to which fields, confidence
   - Deduplication: which records merged, operator decision, confidence
   - Rules applied: which rule fired, before/after value, timestamp
   - Export: which version, timestamp, operator

5. **SA-specific data handled correctly**
   - ID numbers: leading zeros preserved/recovered
   - CIPC numbers: format validated and normalized
   - Afrikaans headers: automatically mapped to English
   - Bilingual firms: both English and Afrikaans names supported

6. **Sessions are atomic and traceable**
   - One session = one onboarding job
   - Cannot lose work (auto-save, version history)
   - Cannot corrupt state (session locking)
   - Can export any historical version

---

## Constraints

### Build Once
- This is Woza La **v2** — final version for production
- No rework expected in Q2 2026 or later
- Extensibility designed in (rules engine, validator plugin architecture) but not over-engineered

### Must Handle SA-Specific Data
- ID numbers (13-digit RSA IDs, 12-digit business IDs)
- CIPC registration numbers (2005/001234 format)
- Tax ID/VAT (10-digit format)
- Afrikaans column headers and diacritics
- Bilingual firm names

### Must Preserve Excel Dropdown Validations
- DataGrows template has x14 columns with dropdown validations (data type "list")
- Validations are defined in hidden sheet (x14 namespace, not standard Excel)
- Export process must load template and copy validations
- SheetJS cannot preserve; must use ExcelJS server-side

### Must Validate Export Structure
- Assert 86 columns present (not 85, not 87)
- Assert column order A-CH (not shuffled)
- Assert enum values match DataGrows schema (cannot have free text in restricted fields)

### Cannot Regenerate Template
- DataGrows template is not in git (proprietary formatting, x14 validations)
- Must be downloaded from Supabase Storage
- Template version tracked by SHA-256 hash
- Cannot use openpyxl or Pandas to regenerate (would lose x14 validations)

### Performance Constraints
- Handle 500+ client records per import
- Support virtual scrolling for large lists (client-side React)
- Streaming file parse (SheetJS can parse 100MB+ files in browser without blocking)

---

## Out of Scope

- **Multi-user collaboration** (read-only session sharing, not real-time multi-edit)
- **Machine learning deduplication** (threshold-based fuzzy matching only, operator confirms)
- **Integration with SARS API** (manual export/upload only)
- **Bulk re-onboarding** (one firm per session)
- **Export to non-Excel formats** (Excel only, per DataGrows spec)

---

## Next Steps

1. Review `docs/BUILD_LOG.md` to understand design evolution (7 steps → 3 steps, 20 failure modes)
2. Read `docs/UI_REDESIGN_SPEC.md` for detailed UI mockups and interaction patterns
3. Review `docs/TECH_STACK.md` for technology decisions
4. Start implementation from `docs/CLAUDE_CODE_KICKOFF.md` (the new CLAUDE.md v2)
