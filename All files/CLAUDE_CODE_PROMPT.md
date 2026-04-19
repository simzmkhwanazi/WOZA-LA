# Claude Code Prompt — Woza La

Paste everything below this line into Claude Code with the `woza-la/` folder open.

---

You are picking up a working Next.js 15 + Supabase internal tool called **Woza La — Get In Stay In**. The app is already building and running.

**Before you do anything else, read these three files in this order:**

1. `datagrows_canonical_template_v1_reference.md` — this is THE GOAL. This markdown is a column-by-column extract of the actual DataGrows Excel import template (`public/datagrows_canonical_template.xlsx`). It shows all 86 columns A–CH with their exact headers and format instructions, plus the TIPS & FORMATS sheet with every valid dropdown value. **The entire purpose of this app is to produce a filled-out version of this template as a downloadable `.xlsx` file.** DataGrows' onboarding system only accepts this exact template — same column order, same headers, same x14 dropdown validations, same hidden sheets. If the export doesn't match this template byte-for-byte (minus the data rows), the import fails.

2. `README.md` — full project overview, setup, pipeline, architecture.

3. `src/lib/schema/datagrows.ts` — the code-level source of truth. Every field in `DATAGROWS_FIELDS` maps 1:1 to a column in the template reference. The `col`, `header`, `key`, `type`, and `enum` values must match what's in `datagrows_canonical_template_v1_reference.md` exactly. If they don't, that's a bug.

**Context in one paragraph:** Woza La is DataGrows' internal onboarding tool. Our customers are accounting firms (like "Rich Accountants") who have each of their end-clients' data scattered across Sage, Xero, SARS eFiling, CIPC and random internal Excel files. A DataGrows clerk uploads all those files into Woza La, maps columns, and the app normalizes, deduplicates (two-pass: primary key → name bridge → archive), merges using a per-field source-of-truth hierarchy, lets the clerk review and edit every field, logs every edit, then exports a populated `.xlsx` built on top of `public/datagrows_canonical_template.xlsx`. That exported file is what gets uploaded to DataGrows to onboard the firm. **If the export is wrong — wrong columns, missing dropdowns, broken x14 validations — the entire onboarding fails.** The template reference file is the contract.

**Current state — everything is built and running:**

- Supabase project created, `schema.sql` run, `uploads` bucket created, `.env.local` filled, `npm run dev` works.
- 6-tab pipeline: Upload → Staff → Map Columns → Review → Audit Log → Export.
- Full 86-field grouped editor in ReviewStep with enum dropdowns, boolean toggles, and conflict display.
- Firm staff management UI (StaffStep) for columns AA–AH.
- Audit log UI (AuditStep) showing timestamped edit history with old → new values.
- Sessions list page with Operator column and color-coded status badges for all 5 statuses (uploading, mapping, reviewing, exported, archived).
- Session notes field (auto-saves on blur) for operator handoff context.
- Server-side export via ExcelJS that preserves all x14 data validations, dropdowns, and template structure.

**The export contract — why the template reference matters:**

The file `public/datagrows_canonical_template.xlsx` is a stripped version of the real DataGrows import file. Row 1 = headers, row 2 = format instructions, row 3+ = where data goes. It also contains hidden sheets (dropdownValues, Months, Accounting Program, VAT Type, Type, etc.) that power x14 data validation dropdowns. The exporter (`src/lib/exporter/index.ts`) loads this template, writes cell values starting at row 3, and streams it back. It must NEVER add/delete rows, touch the `extLst` XML, or modify any sheet other than CLIENT IMPORT. That's how we preserve the dropdowns that DataGrows requires.

When you're working on any part of the pipeline — normalizer, rules engine, merger, validator, or exporter — cross-reference the template reference to make sure:
- Field values match the allowed dropdown values (entity types, statuses, months, accounting programs, VAT types, etc.)
- Date formats are dd/mm/yyyy as the template specifies
- Boolean fields output `true`/`false` (not TRUE/FALSE, Yes/No, or 1/0)
- Enum fields output the exact string from the dropdown (e.g. "PTY LTD" not "Pty Ltd", "CLOSE CORPORATION" not "CC")

