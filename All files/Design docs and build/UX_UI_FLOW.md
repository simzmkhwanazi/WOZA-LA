# Woza La v2 — Complete UX/UI Flow Documentation

This document defines every screen and user journey in Woza La v2. It is the source of truth for UI behavior, visual design, and operator workflows.

---

## Design Principles

### Build Once
Every interaction must be discoverable without training docs. No hidden workflows, no "press this secret key" behaviors. New operators should be able to open Woza La and understand what to do next at every step.

### Operator Control
No silent decisions. Every merge, mapping override, and data conflict resolution requires explicit confirmation. The app never auto-corrects data without showing the operator what was changed and why.

### Progressive Disclosure
Show only what's needed at each step:
- Import step doesn't show validation warnings that belong in Review
- Review step doesn't show merge strategy options that belong in the pipeline setup
- Export step focuses on readiness and download, not historical audit logs

### Visual Feedback
Every action gets immediate feedback:
- Buttons show loading state while processing
- Successful actions trigger teal toast notifications
- Validation errors appear inline with red borders
- Edits are saved in real-time, with a small "saved" indicator

### SA-Aware
Handle South African data formats natively:
- ID numbers with leading zero recovery (8501015800086 ← 501015800086)
- CIPC registration number format recovery (2018123456 07 → 2018/123456/07)
- Afrikaans header recognition (Kliënt Naam → Client Name)
- Bilingual UI text where appropriate for firm staff names

---

## Color System

### Brand & Actions
- **Primary teal**: #2BBCBC — buttons, active states, progress indicators, navigation highlights
- **Navy text**: #2D3748 — headings, body text, labels
- **White**: backgrounds for cards, modals, input fields

### Status Indicators
- **Success green**: #48BB78 — resolved conflicts, valid data, confirmed actions, "Ready" badges
- **Warning amber**: #ED8936 — medium confidence mappings, validation warnings, attention-needed states
- **Error red**: #F56565 — low confidence mappings, validation errors, delete actions, blocked exports
- **Info blue**: #3182CE — conflict indicators, unresolved merge sources, secondary information

### Background Colors
- **Page background**: #F7FAFC (off-white)
- **Card/section background**: white
- **Sidebar background**: white with subtle border-right

### Source Badges (Distinct Colors)
- **CIPC**: #3182CE blue
- **SARS**: #48BB78 green
- **Sage**: #2BBCBC teal
- **Xero**: #4299E1 sky blue
- **Excel**: #A0AEC0 gray
- **Employees**: #667EEA indigo
- **Company Info**: #805AD5 purple

### Interactive States
- **Hover**: 5% opacity increase on background
- **Active/Selected**: teal bg or teal text with teal-50 light background
- **Disabled**: gray text (text-gray-400), pointer-events-none
- **Loading**: 50% opacity with spinner overlay

---

## Typography

- **Font**: Poppins (Google Fonts) for all text
- **Monospace**: JetBrains Mono or system monospace for ID numbers, registration numbers, tax numbers

### Font Sizes & Weights
- **H1** (Page titles): 24px, weight 600 (semibold), color navy #2D3748
- **H2** (Section headings): 20px, weight 600, color navy
- **H3** (Subsection headings): 16px, weight 600, color navy
- **Body text**: 14px, weight 400 (regular), color navy
- **Small text/badges**: 12px, weight 500 (medium)
- **Tiny text (helper text)**: 12px, weight 400, color gray-600
- **Breadcrumb labels**: 14px, weight 500
- **Input labels**: 14px, weight 600 (semibold)

### Line Heights
- Headings: 1.2
- Body: 1.6
- Inputs: 1.4

---

## Screen Flow & User Journeys

### Screen 1: Home Page — Sessions List

**URL**: `/`

**Purpose**: Operators see all onboarding sessions, manage them, start new ones.

#### Layout
- Full-width page with sticky header
- Main content area max-width 1280px, centered
- Two-column layout: left stats/filters (280px), right sessions table (remaining width)

