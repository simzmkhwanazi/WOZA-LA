# Woza La v2 — Master Build Instructions

**Purpose**: Step-by-step instructions for Claude Code to transform Woza La v1 into v2 using the documentation in `Design docs/`.

**How to use**: Open this project in Claude Code and say: "Read INSTRUCTIONS.md and execute it phase by phase. After each phase, run `tsc --noEmit` and fix any errors before moving on."

---

## Pre-Flight Checklist

Before writing any code, read these files in order:

1. `CLAUDE.md` — Project rules, conventions, do-not-touch zones
2. `Design docs/PROBLEM_DEFINITION.md` — Why this tool exists, who uses it
3. `Design docs/DESIGN_SPEC.md` — Full UI/UX redesign specification
4. `Design docs/TECHNICAL_ARCHITECTURE.md` — Schema, pipeline, file structure, security model
5. `Design docs/TECH_STACK.md` — Every technology choice with reasoning
6. `Design docs/UX_UI_FLOW.md` — Every screen, interaction, color system
7. `Design docs/SPRINT.md` — Day-by-day implementation plan
8. `Design docs/UNIT_TESTS.md` — Test cases with inputs and expected outputs
9. `Design docs/TESTING_AND_LAUNCH.md` — QA strategy, edge cases, launch checklist
10. `src/lib/schema/datagrows.ts` — The 86-field canonical schema (do not modify field order)

Also review the interactive screen renders in `Design docs/renders/` to understand visual targets.

---

## Phase 1: Database & Infrastructure (Days 1-2)

### 1.1 Run the Supabase Migration

Create or update `supabase/schema.sql` per `TECHNICAL_ARCHITECTURE.md` Section 3 (Database Schema). Tables required:

- `firms` — Firm profile, subscription tier
- `sessions` — One per onboarding job, tracks status/locking
- `uploads` — File metadata per upload
- `raw_records` — Unparsed row data (JSONB)
- `mapped_records` — After column mapping, one row per client
- `clusters` — Dedup clusters linking mapped records
- `cluster_members` — Junction table: cluster <> mapped_record
- `edits` — Audit log of every field-level change
- `firm_staff` — Staff names for fuzzy matching
- `export_versions` — Version tracking for each export

Enable RLS on all tables. Create pg_trgm index on `sessions.firm_name`. Create B-tree indexes on all foreign keys.

Run: `npx supabase db push` or execute the SQL directly.

### 1.2 Verify Existing Utility Modules

These files were built during the design phase. Verify they compile and match the specs:

| File | What It Does | Spec Reference |
|------|-------------|----------------|
| `src/lib/validator/id-validator.ts` | SA ID Luhn, CIPC regex, Tax/VAT validation | TECHNICAL_ARCHITECTURE S5.1 |
| `src/lib/normalizer/file-validator.ts` | Encoding detection, file size/type checks | TECHNICAL_ARCHITECTURE S4.2 |
| `src/lib/rules/engine.ts` | Declarative rules with sticky reverts | TECHNICAL_ARCHITECTURE S6 |
| `src/lib/merger/conflict-detector.ts` | Incremental import conflict detection | TECHNICAL_ARCHITECTURE S5.3 |
| `src/lib/schema/template-version.ts` | Template SHA-256 hash tracking | TECHNICAL_ARCHITECTURE S9 |
| `src/lib/normalizer/index.ts` | ID recovery, CIPC format recovery, diacritics | TECHNICAL_ARCHITECTURE S4.1 |
| `src/lib/parsers/mapping-heuristics.ts` | 3-pass header mapping with Afrikaans synonyms | TECHNICAL_ARCHITECTURE S4.3 |
| `src/lib/matcher/index.ts` | 2-pass dedup with operator confirmation gate | TECHNICAL_ARCHITECTURE S5.2 |
| `src/lib/exporter/index.ts` | Template-based export with 86-field validation | TECHNICAL_ARCHITECTURE S9.2 |

Run `tsc --noEmit` to confirm zero errors.

### 1.3 Install Missing Dependencies

Check `package.json` against `TECH_STACK.md`. Ensure these are installed:

```bash
npm install fastest-levenshtein exceljs
npm install -D @types/node
```

Verify `xlsx` (SheetJS) is already present for client-side parsing.

---

## Phase 2: Core Pipeline — Import Step (Days 3-5)

### 2.1 Build the Upload API

Create `src/app/api/upload/route.ts`:
- Accept multipart file upload
- Call `validateFilePreImport()` from `file-validator.ts`
- Parse with SheetJS (`read()` then `sheet_to_json()`)
- Store raw rows in `raw_records` table
- Return upload ID + row count + detected encoding

