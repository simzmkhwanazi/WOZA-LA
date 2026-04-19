# Woza La — Get In Stay In

Internal DataGrows onboarding tool. Consolidates end-client data that an accounting firm has scattered across Sage, Xero, SARS eFiling, CIPC, and internal Excel into a single populated DataGrows import template (86 columns, one row per end-client).

## What it does

1. **Upload** — any number of source files per firm, tagged with their source (`sage` / `xero` / `sars` / `cipc` / `excel` / `employees`).
2. **Staff** — manage the firm's staff list (columns AA–AH). Add, edit, remove staff members linked to the firm; staff records populate the corresponding fields during merge.
3. **Map Columns** — map each file's columns onto the 86 canonical DataGrows fields (pre-suggested via heuristics), then run the full pipeline:
   - **Normalize** — dates (dd/mm/yyyy), entity types, statuses, reg numbers, IDs, emails, phones.
   - **Rules** — JSON rules engine (`src/lib/rules/rules.json`) auto-fills services based on entity type, and flags VAT/PAYE/UIF when numbers exist.
   - **Match** — two-pass deduplication:
     - **Pass 1** — primary key (Registration Nr for companies, ID Nr for individuals, Trust Deed Nr for trusts).
     - **Pass 2** — name-bridge (Levenshtein >= 0.85) to rescue orphans.
     - **Archive** — anything still unmatched (no primary key, no name bridge) gets excluded from the DataGrows export and routed to a follow-up report.
   - **Merge** — each cluster merged field-by-field using the source-of-truth hierarchy (CIPC wins for reg/entity; SARS wins for tax numbers; Sage > Xero > Excel for contacts).
4. **Review** — merged clusters with filters (all / errors / warnings / dormant / archived), full 86-field grouped inline editor with enum dropdowns and boolean toggles, conflict highlighting.
5. **Audit Log** — timestamped log of every field edit, showing who changed what, old value, new value.
6. **Export** — download a populated `.xlsx` that matches the DataGrows template byte-for-byte (all x14 dropdowns preserved), plus a separate "archived — needs firm follow-up" report.

## Stack

- Next.js 15 (App Router), TypeScript strict
- Supabase (Postgres + Storage) — no auth for MVP, internal staff only
- Tailwind (teal `#2BBCBC`, navy `#2D3748`, Poppins)
- [xlsx (SheetJS)](https://docs.sheetjs.com/) for client-side parsing
- [ExcelJS](https://github.com/exceljs/exceljs) for server-side export (preserves x14 data validations that openpyxl strips)
- `fastest-levenshtein` for Pass-2 name bridging

## Setup

### 1. Supabase project

1. Create a new Supabase project.
2. Open the SQL editor and run `supabase/schema.sql` end to end.
3. In Storage, create a new bucket named **`uploads`** (private is fine).
4. From Project Settings → API, copy the Project URL, `anon` key, and `service_role` key.

### 2. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The service-role key is only used server-side by `/api/export/[sessionId]` to read clusters past RLS.

### 3. Canonical template

`public/datagrows_canonical_template.xlsx` is the stripped DataGrows import template (rows 1 & 2 kept, everything from row 3 onwards removed via zip-level XML editing so all x14 dropdowns, styles, and hidden dropdown sheets survive). It ships with the repo — do not regenerate from openpyxl, it will strip the extensions.

### 4. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click **New Session**.

## Pipeline (6 tabs)

```
Upload → Staff → Map Columns → Review → Audit Log → Export
```

Each session moves through these steps. The session status on the home page reflects the current phase: `uploading` → `mapping` → `reviewing` → `exported` → `archived`.

## Project layout

```
src/
  app/
    page.tsx                          # sessions list (operator column, 5 status badges)
    sessions/new/page.tsx             # create firm + session
    sessions/[id]/page.tsx            # 6-tab workflow, session notes
    api/export/[sessionId]/route.ts   # server-side xlsx export
  components/steps/
    UploadStep.tsx                    # file upload + raw_records
    StaffStep.tsx                     # firm staff management (AA–AH)
    MappingStep.tsx                   # column mapping + run pipeline
    ReviewStep.tsx                    # full 86-field grouped editor, filters, conflict display
    AuditStep.tsx                     # timestamped edit history
    ExportStep.tsx                    # download DataGrows xlsx + archived report
  lib/
    schema/
      datagrows.ts                    # 86-field canonical definition + field groups
      sources.ts                      # per-field source-of-truth hierarchy
    parsers/
      generic.ts                      # xlsx/csv → rows with detected header
      mapping-heuristics.ts           # source-column → field suggestions
    normalizer/index.ts               # field-by-field normalization
    rules/
      rules.json                      # declarative services rules
      engine.ts                       # when/set evaluator
    matcher/index.ts                  # two-pass dedup
    merger/index.ts                   # hierarchy-driven field merge
    validator/index.ts                # required / format / conditional
    exporter/index.ts                 # ExcelJS template populator
    supabase/client.ts                # browser client
    supabase/server.ts                # server + service-role client
supabase/
  schema.sql                          # run once in Supabase SQL editor
public/
  datagrows_canonical_template.xlsx   # stripped canonical template
```

## Sessions list

The home page (`/`) shows all sessions with: firm name, status badge (color-coded for all 5 statuses — uploading, mapping, reviewing, exported, archived), operator name, and creation date.

## Session notes

Each session has a free-text notes field in the session header. Notes auto-save on blur and persist to the `sessions.notes` column. Use them for operator handoff context — "firm sent incomplete SARS data, following up", etc.

## Review — full 86-field editor

Clicking a row in the Review tab opens the inline editor grouped by logical sections (identity, registration, tax numbers, contacts, addresses, services/compliance, accounting config, staff, etc.). Each field renders the appropriate input: enum fields show dropdowns with the exact DataGrows-allowed values, booleans render as toggles, dates validate dd/mm/yyyy format. Required fields are marked with `*`. Every edit is recorded in the `edits` table for the audit log.

## Audit log

The Audit Log tab shows a chronological list of every field edit made during the Review step: timestamp, operator name, field header, old value → new value, and the cluster (client) it belongs to.

## Rules engine

`src/lib/rules/rules.json` — each rule has a `when` clause (`eq`, `has_value`) and a `set` clause. Rules run in order; existing values are never overwritten. New services defaults can be added without code changes.

## Adding a new source

1. Add the source key to `SourceType` in `src/lib/schema/sources.ts`.
2. Drop the key into `FIELD_PRIORITY` where it should win (usually last).
3. Add a label in `SOURCE_LABELS`.
4. Add the key to `SOURCE_OPTIONS` in `UploadStep.tsx`.
5. If its headers are very different, extend `SYNONYMS` in `src/lib/parsers/mapping-heuristics.ts`.

## Known limitations (v1.1)

- No authentication — internal staff only, assumes trusted network.
- No undo for destructive operations (re-running the pipeline deletes & re-inserts clusters).
- Session status transitions are one-way; no "reset to uploading" button.