#### Header (Sticky)
- Left: "Woza La" logo (color: teal #2BBCBC, font-weight 700) + "Get In Stay In" tagline
- Right: operator avatar (initials in 32px circle, teal bg) + name in navy text

#### Stats Row
Four stat cards below header (horizontal grid):
1. **Total Sessions** — large navy number, label "Sessions", teal accent bar
2. **In Progress** — amber badge count
3. **Exported** — green badge count
4. **Needs Attention** — red badge count

Each card has an icon (lucide-react) on the left, number on right in 24px bold navy, label below in 12px gray.

#### Action Bar
- Left: "All Sessions" heading (24px H1)
- Right: "+ New Session" button (teal bg, white text, rounded-lg, hover state darkens teal by 5%)

#### Filter Row
Below action bar:
- **Search input**: "Search sessions..." placeholder, magnifying glass icon (lucide Search), width fills available space
- **Filter pills**: All | In Progress | Exported | Archived
  - Active pill: teal bg, white text
  - Inactive: transparent bg, navy border (1px), navy text
  - Spacing: 8px between pills

#### Sessions Table
Columns (left to right):
| Firm Name | Status Badge | Clients | Operator | Last Updated | Actions |

**Firm Name column**:
- Font weight 600 (semibold)
- Navy text
- Click-to-open (cursor: pointer)

**Status Badge**:
- Colored dot (6px) + text label
- Importing: amber dot + "Importing" (amber-700 text)
- Reviewing: teal dot + "Reviewing" (teal-700 text)
- Exported: green dot + "Exported" (green-700 text)
- Archived: gray dot + "Archived" (gray-500 text)

**Clients column**: number only, navy text

**Operator column**: operator name in 14px navy

**Last Updated column**: relative time (e.g., "2 hours ago"), gray text

**Actions column**: "•••" menu button (lucide MoreVertical), opens context menu with options:
- Open
- Duplicate (creates new session with same files)
- Archive
- Delete

Row click behavior: click anywhere except actions menu → navigates to `/sessions/[id]`

Row hover state: light gray bg (#F7FAFC becomes lighter gray)

#### New Session Modal
Triggered by "+ New Session" button.

Modal layout:
- Header: "Create New Session" (20px H2)
- Form fields (stacked vertically, 100% width):
  - **Firm Name** (required)
    - Label: "Firm Name"
    - Input: text, placeholder "Rich Accountants Inc"
    - Validation: on input, check for existing sessions with similar name
    - If match found: warning below input "An active session for 'Rich Accountants' already exists (#0042, operated by Simz). Create anyway?" in amber box
    - Error state: red border if field empty on submit
  - **Operator** (required)
    - Label: "Assigned Operator"
    - Select dropdown: populated from hardcoded operator list or config (Simz, David, Jane, etc.)
    - Default: currently logged-in operator
  - **Notes** (optional)
    - Label: "Notes (optional)"
    - Textarea: placeholder "e.g., Data from CIPC portal, manual cleanup needed"
    - 3 rows height, min-height auto-expand
    - Gray helper text: "Visible to other operators"

- Buttons (bottom right):
  - "Cancel" button (white bg, navy border 1px, navy text)
  - "Create Session" button (teal bg, white text) — disabled if Firm Name or Operator not filled

On submit:
1. Create session in Supabase with status `importing`
2. Show loading spinner for 1 second
3. Navigate to `/sessions/[id]` (auto-opens Import step)
4. Show success toast: "Session created: Rich Accountants #0042"

---

### Screen 2: Session Page — Layout & Navigation

**URL**: `/sessions/[id]`

**Purpose**: Core workspace for operators. Three-step pipeline with session context.

#### Top Header (Sticky)
- Left: Woza La logo + tagline (same as home page)
- Right: firm name (bold navy 16px) + session badge (gray text 12px: "Session #0042 · 20 clients") + live presence indicator
  - Presence: green dot + operator name if another operator is editing: "🟢 Simz is editing" (teal text, 12px)
  - If multiple editors: "🔴 2 others are editing" (red text)

#### Breadcrumb Navigation (Below Header)
Three clickable steps showing progress through 3-step pipeline:

```
(✓) Import  ›  (2) Review  ›  (3) Export
```

Each step has:
- **Status icon**: checkmark in circle (completed step), number in circle (active/future step)
- **Label text**: step name
- **Status colors**:
  - Completed: teal circle, teal text (✓)
  - Active: teal circle with white number, bold text
  - Future: gray circle with gray number, gray text

Click behavior:
- Completed steps: navigate back to that step
- Active step: no-op (already there)
- Future steps: navigate forward (no hard gating — operator can skip ahead)

On navigation before confirming gates (e.g., leaving Review before confirming mappings):
- Show modal: "You have unsaved changes. Confirm mappings before continuing?"
- Options: "Save & Continue" (teal), "Discard & Leave" (red), "Cancel" (gray)

#### Sidebar (Left Panel)

Fixed width: 260px
Height: full viewport
Background: white
Border-right: 1px solid #E2E8F0 (gray-200)

**Section A: Step Navigation**
Three nav items:
- **Import** icon: lucide Upload, label "Import"
- **Review** icon: lucide ClipboardList, label "Review"
- **Export** icon: lucide Download, label "Export"

Active item styling:
- Text color: teal #2BBCBC
- Background: teal-50 (#E6FFFC)
- Left border: 3px solid teal
- Padding: 12px left + 12px right

Click: navigate to that step

**Section B: Clients List**
Header: `CLIENTS (N)` — only shown after pipeline has run (status = reviewing or exported)

Search input (above list):
- Placeholder: "Search clients..."
- Magnifying glass icon (lucide Search)
- Real-time filter as operator types
- Clear button (X icon) appears when text entered

Virtual scrolling container (react-window):
- Height: remaining viewport height minus header
- Each client entry:
  - **Client name**: 14px navy, truncated with ellipsis
  - **Validation badge** (right side): color-coded pill
    - Ready: green bg, white text, "✓ Ready"
    - Errors: red bg, white text, "N errors"
    - Warnings: amber bg, white text, "N warnings"
    - Skipped: gray bg, gray text, "Skipped"
  - Hover: light gray bg (#F7FAFC)
  - Click: set `targetClusterId`, navigate to Review step, auto-open that client's editor

---

### Screen 3: Import Step

**URL**: `/sessions/[id]` with step=import

**Purpose**: Upload files, select sources, add staff, run pipeline.

**Main content area** (right of sidebar, max-width 1100px):

#### Source Type Pills Row
Horizontal pill buttons (spacing 8px):
- Sage | Xero | SARS eFiling | CIPC | Excel | Employees | Company Info

Styling:
- Active pill: teal bg (#2BBCBC), white text, 12px semibold
- Inactive: white bg, navy border (1px), navy text
- Rounded: 20px (full pill shape)
- Height: 36px
- Padding: 8px 16px

Behavior:
- Operator must select a source type BEFORE dropping a file
- Only one pill can be active at a time
- Selected pill is "sticky" until operator clicks another

#### Drop Zone
Large drag-and-drop area:
- Border: 2px dashed #B2F5EA (teal-200)
- Border-radius: 16px (rounded-2xl)
- Background: #E6FFFC (teal-50)
- Padding: 40px
- Text-align: center
- Min-height: 200px

Content (centered):
- **Icon**: lucide Upload, 40px, color teal #2BBCBC
- **Primary text**: "Drag files here or click to browse" (16px navy, weight 600)
- **Secondary text**: "Supports .xlsx, .xls, .csv · Max 10MB per file" (12px gray-600)
- **Hidden file input**: accepts multiple files, formats [.xlsx, .xls, .csv]

Hover state:
- Border: 2px solid teal (not dashed)
- Background: slightly darker teal-50

Click behavior: opens native file picker (HTML file input)

#### File Pre-Validation
When file(s) dropped or selected:
1. Check file size — reject if > 10MB
   - Error toast: "File too large (18 MB). Maximum 10 MB per file."
2. Check file format — must be .xlsx, .xls, or .csv
   - Error toast: "Unsupported format. Please upload .xlsx, .xls, or .csv"
3. Check if parseable (SheetJS)
   - If error: amber toast with error message and suggestion to unprotect/repair file
4. Check if has headers (row 1 looks like text, not numbers)
   - If no headers: show prompt modal: "This file doesn't have headers in row 1. Which row contains the headers?"
   - Operator selects row number, pipeline uses that as header row
5. Check if has data rows (at least 1 data row after headers)
   - If empty: red toast "This file has no data rows"
6. Warn if merged cells detected
   - Amber toast: "This file contains merged cells which may cause data to be read incorrectly."

Validation results shown immediately after upload completes:
- Green checkmark icon if passed all checks
- Amber warning icon if soft issues (merged cells)
- Red X icon if hard failure (will be excluded from pipeline)

#### Files Added Section
Below drop zone. Header: `Files Added (N)`.

Each file card:
- **Layout**: white bg, border 1px gray-200, rounded-lg, padding 16px
- **Left icon**: lucide FileSpreadsheet, color gray-400
- **Filename**: 14px semibold navy, left-align
- **Metadata row**: "N rows · M columns · X MB" (12px gray-600)
- **Source badge**: colored pill (e.g., "Sage", "CIPC"), top-right corner
- **Remove button**: X icon (lucide X), appears on hover, right side
  - Confirmation: "Remove sage_export.xlsx? This cannot be undone."
  - Options: "Remove" (red), "Cancel" (gray)

On remove: file deleted from state, re-validate remaining files for mapping

#### Firm Staff Section
Divider line above. Header: `Firm Staff` (16px H3 navy).

Subtitle: "Add partners, managers, and accountants. These populate columns AA–AH in the masterfile." (12px gray-600)

Staff table:
| Name | Role | Email | Actions |

Add staff button (below table): "+ Add staff member" (teal text, cursor pointer)

Each staff row:
- **Name**: text input, placeholder "Thabo Mokoena"
- **Role**: dropdown with options [Partner, Manager, Accountant]
- **Email**: text input, placeholder "thabo@firm.co.za"
- **Remove button**: X icon (hover to show), confirmation before deleting

Empty state (no staff added): "No staff added yet. Click '+ Add staff member' to begin."

#### Run Pipeline Button
Bottom of Import step.

Button text:
- If no files yet: "Process Files & Continue →" (disabled, gray text, disabled-state cursor)
- After files added: "Process Files & Continue →" (teal, full-width)
- If re-running after adding new files: "Re-process with New Files →"

On click:
1. Show full-width progress bar below button
2. Server-side pipeline runs: parse → normalize → match → merge → rules → validate
3. Progress bar updates with stage labels:
   - "Parsing files..." (20%)
   - "Normalizing data..." (40%)
   - "Matching records..." (60%)
   - "Merging conflicts..." (80%)
   - "Validating results..." (100%)
4. On completion: auto-navigate to Review step (if new pipeline), show success toast: "Pipeline complete. 20 clients ready to review."
5. Mapping Confirmation gate appears first

---

### Screen 4: Mapping Confirmation Gate

**URL**: `/sessions/[id]?step=review&gate=mapping`

**Purpose**: Operator confirms source column → DataGrows field mappings.

**Layout**: Full-width panel, replaces review content until confirmed.

#### Header
Title: "Confirm Column Mappings" (24px H1 navy)
Subtitle: "Woza La matched your source columns to DataGrows fields. Review the matches below — especially any flagged as uncertain." (14px gray-600)

#### Mapping Table
Grouped by source file. Each file group has:

**File header bar** (teal-light bg #E6FFFC, padding 12px, border-radius 8px):
- **Source type badge** (e.g., "Sage", teal pill)
- **Dropdown to re-tag source type** (if clerk realizes file was labeled wrong)
  - Options: all source types
  - On change: re-run auto-mapping heuristics for that file's columns
- **File name and stats**: "sage_export.xlsx (52 rows, 18 columns)"
- **"Exclude file" checkbox** (right): greyed-out if checked, columns below become gray-300 text
  - On check: columns removed from mapping, file stays in session (can be re-included)

File header background: red-light (#FEE) if any Low-confidence mappings in this file.

**Mapping rows** (below file header):

| Source Column | → | DataGrows Field (Dropdown) | Confidence | Sample Value |

Each row:
- **Source Column**: column name from uploaded file (e.g., "Company Name"), 14px navy, monospace font
- **Arrow**: "→" (gray text)
- **DataGrows Field**: **always a dropdown** (critical: no read-only mappings). Options: all 86 DataGrows fields grouped by category, plus "— Skip this column —" at bottom
  - Default selection: auto-mapped field (if high/medium confidence) or blank (if low confidence)
  - Dropdown border color reflects confidence: green (high), amber (medium), red (low)
  - Can override any mapping
- **Confidence indicator**: color dot + text label
  - High (green dot): "High" — exact header match
  - Medium (amber dot): "Medium" — partial match, likely correct
  - Low (red dot): "Low" — uncertain, needs review
  - Confidence is visual only (doesn't restrict editing)
- **Sample Value**: first data value from that column (monospace, gray text, truncated)

Row background:
- Normal rows: white
- Low-confidence rows: red-light (#FEE) with red border-left (3px)
- Unmatched rows (at bottom): red-light bg, dropdown pre-labeled "— Assign field —" (red text)

#### Confirmation Button
Bottom right: "Confirm Mappings & Load Data" (teal button, 16px, semibold, 44px height).

If 3+ Low-confidence mappings exist: button text changes to "Confirm Mappings (7 uncertain)" with red badge.

Click behavior:
1. Validate: all columns must have a DataGrows field assigned or marked "Skip"
2. If validation passes: save mappings, set `mappingsConfirmed = true`
3. If any duplicates, navigate to DedupConfirmation gate
4. If no duplicates, navigate to StaffMatching gate (if staff columns found), else go directly to Review

---

### Screen 5: Deduplication Confirmation Gate

**URL**: `/sessions/[id]?step=review&gate=dedup`

**Purpose**: Operator reviews and approves/rejects potential duplicate records.

**Layout**: Full-width panel.

#### Header
Title: "Possible Duplicates Found (3 pairs)" (24px H1 navy)

#### Duplicate Pairs
One pair per section. Each pair displays:

**Match info row**:
- Left name + source badge (e.g., "Van Wyk & Partners" + Sage pill)
- Center: bidirectional arrow or "↔" (gray)
- Right name + source badge (e.g., "Van Wyk Attorneys" + Excel pill)

**Details row**:
- Similarity percentage (e.g., "Similarity: 87%")
- Shared identifiers (e.g., "No shared identifiers" or "Same Registration Nr: 2018/123456/07")

**Action buttons** (side by side):
- "Merge" button (teal bg, white text)
- "Keep Separate" button (white bg, gray border)

**Auto-merged section** (if any primary-key matches exist):
Collapsible section: "Auto-merged records (2 pairs)"
- List of auto-merged pairs with shared identifier shown
- Each can be "Split if incorrect" (click to separate)

#### Bulk Actions
Bottom of panel:
- "Merge All" button (teal)
- "Keep All Separate" button (gray)
- "Confirm All Decisions" button (bottom right) — enabled after all pairs decided

On "Confirm All Decisions":
1. Save dedup decisions
2. Set `dedupConfirmed = true`
3. Proceed to StaffMatching gate (if staff columns found), else to Review

---

### Screen 6: Staff Name Matching Gate

**URL**: `/sessions/[id]?step=review&gate=staff`

**Purpose**: Match staff names found in source data to firm's staff list.

**Layout**: Full-width panel.

#### Header
Title: "Match Staff Names" (24px H1 navy)
Subtitle: "Staff names found in your data — match them to the firm staff list:" (14px gray-600)

#### Matching Table
Each row:

| Data Value | Best Match | Similarity | Actions |

- **Data Value**: name as it appears in source files (e.g., "T. Mokoena"), monospace 12px
- **Best Match**: suggested staff member from firm list (e.g., "Thabo Mokoena") or "(no match found)"
- **Similarity**: percentage (e.g., "92% match") or blank if no match
- **Actions**: 
  - If match: "[✓ Accept]" (teal) + "[✕ Skip]" (gray)
  - If no match: dropdown [Assign ▾] + "[✕ Skip]"

Row styling:
- Match found: white bg
- No match: light amber bg

After operator confirms all staff matches:
1. Save staff matching decisions
2. Set `staffMatched = true`
3. Navigate to Review step (main data table)

---

### Screen 7: Review Step — Main Data Interface

**URL**: `/sessions/[id]?step=review`

**Purpose**: Operator reviews, edits, and resolves all merged client data.

**Layout**: Two-column (sidebar on left, content on right)

#### Summary Cards (Top)
Four stat cards (horizontal grid):
- **Total Clients**: navy badge
- **Ready**: green badge (pass validation)
- **Errors**: red badge (blocked from export)
- **Warnings**: amber badge
- **Skipped**: gray badge

Update live as operator makes edits.

#### Filter Tabs
Below summary cards:
```
All Clients (20)  |  Needs Attention (5)  |  Ready (12)  |  Warnings (3)  |  Skipped (0)
```

Click to filter table. Active tab: teal text + teal bottom border (2px).

#### Missing Data Export Button
Next to summary cards: "📋 Copy Missing Data" button (outline, teal text border).

Click:
1. Generate list of all required fields missing across all clients
2. Show modal with:
   - Preformatted text (selected by default)
   - "Copy to Clipboard" button (teal)
   - "Download .txt" button (teal outline)

Example output:
```
Missing data for Rich Accountants — 19 Apr 2026

Bheki Ngubane (INDIVIDUAL):
  - Year End (required for tax task scheduling)
  - Entity Type (required)

Sarah's Flowers (SOLE PROP):
  - ID/Passport Number (required for Sole Props)

3 clients with missing data. Please provide the above and we'll update the file.
```

#### Client Table
Below filter tabs. Columns:

| ☐ | Client Name | Entity Type | Status | Issues | Sources |

- **Checkbox**: select multiple clients for bulk actions
- **Client Name**: 14px semibold navy, click to expand editor
- **Entity Type**: gray badge (e.g., "PTY LTD")
- **Status**: color dot + text
  - Active: green dot + "Active"
  - Inactive: gray dot + "Inactive"
  - Pending: amber dot + "Pending"
  - Dormant: gray dot + "Dormant"
- **Issues**: badge
  - Ready: green bg, "✓ Ready"
  - Errors: red bg, "2 errors"
  - Warnings: amber bg, "1 warning"
  - Skipped: gray bg, "Skipped"
- **Sources**: small text, gray (e.g., "Sage, SARS, CIPC")

Pagination (if > 50 clients):
- "Showing 1–50 of 200 clients" (12px gray)
- Page controls: < 1 2 3 >

Row hover: light gray bg

Row click: expand inline editor below

#### Bulk Action Bar
Appears when 2+ clients selected. Fixed at bottom of content area.

Layout: white bg, border-t (1px gray-200), shadow-lg, height 56px.

Content (horizontally arranged, padding 12px):
- "N clients selected" (14px navy, left)
- "Set Partner ▾" dropdown
- "Set Manager ▾" dropdown
- "Set Accountant ▾" dropdown
- "Set Status ▾" dropdown
- "Set Entity Type ▾" dropdown
- "Skip All" button (red outline)
- "Unskip All" button (gray outline)
- "✕ Clear" button (gray outline, right)

Dropdown options populated from firm staff, schema enums, or boolean values.

On bulk action:
1. Apply to all selected clients
2. Create individual audit entries for each client
3. Show success toast: "✓ Partner set to Thabo Mokoena for 4 clients"
4. Refresh validation badges on all affected rows
5. Close bulk action bar after action completes

#### Inline Client Editor
Expands below clicked row. Full width, white bg, border-t and border-b (1px gray-200), padding 24px.

Top section: client name as collapsible H3 with close button (X).

Content grouped by field category (9 groups from schema):

**Group 1: Identity**
- Client Name (text input)
- Status (enum dropdown)
- Comment (textarea)
- Entity Type (enum dropdown)
- Year End (date input, dd/mm/yyyy)
- CIPC Annual Return (checkbox/boolean)

Each field has:
- **Label**: 14px semibold navy
- **Input element**: styled based on type
  - Text: 14px input, placeholder gray, border 1px gray-300
  - Select: 14px select, options from schema enum
  - Checkbox: 16px checkbox, label to right
  - Date: date input or date picker (dd/mm/yyyy format)
  - Textarea: 14px, 4 rows, border 1px gray-300
- **Validation indicator**:
  - Error (red border + red error text below): e.g., "Year End is required"
  - Warning (amber border + amber text below): e.g., "Year End conflicts with CIPC data"
- **Conflict indicator**: small blue dot (2px circle) next to label
  - Click: opens conflict popover (see below)
- **Auto-fill tag**: "auto" badge (10px, gray bg, gray text) next to label
  - Hover: tooltip "Auto-filled by rule: PTY LTD requires CIPC Annual Return = true"

On field edit:
1. Detect change
2. Save to `edits` table in real-time (optimistic update on UI)
3. Show small "✓ saved" indicator (gray text, 10px) for 2 seconds
4. Create audit entry

**Conflict Popover** (click conflict dot):
Modal overlay, 300px wide, centered.
```
┌──────────────────────────────┐
│ Source Conflict — Year End   │
│                              │
│ Sage:       March            │
│ SARS:       February          │
│ CIPC:       February ← Winner │
│                              │
│ Rule: CIPC > SARS > Sage     │
│                              │
│ [Override with different value]
└──────────────────────────────┘
```

"Override" link: opens input below popover, pre-focused.
On input change: popover closes, conflict dot changes from blue to green (resolved by operator).

**Audit Log** (collapsible, bottom of editor):
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

Click [Revert]: restores field to previous value, creates new audit entry: "Reverted Year End: February → March (original merged value)"

If reverted field was auto-filled: revert is "sticky" — rules engine won't re-fill on next pipeline run.

**Skip/Menu Button** (top-right of editor):
"•••" (lucide MoreVertical) opens dropdown:
- Skip this client (toggles "Skipped" badge)
- Unskip this client (if already skipped)

#### Editor Close Behavior
Click close button (X) or click outside: editor collapses.
Unsaved changes: auto-saved (optimistic updates), no confirmation needed.

---

### Screen 8: Export Step

**URL**: `/sessions/[id]?step=export`

**Purpose**: Download populated masterfile, track versions, manage blocked clients.

**Layout**: Main content area (right of sidebar).

#### Readiness Cards (Top)
Three stat cards:
- **Ready to export**: green badge, count
- **Blocked (errors)**: red badge, count
- **Skipped**: gray badge, count

#### Readiness Progress Bar
Full-width progress bar:
- Green fill: percentage of non-skipped clients ready
- Label: "15 of 18 clients ready to export (83%)"
- Subtext: "2 clients skipped (intentionally excluded)"

If errors exist: red-tinted bar with red fill, label: "Cannot export: 3 clients have errors"

#### Export Card
White bg, border 1px gray-200, rounded-lg, padding 24px.

Icon: 📊 (or lucide FileSpreadsheet)
Title: "DataGrows Masterfile" (16px semibold navy)
Description: "The import file for DataGrows onboarding. 86 columns · x14 dropdown validations preserved." (12px gray-600)
Metadata: "15 clients · Rich Accountants" (14px navy)

Button: "Download .xlsx" (teal, full-width, 44px height)
- Disabled (gray) if any errors exist
- On click: download file (same name as session, e.g., "rich_accountants_20260419.xlsx")
- Show success toast: "✓ Downloaded rich_accountants_20260419.xlsx"

#### Blocked Clients Panel
If errors exist: red-tinted panel below export card.

Title: "3 clients excluded (errors):" (16px semibold red-700)
List:
```
Bheki Ngubane — Missing Year End, Missing Entity Type
Van Wyk & Partners — Missing Year End
Sarah's Flowers — Missing ID/Passport Number for Sole Prop
```

Button: "← Go back to Review to fix these" (underlined, red text link)
Click: navigate to Review step, scroll to first errored client

#### Export Version History
Below export card. Title: "Export History" (16px H3 navy).

Table:
| Version | Date | Operator | Client Count | Actions |

Example:
```
v2  ·  19 Apr 2026 14:32  ·  Simz   ·  18 clients  ·  [Download]  [Latest]
v1  ·  17 Apr 2026 09:15  ·  David  ·  15 clients  ·  [Download]
```

Latest version: green badge "Latest" on the right.

Clicking [Download] next to old version: downloads that snapshot from Storage.

#### Changed-Since-Export Warning
If edits made after last export:
Amber warning banner (top of Export step):
"⚠ Data changed since last export (4 edits). [Re-export to get the latest]"
Blue link "Re-export" → runs pipeline again, creates new export version.

---

## Navigation & State Patterns

### Session State Management
```typescript
type Step = 'import' | 'review' | 'export';
const [step, setStep] = useState<Step>('import');
const [mappingsConfirmed, setMappingsConfirmed] = useState(false);
const [dedupConfirmed, setDedupConfirmed] = useState(false);
const [staffMatched, setStaffMatched] = useState(false);
const [targetClusterId, setTargetClusterId] = useState<string | null>(null);
```

### Breadcrumb Navigation
- Click completed step: navigate to that step (step is reset to beginning of that phase)
- Click active step: no-op
- Click future step: navigate forward (no hard gating)

### Sidebar Navigation
- Click nav item: navigate to that step
- If unsaved changes: show confirmation modal

### Client Selection (Sidebar)
- Click client in sidebar: set `targetClusterId`, navigate to Review
- ReviewStep consumes `targetClusterId` prop, auto-opens that client's editor
- After stepping away from Review: clear `targetClusterId`

---

## Responsive Behavior

### Desktop (≥1280px)
Full sidebar + main content side-by-side. All features enabled.

### Tablet (768–1279px)
Sidebar collapsible (hamburger menu top-left). Content takes full width when sidebar hidden.

### Mobile (<768px)
Not supported. Woza La is a desktop-only internal tool. Show message: "Woza La requires a desktop browser. Please access on a computer."

---

## Accessibility & Keyboard Support

### Keyboard Navigation
- Tab: cycle through interactive elements
- Enter: activate buttons, confirm modals
- Escape: close modals, popovers, collapse editors
- Arrow keys: navigate between items in lists/selects

### Color & Contrast
- All text meets WCAG AA contrast ratio (navy on white: 10:1)
- Status badges have both color AND icon/text (not color-only)
- Error messages always shown both in red AND with text description

### Screen Reader Support
- All form inputs have associated labels
- Buttons have descriptive text (not just icons)
- Status badges have aria-label attributes (e.g., "3 errors")
- Conflict indicator dots have title attributes: "This field has conflicting source data"

---

## Error & Success Feedback

### Toast Notifications (Bottom-right)
- Success (green): "✓ Operation completed"
- Warning (amber): "⚠ Warning message"
- Error (red): "✕ Error message"
- Info (teal): "ℹ Informational message"
- Auto-dismiss: 4 seconds

### Inline Validation
- Error state: red border + red text below field
- Warning state: amber border + amber text below field
- On focus: clear previous error (user can retry)

### Modal Confirmations
Delete/destructive actions show confirmation:
```
┌──────────────────────────────┐
│ Are you sure?                │
│                              │
│ This action cannot be undone │
│                              │
│ [Cancel]  [Yes, Delete]      │
└──────────────────────────────┘
```

Red button for destructive action.

---

## Implementation Notes

- Use lucide-react for all icons (no custom SVGs)
- Build with shadcn/ui components (Button, Input, Select, Popover, Modal, etc.)
- Tailwind CSS for all styling (no additional CSS libraries)
- Next.js App Router for routing
- Supabase for backend (Realtime, Storage, auth)
- Server-side pipeline API for large firm performance (100+ clients)
- React Window for virtual scrolling in long lists
- Real-time audit logging via `edits` table

This completes the UX/UI flow specification. Every screen, interaction, and visual design is defined here. Build to this spec exactly.
