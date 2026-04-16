# Claude Code Prompt — Woza La

Paste everything below this line into Claude Code with the `woza-la/` folder open.

---

You are picking up a working Next.js 15 + Supabase internal tool called **Woza La — Get In Stay In**. The app is already building and running. Read `README.md` first, then `src/lib/schema/datagrows.ts` — that file is the source of truth for the 86 canonical DataGrows fields and everything else flows from it.

**Context in one paragraph:** Woza La is DataGrows' internal onboarding tool. Our customers are accounting firms (like "Rich Accountants") who have each of their end-clients' data scattered across Sage, Xero, SARS eFiling, CIPC and random internal Excel files. The tool ingests all those files, normalizes them, deduplicates across sources using a two-pass matcher (primary key → name bridge → archive), merges each cluster using a per-field source-of-truth hierarchy, lets a DataGrows clerk review and edit every field, logs every edit for audit, then exports a populated `.xlsx` that matches the DataGrows import template byte-for-byte (all x14 dropdowns intact). Internal use, no auth, single Supabase project.

**Current state — everything is built and running:**

- Supabase project created, `schema.sql` run, `uploads` bucket created, `.env.local` filled, `npm run dev` works.
- 6-tab pipeline: Upload → Staff → Map Columns → Review → Audit Log → Export.
- Full 86-field grouped editor in ReviewStep with enum dropdowns, boolean toggles, and conflict display.
- Firm staff management UI (StaffStep) for columns AA–AH.
- Audit log UI (AuditStep) showing timestamped edit history with old → new values.
- Sessions list page with Operator column and color-coded status badges for all 5 statuses (uploading, mapping, reviewing, exported, archived).
- Session notes field (auto-saves on blur) for operator handoff context.
- Server-side export via ExcelJS that preserves all x14 data validations, dropdowns, and template structure.

**What to do when I give you a task:**

1. Read the relevant files before changing anything. The codebase is small (~24 files) but tightly coupled — `datagrows.ts` schema drives the normalizer, rules engine, matcher, merger, validator, exporter, and ReviewStep editor.
2. After any change, run `npm run typecheck && npm run lint && npm run build` and paste me the result.
3. If you need to understand the field hierarchy, read `src/lib/schema/sources.ts` (`FIELD_PRIORITY`).
4. If a merge feels wrong, check the source-of-truth hierarchy before touching the merger.

**Rules while you work:**

- Do NOT change the shape of `ClientRecord` or the order of `DATAGROWS_FIELDS` without asking me. The 86-field order mirrors columns A–CH in the DataGrows template exactly.
- Do NOT regenerate `public/datagrows_canonical_template.xlsx` with openpyxl or any Python xlsx library — it strips the x14 data validations. If you need to regenerate it, do it via zip-level XML editing of the source template.
- The source-of-truth hierarchy lives in `src/lib/schema/sources.ts` (`FIELD_PRIORITY`). If a merge feels wrong, check there first.
- The rules engine is declarative JSON (`src/lib/rules/rules.json`) — prefer adding a rule over adding code.
- The exporter (`src/lib/exporter/index.ts`) must only write cell values — never add/delete rows or touch `extLst` XML. That's how we preserve the x14 dropdowns.
- Supabase schema changes: always give me the migration SQL to run manually. Don't assume I have Supabase CLI set up.
- Before you finish each task, run `npm run typecheck && npm run lint && npm run build` and paste me the summary.

**Key files to know:**

| File | What it does |
|------|-------------|
| `src/lib/schema/datagrows.ts` | 86-field definitions, enums, field groups, `ClientRecord` type |
| `src/lib/schema/sources.ts` | Per-field source-of-truth hierarchy (`FIELD_PRIORITY`) |
| `src/lib/rules/rules.json` | Declarative services rules (when/set) |
| `src/lib/rules/engine.ts` | Rule evaluator — never overwrites existing values |
| `src/lib/normalizer/index.ts` | Per-field normalization (dates, entity types, reg numbers, etc.) |
| `src/lib/matcher/index.ts` | Two-pass dedup (primary key → name bridge → archive) |
| `src/lib/merger/index.ts` | Hierarchy-driven field merge with conflict tracking |
| `src/lib/validator/index.ts` | Required/format/conditional validation |
| `src/lib/exporter/index.ts` | ExcelJS template populator (server-only) |
| `src/app/sessions/[id]/page.tsx` | 6-tab stepper with session notes |
| `src/components/steps/ReviewStep.tsx` | Full 86-field grouped editor |
| `src/components/steps/StaffStep.tsx` | Firm staff CRUD |
| `src/components/steps/AuditStep.tsx` | Edit history viewer |
| `supabase/schema.sql` | Full DB schema (firms, sessions, uploads, raw_records, clusters, edits, firm_staff) |

**Start by reading `README.md`, confirming the build passes, and telling me what you see. Then wait for my instructions.**