**What to do when I give you a task:**

1. Read the relevant files before changing anything. The codebase is small (~24 files) but tightly coupled — `datagrows.ts` schema drives the normalizer, rules engine, matcher, merger, validator, exporter, and ReviewStep editor.
2. When in doubt about what a field should contain, check `datagrows_canonical_template_v1_reference.md` — it has the DataGrows instructions for every column.
3. After any change, run `npm run typecheck && npm run lint && npm run build` and paste me the result.
4. If you need to understand the field hierarchy, read `src/lib/schema/sources.ts` (`FIELD_PRIORITY`).
5. If a merge feels wrong, check the source-of-truth hierarchy before touching the merger.

**Rules while you work:**

- Do NOT change the shape of `ClientRecord` or the order of `DATAGROWS_FIELDS` without asking me. The 86-field order mirrors columns A–CH in the DataGrows template exactly.
- Do NOT regenerate `public/datagrows_canonical_template.xlsx` with openpyxl or any Python xlsx library — it strips the x14 data validations. If you need to regenerate it, do it via zip-level XML editing of the source template.
- The source-of-truth hierarchy lives in `src/lib/schema/sources.ts` (`FIELD_PRIORITY`). If a merge feels wrong, check there first.
- The rules engine is declarative JSON (`src/lib/rules/rules.json`) — prefer adding a rule over adding code.
- The exporter (`src/lib/exporter/index.ts`) must only write cell values into the CLIENT IMPORT sheet — never add/delete rows, never touch `extLst` XML, never modify hidden sheets. That's how we preserve the x14 dropdowns.
- Supabase schema changes: always give me the migration SQL to run manually. Don't assume I have Supabase CLI set up.
- Before you finish each task, run `npm run typecheck && npm run lint && npm run build` and paste me the summary.

**Key files to know:**

| File | What it does |
|------|-------------|
| `datagrows_canonical_template_v1_reference.md` | THE GOAL — column-by-column template spec with all dropdown values |
| `public/datagrows_canonical_template.xlsx` | The actual Excel template the exporter fills (do not modify directly) |
| `src/lib/schema/datagrows.ts` | 86-field definitions, enums, field groups, `ClientRecord` type |
| `src/lib/schema/sources.ts` | Per-field source-of-truth hierarchy (`FIELD_PRIORITY`) |
| `src/lib/rules/rules.json` | Declarative services rules (when/set) |
| `src/lib/rules/engine.ts` | Rule evaluator — never overwrites existing values |
| `src/lib/normalizer/index.ts` | Per-field normalization (dates, entity types, reg numbers, etc.) |
| `src/lib/matcher/index.ts` | Two-pass dedup (primary key → name bridge → archive) |
| `src/lib/merger/index.ts` | Hierarchy-driven field merge with conflict tracking |
| `src/lib/validator/index.ts` | Required/format/conditional validation |
| `src/lib/exporter/index.ts` | ExcelJS template populator (server-only) — fills the template |
| `src/app/sessions/[id]/page.tsx` | 6-tab stepper with session notes |
| `src/components/steps/ReviewStep.tsx` | Full 86-field grouped editor |
| `src/components/steps/StaffStep.tsx` | Firm staff CRUD |
| `src/components/steps/AuditStep.tsx` | Edit history viewer |
| `src/components/steps/ExportStep.tsx` | Export UI — triggers download of filled template |
| `src/app/api/export/[sessionId]/route.ts` | API route that calls exporter and streams .xlsx |
| `supabase/schema.sql` | Full DB schema (firms, sessions, uploads, raw_records, clusters, edits, firm_staff) |

**Start by reading `datagrows_canonical_template_v1_reference.md`, then `README.md`, then confirm the build passes. Tell me what you see. Then wait for my instructions.**