Reference: `TECHNICAL_ARCHITECTURE.md` S4.2, `SPRINT.md` Day 3.

### 2.2 Build the Mapping API

Create `src/app/api/map/route.ts`:
- Accept upload ID
- Run `autoMapHeaders()` from `mapping-heuristics.ts` against raw_records
- Return proposed mapping with confidence scores
- Accept operator corrections via PATCH

Reference: `TECHNICAL_ARCHITECTURE.md` S4.3, `SPRINT.md` Day 3.

### 2.3 Build the Import UI Component

Create `src/components/steps/ImportStep.tsx` per `UX_UI_FLOW.md` Section 2 and `Design docs/renders/01-import-step.html`:

- Drag-and-drop zone (teal dashed border, navy text)
- File list with status indicators (parsing > mapped > ready)
- Source type selector per file (CIPC / SARS / Sage / Xero / Excel)
- Column mapping review table with confidence color coding:
  - Green (>=0.9): auto-accepted
  - Amber (0.7-0.89): needs review
  - Red (<0.7): manual mapping required
- "Add More Files" button for incremental imports
- Progress bar during parsing

Design system: Poppins font, teal `#2BBCBC`, navy `#2D3748`. See `DESIGN_SPEC.md` S2 for full palette.

### 2.4 Build the Dedup Confirmation UI

The data layer already exists in `src/lib/matcher/index.ts` (`pendingNameMatches` + `applyNameMatches()`). The UI component skeleton exists at `src/components/steps/DedupConfirmation.tsx`.

Wire it up:
- After mapping, call `matchRecords()` on all mapped records
- Display `pendingNameMatches` in the DedupConfirmation component
- Each pair shows: orphan name, candidate name, similarity score, source info
- Operator picks: "Merge" or "Keep Separate" per pair
- Bulk actions: "Merge All" / "Keep All Separate"
- On confirm, call `applyNameMatches()` with approved/rejected lists

Reference: `DESIGN_SPEC.md` S7.2, `UX_UI_FLOW.md` Section 3.

### 2.5 Checkpoint

```bash
npx tsc --noEmit
```

Test manually: upload a sample .xlsx, verify column mapping proposals appear, verify dedup candidates surface for similar names.

---

## Phase 3: Core Pipeline — Review Step (Days 6-8)

### 3.1 Build the Review Grid

Create `src/components/steps/ReviewStep.tsx` per `UX_UI_FLOW.md` Section 4 and `Design docs/renders/03-review-step.html`:

- Full-width data grid showing all merged records
- Columns: all 86 DataGrows fields (horizontally scrollable)
- Color coding per cell:
  - White: single source, no conflict
  - Light blue: auto-merged from source hierarchy
  - Light yellow: rule-applied value
  - Light red: validation error
- Click any cell to edit inline
- Edit audit: every change logged to `edits` table with old_value, new_value, edited_by, timestamp
- Sticky reverts: manual edits survive rule re-runs (tracked via `rules/engine.ts`)

### 3.2 Build the Validation Panel

Create `src/components/steps/ValidationPanel.tsx`:

- Runs all validators on current records:
  - SA ID validation (Luhn checksum)
  - CIPC format validation
  - Tax/VAT number validation
  - Required field checks (per DataGrows template)
  - Enum value validation (entity_type, province, etc.)
- Display as sidebar or bottom panel:
  - Error count badge (red)
  - Warning count badge (amber)
  - Click error > scroll to and highlight the offending cell
- Block export if any errors remain (warnings are OK)

Reference: `DESIGN_SPEC.md` S8, `UNIT_TESTS.md` (validation test cases).

### 3.3 Build the Rules Engine UI

Create `src/components/steps/RulesPanel.tsx`:

- Show which rules fired and what they changed
- Allow operator to revert individual rule applications
- Reverted rules become "sticky" — won't re-fire on that field
- Display rule source: `rules/rules.json`

### 3.4 Implement Session Locking

Per `TECHNICAL_ARCHITECTURE.md` S7:

- Use Supabase Realtime presence channel per session
- When operator opens a session, acquire lock (set `locked_by`, `locked_at`)
- 5-minute heartbeat keeps lock alive
- If heartbeat stops, lock auto-releases after timeout
- Show banner: "Session locked by [email] since [time]"
- Prevent edits by other users while locked

### 3.5 Checkpoint

```bash
npx tsc --noEmit
```

Test: load imported data into review grid, verify cell editing works, verify validation errors appear, verify session locking.

---

## Phase 4: Core Pipeline — Export Step (Days 9-10)

### 4.1 Wire Up the Export API

The export route exists at `src/app/api/export/[sessionId]/route.ts` but has a placeholder buffer. Wire it to the real exporter:

