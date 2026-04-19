# Woza La — Final Design Spec v1

**For Claude Code.** This is the complete and final spec for Woza La. Read `CLAUDE.md`, `README.md`, and this entire spec before writing any code.

This spec replaces all previous design documents. It defines a 3-step pipeline, addresses 20 identified failure modes, and is intended to be built once — there is no v2.

---

## 1. Overview

### The App
Woza La is DataGrows' internal onboarding tool. Accounting firms give DataGrows their client data from scattered sources (Sage, Xero, SARS eFiling, CIPC, manual Excel). A DataGrows clerk uploads all files into Woza La, which normalizes, deduplicates, merges, lets the clerk review and fix everything, then exports a populated `.xlsx` masterfile for upload to DataGrows.

### The 3-Step Pipeline
```
1. Import  →  2. Review  →  3. Export
```

- **Import**: Upload files, select source types, add firm staff, run pipeline.
- **Review**: Confirm mappings, review merged data, fix issues, bulk edit, manage conflicts.
- **Export**: Download masterfile, track versions, see excluded/skipped clients.

### What Changes from Current Codebase
- Session page layout: horizontal tabs → sidebar + breadcrumb navigation
- Pipeline: 6 steps → 3 steps (Staff + Map + Services + Validate + Audit all fold into Import or Review)
- Upload UX: file input → drag-and-drop with source pills + file cards
- 20 new features addressing identified failure modes (see sections 5–16)
- New backend logic for: mapping confirmation, incremental imports, session locking, export versioning, bulk actions, staff fuzzy matching, dedup confirmation, file pre-validation

### What Does NOT Change
- `public/datagrows_canonical_template.xlsx` — never touch this
- `src/lib/schema/datagrows.ts` — field definitions stay the same (86 fields, same order)
- `src/lib/rules/rules.json` — rules stay declarative JSON
- `tailwind.config.ts` — keep current colors (#2BBCBC teal, #2D3748 navy, Poppins font)
- `src/app/globals.css` — extend, don't rewrite

---

## 2. Layout

### 2.1 Top Header
Full-width sticky bar:
- Left: "Woza La" logo (teal, 700 weight) + "· Get In Stay In" tagline
- Right (home page): operator avatar (initials circle) + name
- Right (session page): firm name (semibold) + session badge (`Session #0042 · 20 clients`) + live presence indicator (see section 14)

### 2.2 Breadcrumb Bar (Session Page Only)
Below the header. Three steps as clickable breadcrumb items:
```
(✓) Import  ›  (2) Review  ›  (3) Export
```
- Completed step: teal circle with checkmark, teal text
- Active step: teal filled circle with number, bold text
- Upcoming step: grey circle with number, grey text
- Clicking a completed or active step navigates to it. Upcoming steps are clickable too — no hard gating.

### 2.3 Sidebar (Session Page Only)
Fixed left panel, 260px wide.

**Section A: Navigation**
Three nav items with icons (lucide-react):
- Import → `Upload` icon
- Review → `ClipboardList` icon
- Export → `Download` icon

Active item: teal text, teal-50 bg, 3px teal left border.

**Section B: Clients**
Header: `CLIENTS (N)` — only appears after pipeline has run.

Each client shows:
- Client name (truncated, ellipsis)
- Validation badge: "Ready" (green), "2 errors" (red), "1 warning" (amber), "Skipped" (grey)

Clicking a client switches to Review and opens that client's editor.

**No completion percentages anywhere.** Validation status badges only.

### 2.4 Content Area
Takes remaining width. Renders the active step component. Max-width 1100px.

---

## 3. Home Page (Sessions List)

**File: `src/app/page.tsx`** — rewrite.

### 3.1 Header
Same top header as session page, but right side shows operator avatar + name only.

### 3.2 Stats Row
Four stat cards:
- Total sessions (navy)
- In progress (teal)
- Exported (green)
- Needs attention (amber)

### 3.3 Action Bar
- Left: "All Sessions" heading
- Right: "+ New Session" button (teal, rounded)

### 3.4 Filter Row
- Search input with magnifying glass icon (searches firm name + operator)
- Filter pills: All | In Progress | Exported | Archived

### 3.5 Sessions Table
Columns: Firm | Status | Clients | Operator | Last Updated | Notes

**Status badges** with colored dots:
- Importing (amber)
- Reviewing (blue)
- Exported (green)
- Archived (grey)

Note: The old `uploading` and `mapping` statuses are consolidated into `Importing`. The `sessions` table `status` column should accept: `importing`, `reviewing`, `exported`, `archived`.

**Duplicate firm detection (Fix #16):** When the operator types a firm name in the New Session modal, if an active session already exists for that firm name (case-insensitive fuzzy match), show a warning: "An active session for 'Rich Accountants' already exists (#0042, operated by Simz). Create anyway?" This prevents accidental duplicate sessions.

### 3.6 New Session Modal
Fields:
- **Firm Name** (required) — text input with duplicate detection (see above)
- **Operator** (required) — dropdown populated from a `operators` config or hardcoded list
- **Notes** (optional) — text input for handoff context

On submit: creates session in Supabase, navigates to `/sessions/[id]` on the Import step.

---

## 4. Step 1 — Import

**File: `src/components/steps/ImportStep.tsx`** — replaces `UploadStep.tsx`.

The operator uploads files, selects source types, and adds firm staff. This step can be revisited at any time to add more files (Fix #2).

### 4.1 Source Type Pills
A row of pill buttons above the drop zone:
```
Sage | Xero | SARS eFiling | CIPC | Excel | Employees | Company Info
```
Active pill: teal bg, white text. Inactive: grey border, navy text. Operator selects the source type BEFORE dropping a file.

### 4.2 Drop Zone
Dashed-border area (2px dashed, teal-200, rounded-2xl, teal-50 bg):
- Upload icon (40px, teal-500)
- "Drag files here or click to browse"
- "Supports .xlsx, .xls, .csv · Max 10MB per file"
- Drag hover state: solid teal border, teal-light bg
- Hidden file input triggered by click

### 4.3 File Pre-Validation (Fix #15)
Before accepting a file, run these checks:
1. **File size**: reject > 10MB with clear error
2. **File format**: must be .xlsx, .xls, or .csv
3. **Parseable**: SheetJS must be able to open it without error. If it fails (password-protected, corrupted), show: "This file couldn't be read. It may be password-protected or corrupted."
4. **Has headers**: check if row 1 looks like headers (not data). If row 1 looks like data, prompt: "This file doesn't seem to have headers in row 1. Is the header on a different row?" with a row number picker.
5. **Has data**: must have at least 1 data row below headers.
6. **Merged cells warning**: if SheetJS detects merged cells, warn: "This file has merged cells which may cause data to be read incorrectly. Consider unmerging cells in Excel first."

Show validation results immediately after drop — green checkmark for pass, amber warning for soft issues, red X for hard failures.

### 4.4 File Cards
Below the drop zone, header: `Files added (N)`

Each uploaded file as a card:
- File icon (lucide `FileSpreadsheet`)
- Filename (font-medium)
- Metadata: `{rows} rows · {columns} columns · {fileSize}`
- Source type badge (colored):
  - Sage: teal
  - Xero: blue
  - SARS: amber
  - CIPC: purple
  - Excel: navy
  - Employees: green
  - Company Info: indigo
- Remove button (X, appears on hover, confirms before deleting)

### 4.5 Firm Staff Section
Below file cards, separated by a divider.
- Header: "Firm Staff"
- Subtitle: "Add partners, managers, and accountants. These populate columns AA–AH in the masterfile."
- Table: Name | Role (dropdown: Partner, Manager, Accountant) | Email
- "+ Add staff member" link at bottom
- Each row has a remove button

### 4.6 Incremental Import Behavior (Fix #2)
The operator can return to Import from any step and add new files. When they do:
1. New file is parsed and uploaded normally
2. Pipeline re-runs: normalize → match → merge for ALL files (old + new)
3. All manual edits from the `edits` table are re-applied on top of the new merge
4. If a manual edit conflicts with new source data (operator set Year End to "March" but new CIPC file says "February"), flag it in Review: **"Conflict: You set Year End to March, but the new CIPC file says February."** Operator chooses which to keep.
5. Existing skipped clients stay skipped
6. Session status stays on "Reviewing" (doesn't reset to "Importing")

### 4.6.1 Confirmation Gate Reset on Re-Run
When the pipeline re-runs after adding new files:
- **Mapping Confirmation resets** — new files may introduce new columns that need mapping
- **Dedup Confirmation resets** — new records may create new potential duplicates
- **Staff Name Matching resets** — new files may reference new staff names
- The operator must go through all three gates again, but previously-confirmed mappings are preserved as defaults (they don't have to redo everything from scratch)

### 4.7 "Run Pipeline" Button
At the bottom of the Import step, a prominent button: **"Process Files & Continue →"** (teal, full-width).
- Runs the full pipeline: parse → normalize → match → merge → rules engine → validate
- Shows a progress indicator while running
- On completion, auto-navigates to Review step
- If the operator adds files later, the button text changes to: **"Re-process with New Files →"**

---

## 5. Mapping Confirmation Gate (Fix #1)

**File: `src/components/steps/MappingConfirmation.tsx`** — new file.

After the pipeline runs, before the Review data table is shown, display a **mandatory mapping confirmation panel**. This is the first thing the operator sees in the Review step if mappings haven't been confirmed yet.

### 5.1 Layout
Full-width panel replacing the review content until confirmed.

Header: "Confirm Column Mappings"
Subtitle: "Woza La matched your source columns to DataGrows fields. Review the matches below — especially any flagged as uncertain."

### 5.2 Mapping Table
One row per mapped column across all source files:

| Source File | Source Column | → | DataGrows Field (dropdown) | Confidence | Sample Value |
|------------|--------------|---|---------------------------|------------|--------------|
| sage_export.xlsx | Company Reg No | → | [Registration Nr ▾] | ● High | 2018/123456/07 |
| sage_export.xlsx | Tax Reference | → | [Tax Nr ▾] | ● Medium | 901234... |
| cipc_returns.xlsx | Registration Number | → | [Registration Nr ▾] | ● High | 2018/123456/07 |
| master_list.xlsx | Reg # | → | [⚠ Registration Nr? ▾] | ○ Low | 2018/12... |
| sars_data.csv | Taxpayer Name | → | [Client Name ▾] | ● High | Mama Zola... |

**Every row has a dropdown** — the DataGrows Field column is always an editable select. The clerk can override any mapping, not just the uncertain ones. This is critical: even high-confidence matches can be wrong.

**Dropdown options** include all 86 DataGrows fields grouped by category, plus a "— Skip this column —" option to ignore the source column entirely.

**Confidence levels** (visual only — they hint at which rows to check, but don't restrict editing):
- **High** (green dot): exact or near-exact header match — dropdown has default border
- **Medium** (amber dot): partial match, likely correct — dropdown has amber border
- **Low** (red dot): uncertain, needs manual review — dropdown has red border, row bg is red-light

**Unmatched columns** appear at the bottom in a red-highlighted section with the dropdown defaulting to "— Assign field —" (no pre-selection).

### 5.5 Per-File Controls
Mappings are grouped by source file. Each file group has a header bar showing:
- **Source type badge** (Sage, Xero, SARS, etc.) — with a dropdown to **re-tag the source type** if the clerk realizes the file was labelled incorrectly. Changing the source type re-runs auto-mapping heuristics for that file's columns.
- **File name and stats** (rows, columns)
- **"Exclude file" checkbox** — if the clerk realizes this file is wrong, corrupted, or a duplicate, they can exclude it entirely. Excluded files are greyed out and their columns are removed from the mapping. The file stays in the session (not deleted) so it can be re-included later.

Files with uncertain mappings (any Low-confidence columns) have their header bar highlighted in red-light to draw attention.

### 5.6 What the Clerk CAN Change on This Page
1. **DataGrows field assignment** for any column (dropdown on every row)
2. **Source type** for any file (dropdown in file header)
3. **Exclude/include** entire files (checkbox in file header)
4. **Skip individual columns** ("— Skip this column —" option in dropdown)

### 5.7 What the Clerk CANNOT Change on This Page
- Individual cell values (that's the Review step's job)
- Staff members (that's the Import step)
- Validation errors (that's the Review step)
- The actual file content (they'd need to re-upload a corrected file via Import)

### 5.3 Bilingual Header Support (Fix #20)
The auto-mapper must handle Afrikaans column headers common in SA firms:
- "Kliënt Naam" → Client Name
- "Registrasienommer" → Registration Nr
- "Belastingnommer" → Tax Nr
- "BTW Nommer" → VAT Nr
- "Geboortedatum" → Date of Birth
- "Entiteitstipe" → Entity Type
- "Status" → Status (same in both languages)

Maintain a lookup table of Afrikaans → English header mappings in `src/lib/normalizer/headers.ts`.

### 5.4 Confirm Button
**"Confirm Mappings & Load Data"** (teal button). Only after clicking this does the merged data appear in the Review table. If any Low-confidence mappings exist, the button label changes to: **"Confirm Mappings (3 uncertain)"** and requires explicit acknowledgment.

---

## 6. Step 2 — Review

**File: `src/components/steps/ReviewStep.tsx`** — major rewrite.

This is where the operator spends 95% of their time. It contains: summary cards, filter tabs, the client data table with inline editing, merge conflict indicators, audit log with revert, and action buttons.

### 6.1 Summary Cards (Top)
Four stat cards:
- **Total clients** (teal)
- **Ready** (green) — pass validation, no errors
- **Has errors** (red) — blocked from export
- **Warnings** (amber) — will export but flagged
- **Skipped** (grey) — intentionally excluded

These update live as the operator makes changes.

### 6.2 Filter Tabs
Below summary cards:
```
All Clients (20) | Needs Attention [5] | Warnings [3] | Ready [12] | Skipped [0]
```
Red/amber/green/grey badge counts. Clicking filters the table.

### 6.3 Bulk Action Bar (Fix #5)
Checkboxes on each client row. When 2+ are selected, a bar slides up from the bottom:

```
┌─────────────────────────────────────────────────────────────────────┐
│  4 clients selected    Set Partner ▾  │  Set Accountant ▾  │  Set Manager ▾  │  Set Status ▾  │  Skip All  │  ✕ Clear  │
└─────────────────────────────────────────────────────────────────────┘
```

Available bulk actions:
- **Set Partner / Manager / Accountant** — dropdown of firm staff
- **Set Status** — Active / Inactive / Pending / Dormant
- **Set Entity Type** — dropdown of entity types
- **Set any boolean service field** — true/false (VAT, Payroll, Income Tax, etc.)
- **Skip All** — marks all selected as skipped
- **Unskip All** — un-skips all selected

Each bulk action creates individual audit entries for every affected client.

**Dropdown option sources:**
- Partner / Manager / Accountant dropdowns: populated from the firm's staff list (loaded from `firm_staff` table)
- Status dropdown: hardcoded from schema enum — Active, Inactive, Pending, Dormant
- Entity Type dropdown: hardcoded from schema enum in `DATAGROWS_FIELDS`
- Boolean service fields: simple true/false toggle

**Success feedback:** After a bulk action completes, show a teal toast notification at the top of the content area: "✓ Partner set to Thabo Mokoena for 4 clients." Toast auto-dismisses after 4 seconds. Each individual change is logged in the audit trail.

### 6.4 Client Data Table
Columns:

| ☐ | Client Name | Entity Type | Status | Issues | Sources |
|---|------------|-------------|--------|--------|---------|

- **Client Name**: font-weight 500
- **Entity Type**: grey badge
- **Status**: colored dot + text (green=Active, grey=Inactive, amber=Pending)
- **Issues**: badge — "Ready" (green), "2 errors" (red), "1 warning" (amber), "Skipped" (grey)
- **Sources**: small text listing which source files contributed (e.g., "Sage, SARS, CIPC")

Clicking a row expands the inline editor for that client.

**Pagination (Fix #14):** Show 50 clients per page. At the top of the table: "Showing 1–50 of 200 clients" with page controls. The sidebar client list uses virtual scrolling for sessions with 100+ clients.

### 6.5 Inline Client Editor
Expands below the clicked row. Grouped by field category (matching the groups in `DATAGROWS_FIELDS`):

**Groups:**
- Identity (Client Name, Status, Comment, Entity Type, Year End, etc.)
- Tax & Registration (Tax Nr, VAT Nr, PAYE Nr, UIF Reg, etc.)
- Contact (Primary Contact, Contact Nr, Contact Email, etc.)
- Staff Assignments (Partner, Manager, Accountant, role overrides)
- Services (all boolean fields: VAT, Payroll, Income Tax, etc.)
- Accounting Config (Accounting type, start month, due date, etc.)
- Addresses (Physical + Postal)
- Misc (Bank Details, Rating, Referred By, etc.)

**Field rendering:**
- Text fields: input with current value
- Enum fields: dropdown with valid options from `DATAGROWS_FIELDS`
- Boolean fields: dropdown with `true` / `false`
- Date fields: input with placeholder `dd/mm/yyyy`

**Error/warning indicators:**
- Fields with validation errors: red border + red error message below
- Fields with warnings: amber border + amber message below

### 6.6 Merge Conflict Indicators (Fix #4)
Fields that had conflicting values from multiple sources show a small **blue dot** next to the field label. Clicking the dot opens a popover:

```
┌──────────────────────────────────────────┐
│  Source Conflict — Year End               │
│                                           │
│  Sage:        March                       │
│  SARS:        February                    │
│  CIPC:        February     ← Winner       │
│                                           │
│  Rule: CIPC > SARS > Sage                │
│  [Override with different value]          │
└──────────────────────────────────────────┘
```

Fields auto-filled by the **rules engine** show a small `auto` tag next to the label in a muted style. Hovering shows: "Auto-filled by rule: PTY LTD entities require CIPC Annual Return = true."

This lets the operator distinguish at a glance: source data vs. inferred data vs. conflicted data.

**Popover behavior:**
- Opens on click of the conflict dot, closes on click outside or pressing Escape
- "Override with different value" opens the field's dropdown/input below the popover, pre-focused, so the operator can immediately type or select a new value
- After override, the conflict dot changes from blue to green (indicating "resolved — operator chose manually")

### 6.7 Audit Log with Revert (Fix #8)
At the bottom of each client's editor, a collapsible section:

```
▸ Edit History (4 changes)
```

Expanded:
```
14:40  Naledi  ·  Year End  ·  "March" → "February"     [Revert]
14:35  Sipho   ·  Status    ·  "Pending" → "Active"     [Revert]
14:33  Sipho   ·  VAT Nr    ·  "" → "4012345678"        [Revert]
14:32  Sipho   ·  Tax Nr    ·  "" → "9012345678"        [Revert]
```

**Revert button** restores the field to its previous value and creates a new audit entry: "Reverted Year End: February → March (original merged value)".

**Revert and auto-fill rules:** If the operator reverts a field that was auto-filled by the rules engine, the revert is "sticky" — the rules engine will NOT re-fill it on subsequent pipeline runs. The revert is stored as a manual edit in the `edits` table, which takes precedence over rules engine output. This prevents the frustrating cycle of revert → auto-fill → revert.

### 6.8 Skip/Exclude Clients (Fix #7)
Each client row has a "…" menu (or right-click) with:
- **Skip this client** — marks as intentionally excluded. Badge changes to grey "Skipped". Client moves to bottom of table. Doesn't count toward error totals.
- **Unskip** — restores to normal state.

Skipped clients are excluded from export but remain in the session data. They're visible in the "Skipped" filter tab.

### 6.9 Missing Data Export (Fix #6)
A button next to the summary cards: **"Copy Missing Data List"** (outline button with clipboard icon).

Generates:
```
Missing data for Rich Accountants — 19 Apr 2026

Bheki Ngubane (INDIVIDUAL):
  - Year End (required for tax task scheduling)
  - Entity Type (required for tax task scheduling)

Sarah's Flowers (SOLE PROP):
  - ID/Passport Number (required for Sole Props)

Van Wyk & Partners (PARTNERSHIP):
  - Year End (required for tax task scheduling)

3 clients with missing data. Please provide the above and we'll update the file.
```

Two actions:
- **Copy to clipboard** — ready to paste into email
- **Download .txt** — for attachment

### 6.10 Accept `defaultOpenClusterId` Prop
```tsx
export function ReviewStep({
  sessionId,
  operatorName,
  defaultOpenClusterId,
}: {
  sessionId: string;
  operatorName?: string | null;
  defaultOpenClusterId?: string | null;
})
```
When set, auto-scroll to and open that client's editor. Enables sidebar click → jump to client.

---

## 7. Deduplication with Confirmation (Fix #9)

**Modify: `src/lib/matcher/index.ts`**

### 7.1 Primary Key Matching
Use hard identifiers as the primary dedup key:
- **Companies** (PTY LTD, CLOSE CORPORATION, CO-OPERATIVE, PLC, PUBLIC COMPANY, EXTERNAL COMPANY): match on **Registration Number**
- **Individuals** (INDIVIDUAL, SOLE PROP, DIRECTOR, CC MEMBER): match on **ID/Passport Number**
- **Trusts**: match on **Trust Deed Number**
- **Others** (ESTATE, NON-PROFIT, ASSOCIATION, BODY CORPORATE, GOVERNMENT ORG, PARTNERSHIP): match on **Registration Number**, fall back to name

If two records share the same primary key across different source files → automatic merge (high confidence).

### 7.2 Name-Based Matching Requires Confirmation
When no primary key match exists but names are similar (Levenshtein ≥ 0.85), do NOT auto-merge. Instead, flag for operator review.

**File: `src/components/steps/DedupConfirmation.tsx`** — new file.

Show after mapping confirmation, before the full review table:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Possible Duplicates Found (3 pairs)                                │
│                                                                      │
│  "Van Wyk & Partners" (Sage) ↔ "Van Wyk Attorneys" (Excel)         │
│  Similarity: 87%  ·  No shared Registration Nr                      │
│  [ Merge ] [ Keep Separate ]                                        │
│                                                                      │
│  "S. Dlamini Trading" (SARS) ↔ "Sipho Dlamini" (Excel)             │
│  Similarity: 72%  ·  Same Tax Nr: 9012345678                        │
│  [ Merge ] [ Keep Separate ]                                        │
│                                                                      │
│  "Mama Zola Kitchen" (CIPC) ↔ "Mama Zola's Kitchen" (Sage)         │
│  Similarity: 94%  ·  Same ID: 8501015800086                         │
│  [ Merge ] [ Keep Separate ]                                        │
└─────────────────────────────────────────────────────────────────────┘
```

The operator decides for each pair. No silent merges on name similarity alone.

### 7.4 Overriding Auto-Merged Records
Even primary-key matches (auto-merged) can be wrong — for example, the same Registration Number entered on two different entities due to a data capture error. The operator must be able to override auto-merges.

For auto-merged pairs, show a "Split" link instead of a disabled button: "Auto-merged (same ID: 8501015800086) · [Split if incorrect]". Clicking "Split" separates the records back into two individual clients and creates an audit entry.

### 7.3 SA ID Number Validation (Fix #17)
Before matching on ID numbers, validate the format:
- SA ID: 13 digits, first 6 = date of birth (YYMMDD), valid Luhn checksum
- If an ID number is 12 digits, it likely lost a leading zero — auto-prepend and warn: "ID number 501015800086 appears to be missing a leading zero. Corrected to 0501015800086."
- Registration numbers: validate against CIPC format (YYYY/NNNNNN/NN)
- Tax numbers: validate 10 digits
- VAT numbers: validate 10 digits

---

## 8. Staff Name Fuzzy Matching (Fix #11)

**File: `src/components/steps/StaffMatching.tsx`** — new file.

After mapping confirmation and dedup confirmation, if source files contain staff-related columns (Partner, Manager, Accountant), compare the values found in the data against the firm's staff list.

### 8.1 Matching Panel
```
Staff names found in your data — match them to the staff list:

"T. Mokoena"     →  Thabo Mokoena     (suggested, 92% match)   [✓ Accept] [✕ Skip]
"M van Wyk"      →  Mariska van Wyk   (suggested, 88% match)   [✓ Accept] [✕ Skip]
"D. Sithole"     →  David Sithole     (suggested, 85% match)   [✓ Accept] [✕ Skip]
"John"           →  (no match found)  [Assign ▾] [✕ Skip]
```

After confirmation, all client records referencing "T. Mokoena" get updated to "Thabo Mokoena" across all staff fields.

### 8.2 Unmatched Staff
If a name in the source data doesn't match any staff member and the operator skips it, the field stays as-is. The validator flags it as a warning: "Staff name 'John' doesn't match any firm staff member."

---

## 9. Step 3 — Export

**File: `src/components/steps/ExportStep.tsx`** — rewrite.

### 9.1 Summary Cards
Three cards:
- **Ready to export** (green) — count
- **Blocked (has errors)** (red) — count
- **Skipped** (grey) — count

### 9.2 Readiness Bar
Full-width progress bar:
- Green fill = % of non-skipped clients that are ready
- Text: "15 of 18 clients ready to export (83%)"
- Note: "2 clients skipped (intentionally excluded)"

### 9.3 Export Card
```
┌─────────────────────────────────────────────────────────────┐
│  📊  DataGrows Masterfile                                    │
│                                                              │
│  The import file for DataGrows onboarding.                   │
│  86 columns · x14 dropdown validations preserved.            │
│                                                              │
│  15 clients · Rich Accountants                               │
│                                                              │
│  [ Download .xlsx ]                                          │
└─────────────────────────────────────────────────────────────┘
```

### 9.4 Blocked Clients Panel
Red-tinted panel listing every client excluded due to errors:
```
3 clients excluded (errors):
  Bheki Ngubane — Missing Year End, Missing Entity Type
  Van Wyk & Partners — Missing Year End
  Sarah's Flowers — Missing ID/Passport Number for Sole Prop

← Go back to Review to fix these
```

"Go back to Review" link navigates to Review step.

### 9.5 Export Version History (Fix #12)
Below the export card, a version log:

```
Export History
─────────────────────────────────────────────────────
v2  ·  19 Apr 2026 14:32  ·  Simz   ·  18 clients  ·  [Download]
v1  ·  17 Apr 2026 09:15  ·  David  ·  15 clients  ·  [Download]
```

Each export is saved as a snapshot in Supabase Storage. The latest has a "Latest" badge.

**Changed-since-export warning:** If any edits have been made since the last export, show: "⚠ Data changed since last export (4 edits). Re-export to get the latest version." with a highlighted re-export button.

### 9.7 Export File Storage
Export snapshots are stored in Supabase Storage under: `exports/{session_id}/v{version_number}.xlsx`

Example: `exports/abc-123-def/v1.xlsx`, `exports/abc-123-def/v2.xlsx`

Storage cleanup: versions older than 90 days are eligible for automatic deletion via the session cleanup process (section 16). The latest version is never deleted.

### 9.6 Export Versioning Schema
New table in Supabase:
```sql
CREATE TABLE export_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  version_number INTEGER NOT NULL,
  exported_by TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_count INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  UNIQUE(session_id, version_number)
);
```

Migration SQL to provide to the operator.

---

## 10. Session Locking (Fix #10)

### 10.1 Presence Tracking
When an operator opens a session, register their presence via Supabase Realtime (presence channel per session).

### 10.2 Active Editor Indicator
In the session header, show: `🟢 Simz is editing` with a green dot.

### 10.3 Conflict Warning
If a second operator opens the same session:
```
┌──────────────────────────────────────────┐
│  ⚠ Simz is currently editing this session.│
│                                          │
│  Your changes may conflict with theirs.  │
│                                          │
│  [ View Only ]    [ Edit Anyway ]        │
└──────────────────────────────────────────┘
```

"View Only" opens the session in read-only mode (all inputs disabled, no save actions).
"Edit Anyway" proceeds normally but shows a persistent warning banner.

This is a soft lock — it warns but doesn't hard-block, because hard locks break when someone closes their laptop without logging out.

### 10.4 Presence Timeout
If an operator's browser loses connection (closed laptop, network drop), their presence expires after **5 minutes** of inactivity. Supabase Realtime handles this via heartbeat — when heartbeats stop, the presence record is removed automatically.

Additionally, the `active_editor` and `active_editor_since` columns on the `sessions` table serve as a fallback. If `active_editor_since` is older than 10 minutes and no Realtime presence is active, the lock is considered stale and is ignored.

---

## 11. Template Versioning (Fix #13)

### 11.1 Template Metadata
Store template version info in a new file: `src/lib/schema/template-version.ts`

```typescript
export const TEMPLATE_VERSION = {
  version: '1.0',
  columns: 86,
  lastUpdated: '2026-04-19',
  checksum: '<sha256 of datagrows_canonical_template.xlsx>',
};
```

### 11.2 Template Validation on Export
Before every export, verify the template file:
1. Compute SHA-256 of `public/datagrows_canonical_template.xlsx`
2. Compare against stored checksum
3. If mismatch: warn "The DataGrows template file has been modified. Export may produce invalid results."
4. Verify column count matches `DATAGROWS_FIELDS.length`

### 11.3 Schema Diffing
If DataGrows updates their template in the future:
1. Replace `public/datagrows_canonical_template.xlsx` with the new file
2. Run a diffing script (`src/lib/schema/diff-template.ts`) that:
   - Reads the new template headers
   - Compares against `DATAGROWS_FIELDS`
   - Reports: added columns, removed columns, renamed columns, changed dropdown values
3. Update `datagrows.ts` schema to match
4. Update template version + checksum

This isn't automatic migration — it's a manual but documented process that prevents silent drift.

---

## 12. Large Firm Scaling (Fix #14)

### 12.1 Pagination
Client tables show 50 rows per page. Page controls at top and bottom.

### 12.2 Virtual Scrolling in Sidebar
The sidebar client list uses virtual scrolling (render only visible items) for sessions with 100+ clients.

### 12.3 Pipeline Performance
For sessions with 200+ clients:
- Show a progress bar during pipeline execution with stage labels: "Normalizing... Matching... Merging..."
- Run the pipeline as a **server-side API route** (`/api/pipeline/[sessionId]`). The ImportStep calls this API, which runs normalize → match → merge → rules → validate on the server. The API returns progress updates via Server-Sent Events (SSE):

```typescript
// Client polls or listens to SSE
// Progress messages: { stage: 'normalizing' | 'matching' | 'merging' | 'rules' | 'validating', progress: number }
```

This avoids web worker complexity and keeps heavy processing off the client. Add this new API route to the files list.

### 12.4 Lazy Loading in Editor
The inline editor for a client only fetches the full field data when expanded. The table row shows summary data (name, entity, status, issues) loaded in bulk.

### 12.5 Virtual Scrolling Library
Use `react-window` (already lightweight, no additional heavy dependencies) for the sidebar client list. Install: `npm install react-window @types/react-window`.

Add to the "New Dependencies" note: `react-window` and `@types/react-window`.

---

## 13. File Pre-Validation (Fix #15)

Already defined in section 4.3. Additional detail:

### 13.1 Source-Specific Validation
After basic file validation, run source-specific checks:

**Sage exports:** Expect columns like "Account Number", "Company Name", "Vat No". If none of these are found, warn: "This doesn't look like a Sage export. Are you sure about the source type?"

**Xero exports:** Expect "Contact Name", "Email", "Tax Number". Similar warning if not found.

**SARS eFiling:** Expect "Taxpayer Name", "Tax Reference Number", "Tax Type". Warning if not found.

**CIPC:** Expect "Enterprise Name", "Registration Number", "Enterprise Type". Warning if not found.

This catches the common error of selecting the wrong source type.

### 13.2 Encoding Detection
Detect file encoding (UTF-8, Windows-1252, ISO-8859-1). SA firms commonly use Windows-1252 which has different handling for characters like "ë" in Afrikaans names. Convert to UTF-8 internally.

---

## 14. Duplicate Session Detection (Fix #16)

Already defined in section 3.6. Implementation detail:

### 14.1 Fuzzy Firm Name Match
When the operator types a firm name in the New Session modal, query existing sessions:
```sql
SELECT id, firm_name, status, operator_name
FROM sessions
WHERE status NOT IN ('archived')
AND similarity(firm_name, $1) > 0.6
ORDER BY similarity(firm_name, $1) DESC
LIMIT 3;
```

Requires `pg_trgm` extension in Supabase (usually pre-installed). If not available, fall back to case-insensitive `ILIKE '%name%'`.

Show matching sessions as warnings below the input field.

---

## 15. SA ID Number Handling (Fix #17)

Already defined in section 7.3. Additional normalizer rules:

### 15.1 Leading Zero Recovery
In `src/lib/normalizer/index.ts`, add for ID/Passport Number:
```typescript
// SA ID numbers are 13 digits. If 12 digits, likely lost leading 0
if (/^\d{12}$/.test(value)) {
  value = '0' + value;
  // Validate with Luhn checksum
}
```

### 15.2 Registration Number Format
CIPC registration numbers follow: `YYYY/NNNNNN/NN` (e.g., `2018/123456/07`).
- If the value has no slashes but is 12+ digits, attempt to format: `2018123456 07` → `2018/123456/07`
- If format doesn't match, flag as warning (not error — some older registrations have different formats)

### 15.3 Tax/VAT Number Validation
- Tax numbers: exactly 10 digits
- VAT numbers: exactly 10 digits, starts with 4
- If shorter: warn "Tax number appears incomplete"
- If longer: warn "Tax number appears to have extra characters"

---

## 16. Session Cleanup (Fix #18)

### 16.1 Stale Session Warning
On the home page, sessions not updated in 30+ days show an amber "Stale" badge. Sessions not updated in 90+ days show a red "Inactive" badge with an "Archive" action.

### 16.2 Archive Action
Archiving a session:
- Sets status to `archived`
- Deletes uploaded files from Supabase Storage (keeps raw_records and clusters for audit)
- Archived sessions are hidden by default on the home page (visible via the "Archived" filter)

### 16.3 Storage Indicator
On the home page stats row, add a small storage indicator: "Storage: 2.4 GB / 5 GB" (based on Supabase Storage usage for the uploads bucket). This surfaces storage pressure before it becomes a crisis.

---

## 17. Session Page State Management

**File: `src/app/sessions/[id]/page.tsx`** — full rewrite.

```typescript
type Step = 'import' | 'review' | 'export';

const [step, setStep] = useState<Step>('import');
const [targetClusterId, setTargetClusterId] = useState<string | null>(null);
const [mappingsConfirmed, setMappingsConfirmed] = useState(false);
const [dedupConfirmed, setDedupConfirmed] = useState(false);
const [staffMatched, setStaffMatched] = useState(false);

// When sidebar client is clicked
function handleClientClick(clusterId: string) {
  setTargetClusterId(clusterId);
  setStep('review');
}

// Clear target after ReviewStep consumes it
useEffect(() => {
  if (step !== 'review') setTargetClusterId(null);
}, [step]);
```

### 17.1 Review Step Internal Flow
When the operator enters the Review step, show panels in this order (only if needed):
1. **Mapping Confirmation** — if not yet confirmed for current pipeline run
2. **Dedup Confirmation** — if fuzzy name matches exist that need operator decision
3. **Staff Name Matching** — if unmatched staff names were found in source data
4. **Review Data Table** — the main review interface (always shown after confirmations)

Each confirmation panel has a "Confirm" action that dismisses it and shows the next one. Once all are confirmed, the full review table is visible and remains visible for the rest of the session (unless the pipeline is re-run from Import, which resets confirmation states).

---

## 18. Files to Create, Modify, Delete

### New Files
- `src/components/steps/ImportStep.tsx` — replaces UploadStep
- `src/components/steps/MappingConfirmation.tsx` — mapping gate
- `src/components/steps/DedupConfirmation.tsx` — dedup review
- `src/components/steps/StaffMatching.tsx` — staff name fuzzy match
- `src/components/DropZone.tsx` — reusable drag-and-drop
- `src/components/SidebarNav.tsx` — 3-item navigation
- `src/components/SidebarClients.tsx` — client list with validation badges
- `src/components/BulkActionBar.tsx` — multi-select action bar
- `src/components/ConflictPopover.tsx` — merge conflict detail popover
- `src/lib/normalizer/headers.ts` — Afrikaans + English header mapping table
- `src/lib/normalizer/id-validator.ts` — SA ID, registration, tax number validation
- `src/lib/normalizer/file-validator.ts` — pre-upload file validation
- `src/lib/schema/template-version.ts` — template version + checksum
- `src/lib/schema/diff-template.ts` — template change diffing script
- `src/app/api/pipeline/[sessionId]/route.ts` — server-side pipeline with SSE progress

### Modified Files
- `src/app/page.tsx` — full rewrite (sessions list with stats, filters, duplicate detection)
- `src/app/sessions/[id]/page.tsx` — full rewrite (3-step layout, sidebar, breadcrumbs)
- `src/app/sessions/new/page.tsx` — update new session form (add duplicate warning)
- `src/components/steps/ReviewStep.tsx` — major rewrite (all Review features)
- `src/components/steps/ExportStep.tsx` — rewrite (version history, blocked panel)
- `src/lib/matcher/index.ts` — primary key matching, name match → confirmation only
- `src/lib/normalizer/index.ts` — add ID leading zero recovery, registration format, encoding
- `src/lib/validator/index.ts` — add staff name validation, ID format validation
- `src/lib/exporter/index.ts` — add version tracking (write to export_versions table)
- `src/app/api/export/[sessionId]/route.ts` — add versioning, snapshot storage
- `src/app/globals.css` — add new utility classes (no removals)
- `supabase/schema.sql` — add export_versions table

### Deleted Files
- `src/components/steps/UploadStep.tsx` — replaced by ImportStep
- `src/components/steps/AuditStep.tsx` — folded into ReviewStep
- `src/components/steps/MappingStep.tsx` — replaced by MappingConfirmation
- `src/components/steps/StaffStep.tsx` — folded into ImportStep

---

## 19. Database Migration

Provide this SQL for the operator to run manually:

```sql
-- Export version tracking
CREATE TABLE export_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id) NOT NULL,
  version_number INTEGER NOT NULL,
  exported_by TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_count INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  UNIQUE(session_id, version_number)
);

-- Add skipped flag to clusters
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS skipped BOOLEAN DEFAULT false;

-- Add mapping confirmation state to sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mappings_confirmed BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS dedup_confirmed BOOLEAN DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS staff_matched BOOLEAN DEFAULT false;

-- Add active_editor for soft locking
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_editor TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_editor_since TIMESTAMPTZ;

-- Enable trigram similarity for duplicate firm detection (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Index for firm name similarity search
CREATE INDEX IF NOT EXISTS idx_sessions_firm_name_trgm ON sessions USING gin (firm_name gin_trgm_ops);
```

---

## 20. Styling Guidelines

- Keep all existing CSS classes from `globals.css`
- Sidebar: `bg-white`, `border-r border-gray-200`, 260px wide
- Sidebar section headers: `text-xs font-semibold uppercase tracking-wider` in navy-400
- Active nav: `text-teal-600 bg-teal-50 border-l-[3px] border-teal-500`
- Breadcrumb circles: 24px diameter, `border-2`
- Drop zone: `border-2 border-dashed border-teal-200 rounded-2xl`
- File cards: white bg, `border border-gray-200 rounded-lg p-4`
- Source badge colors: Sage=teal, Xero=blue, SARS=amber, CIPC=purple, Excel=navy, Employees=green, Company Info=indigo
- Conflict dot: `w-2 h-2 rounded-full bg-blue-400` inline with field label
- Auto-fill tag: `text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500` with text "auto"
- Bulk action bar: fixed bottom, white bg, `border-t shadow-lg`, 56px height
- Validation badges: green=`bg-green-50 text-green-700`, red=`bg-red-50 text-red-700`, amber=`bg-amber-50 text-amber-700`, grey=`bg-gray-100 text-gray-500`
- All icons from `lucide-react`
- No new npm packages unless absolutely required. Use what's in `package.json`.

---

## 21. Implementation Order

Build in this sequence:

1. **Database migration** — run the SQL from section 19
2. **New shared components** — DropZone, SidebarNav, SidebarClients, BulkActionBar, ConflictPopover
3. **Header + layout normalization** — add Afrikaans headers table, ID validators, file validator
4. **ImportStep** — replaces UploadStep (drag-drop, source pills, file cards, staff section, pre-validation)
5. **MappingConfirmation** — mandatory mapping gate with confidence scores
6. **DedupConfirmation** — primary key matching + name match confirmation UI
7. **StaffMatching** — fuzzy staff name matching panel
8. **Matcher updates** — primary key matching, confirmation-required name matching
9. **ReviewStep rewrite** — summary cards, filter tabs, client table with pagination, inline editor, conflict indicators, audit with revert, skip/exclude, missing data export
10. **BulkActionBar integration** — multi-select + bulk actions in ReviewStep
11. **ExportStep rewrite** — version history, blocked panel, re-export warning
12. **Export API update** — versioning, snapshot storage
13. **Session page rewrite** — 3-step layout, sidebar, breadcrumbs, presence/locking
14. **Home page rewrite** — stats, filters, sessions table, duplicate detection, stale warnings
15. **Delete old files** — UploadStep, AuditStep, MappingStep, StaffStep
16. **Run `npm run typecheck && npm run lint && npm run build`** — fix all errors

---

## 22. Do NOT

- Do not change `public/datagrows_canonical_template.xlsx` — ever
- Do not change the shape of `ClientRecord` or the order of `DATAGROWS_FIELDS`
- Do not change `src/lib/rules/rules.json` structure
- Do not regenerate the template with openpyxl or any Python xlsx library
- Do not remove existing CSS classes from `globals.css`
- Do not change `tailwind.config.ts` color palette
- Do not hard-lock sessions (soft lock with warning only)
- Do not auto-merge on name similarity alone (require operator confirmation)
- Do not show completion percentages anywhere (use validation status only)
- Do not install npm packages other than `react-window` and `@types/react-window` — no other new dependencies