```typescript
// Replace the placeholder:
// const buffer = Buffer.alloc(0);

// With the real export call:
import { exportToDataGrowsTemplate } from '@/lib/exporter';

const { buffer, rowsWritten } = await exportToDataGrowsTemplate({
  records: clusterRecords,  // Transform clusters to ClientRecord[]
  stripInstructions: true,
});
```

The exporter (`src/lib/exporter/index.ts`) already:
- Loads the canonical template from `public/datagrows_canonical_template.xlsx`
- Validates 86-field structure before writing
- Writes data starting at row 3
- Preserves x14 dropdown validations from the template
- Returns buffer for download

### 4.2 Build the Export UI

Create `src/components/steps/ExportStep.tsx` per `UX_UI_FLOW.md` Section 5 and `Design docs/renders/06-export-step.html`:

- Pre-export summary:
  - Total records to export
  - Records skipped (archived)
  - Validation status (must be error-free)
  - Template version (SHA-256 hash)
- "Export" button (disabled if validation errors exist)
- Download triggered via browser `Blob` + `URL.createObjectURL()`
- Post-export:
  - Version number displayed
  - "Export Again" button (increments version)
  - Export history table (version, date, record count, exported_by)

### 4.3 Template Management

Ensure `public/datagrows_canonical_template.xlsx` exists and contains:
- Row 1: Headers (A1 through CH1)
- Row 2: Instructions/examples (optional, stripped on export)
- Data validation lists on relevant columns (x14 validations)
- No data rows (those get populated by the exporter)

The template hash is tracked by `src/lib/schema/template-version.ts`. If the template changes, warn the operator.

### 4.4 Checkpoint

```bash
npx tsc --noEmit
```

Test: complete full pipeline (import > review > export), open the exported .xlsx in Excel, verify:
- 86 columns A through CH
- Data starts at row 3
- Dropdown validations work on enum columns
- No data corruption or encoding issues

---

## Phase 5: Polish & Edge Cases (Days 11-12)

### 5.1 Afrikaans & Encoding Edge Cases

Test with files that have:
- Windows-1252 encoding (common from SA accounting software)
- Afrikaans column headers with diacritics (e with diaeresis, e with circumflex, etc.)
- Mixed encoding within same file
- BOM markers

The normalizer should handle all of these. If not, fix `file-validator.ts` and `mapping-heuristics.ts`.

Reference: `UNIT_TESTS.md` S3 (encoding test cases).

### 5.2 SA ID Edge Cases

Test with:
- 12-digit IDs (should auto-recover to 13 by prepending 0)
- IDs with invalid Luhn checksums (should flag as error)
- IDs with pre-1900 birth dates (should be allowed — elderly clients exist)
- IDs stored as numbers in Excel (leading zero stripped — should recover)

Reference: `UNIT_TESTS.md` S1 (ID validation test cases).

### 5.3 Incremental Import

Test the conflict detector:
- Import File A, make manual edits
- Import File B with overlapping clients
- Verify conflicts are detected and presented
- Verify manual edits are preserved (sticky)

Reference: `TECHNICAL_ARCHITECTURE.md` S5.3.

### 5.4 Error States & Empty States

Per `UX_UI_FLOW.md` Section 7:
- Empty session (no files uploaded yet)
- Upload fails (wrong file type, too large, corrupt)
- No matches found during dedup
- All records have validation errors
- Export with zero valid records
- Network error during Supabase operations

### 5.5 Responsive Design

The app targets desktop (1280px+) but should not break on tablet. Test at:
- 1920px (full HD)
- 1440px (common laptop)
- 1280px (minimum target)
- 1024px (tablet — graceful degradation OK)

---

## Phase 6: Testing & Launch (Day 13)

### 6.1 Run All Unit Tests

Create test files per `UNIT_TESTS.md`. Priority order:

1. `src/lib/validator/__tests__/id-validator.test.ts` — SA ID, CIPC, Tax, VAT
2. `src/lib/normalizer/__tests__/normalizer.test.ts` — ID recovery, format normalization
3. `src/lib/parsers/__tests__/mapping-heuristics.test.ts` — Header mapping, Afrikaans
4. `src/lib/matcher/__tests__/matcher.test.ts` — Dedup clustering, name bridge
5. `src/lib/exporter/__tests__/exporter.test.ts` — 86-field export, template validation
6. `src/lib/rules/__tests__/engine.test.ts` — Rule application, sticky reverts

Run: `npx vitest run` (or Jest if configured).

### 6.2 Integration Test

Run the full pipeline end-to-end:

```
Upload 3 files (CIPC extract, SARS extract, Sage export)
  > Verify header auto-mapping (including Afrikaans headers)
  > Verify dedup finds overlapping clients
  > Confirm merges in UI
  > Edit 2 fields manually
  > Run rules engine
  > Verify sticky edits survive
  > Export
  > Open .xlsx in Excel
  > Verify dropdowns work
  > Verify data integrity
```

### 6.3 Launch Checklist

Per `TESTING_AND_LAUNCH.md` S8:

- [ ] `tsc --noEmit` passes with zero errors
- [ ] All unit tests pass
- [ ] Full pipeline tested with real SA accounting data
- [ ] Export file opens in Excel without corruption
- [ ] x14 dropdown validations work in exported file
- [ ] Supabase RLS policies tested (unauthorized access blocked)
- [ ] Environment variables set in Vercel
- [ ] Session locking tested with two browser tabs
- [ ] Error states all have user-friendly messages
- [ ] No console errors in production build

---

## Design System Quick Reference

When building any UI component, follow these rules from `DESIGN_SPEC.md`:

| Token | Value |
|-------|-------|
| Primary (teal) | `#2BBCBC` |
| Secondary (navy) | `#2D3748` |
| Background | `#F7FAFC` |
| Surface (cards) | `#FFFFFF` |
| Error | `#E53E3E` |
| Warning | `#ED8936` |
| Success | `#38A169` |
| Font | Poppins (Google Fonts) |
| Border radius | `8px` (cards), `6px` (buttons), `4px` (inputs) |
| Shadow | `0 1px 3px rgba(0,0,0,0.1)` |

Component patterns:
- Buttons: teal background, white text, navy on hover
- Cards: white background, subtle shadow, 8px radius
- Tables: alternating row colors (`#F7FAFC` / `#FFFFFF`)
- Status badges: colored dots + text (not full-width banners)
- Step indicator: 3 circles connected by line, active = teal filled

---

## File Structure Target

After all phases, the project should have this structure:

```
src/
  app/
    api/
      upload/route.ts              <-- Phase 2
      map/route.ts                 <-- Phase 2
      export/[sessionId]/route.ts  <-- EXISTS, wire up in Phase 4
    layout.tsx
    page.tsx                       <-- Main 3-step pipeline UI
  components/
    steps/
      ImportStep.tsx               <-- Phase 2
      MappingStep.tsx              <-- EXISTS, update in Phase 2
      DedupConfirmation.tsx        <-- EXISTS, wire up in Phase 2
      ReviewStep.tsx               <-- Phase 3
      ValidationPanel.tsx          <-- Phase 3
      RulesPanel.tsx               <-- Phase 3
      ExportStep.tsx               <-- Phase 4
    ui/                            <-- Shared components (buttons, cards, etc.)
  lib/
    exporter/index.ts              <-- EXISTS
    matcher/index.ts               <-- EXISTS
    merger/conflict-detector.ts    <-- EXISTS
    normalizer/
      index.ts                     <-- EXISTS
      file-validator.ts            <-- EXISTS
    parsers/mapping-heuristics.ts  <-- EXISTS
    rules/
      engine.ts                    <-- EXISTS
      rules.json                   <-- Create with default rules
    schema/
      datagrows.ts                 <-- EXISTS (DO NOT MODIFY FIELD ORDER)
      sources.ts                   <-- EXISTS
      template-version.ts          <-- EXISTS
    supabase/
      server.ts                    <-- EXISTS
    validator/
      index.ts                     <-- EXISTS
      id-validator.ts              <-- EXISTS
  styles/
    globals.css                    <-- Update with Poppins import + design tokens
```

---

## Do-Not-Touch Rules

These are inviolable. Read `CLAUDE.md` for the full list, but the critical ones:

1. **Never change field order in `src/lib/schema/datagrows.ts`** — The 86-field array maps A through CH. Reordering breaks every export.
2. **Never remove x14 data validations from the template** — DataGrows import rejects files without them.
3. **Never auto-merge dedup candidates without operator confirmation** — The matcher collects `pendingNameMatches`; only `applyNameMatches()` with explicit approved/rejected lists can merge.
4. **Never skip encoding detection** — SA accounting software exports Windows-1252. Skipping detection corrupts Afrikaans characters.
5. **Always preserve manual edits through rule re-runs** — The sticky revert system in `rules/engine.ts` handles this. Do not bypass it.

---

## Quick Start Command

To begin building, run this in Claude Code:

```
Read INSTRUCTIONS.md, CLAUDE.md, and Design docs/TECHNICAL_ARCHITECTURE.md.
Then execute Phase 1. After completing each phase, run tsc --noEmit and
fix any errors before moving to the next phase. Report progress after each phase.
```
