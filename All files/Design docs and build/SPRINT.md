# Woza La v2 — Sprint Plan

## Sprint Overview

**Sprint Name**: Woza La v2 — Full Build  
**Duration**: 10-15 working days  
**Goal**: Ship a working app that takes multi-source client data (CIPC, SARS, Sage, Xero, Excel) and exports a valid 86-column DataGrows masterfile with full operator control over deduplication, merging, and validation  
**Team**: 1 developer (Claude Code) + 1 product owner (Simz)  
**Definition of Success**: Operator can complete full pipeline (import → review → export) without developer help, producing a valid .xlsx accepted by DataGrows' import tool

---

## Day-by-Day Breakdown

### Days 1-2: Foundation & Infrastructure

**Goal**: Set up database, core validators, and utilities.

- [ ] **Run DB Migration**
  - Execute `supabase/schema.sql` against Supabase project
  - Create all tables: firms, sessions, uploads, raw_records, mapped_records, clusters, cluster_members, edits, firm_staff, export_versions
  - Enable RLS on all tables
  - Create indexes: pg_trgm on sessions.firm_name, B-tree on foreign keys
  - Test connection with sample SELECT

- [ ] **Update `normalizer/index.ts`**
  - Add ID recovery: detect 12-digit SA ID, prepend zero → 13-digit
  - Add CIPC format recovery: "201812345607" → "2018/123456/07"
  - Date normalization: detect dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd → standardize to dd/mm/yyyy
  - Entity type normalization: "Pty", "Pty Ltd", "PTY LIMITED" → "Pty Ltd"
  - Phone cleaning: remove non-digits, prefix +27 if starts with 0
  - Email splitting: "john@example.com; jane@example.com" → array
  - Boolean parsing: "Y", "Yes", "1", "true" → true; "N", "No", "0", "false" → false
  - Month parsing: "January", "Jan", "Januari" (AF) → 1 (diacritic-insensitive)

- [ ] **Create `validator/id-validator.ts`** ✅ DONE in design phase
  - SA ID validation: 13 digits, Luhn checksum, pre-1900 birth dates allowed
  - SA ID recovery: auto-prepend zero if 12 digits
  - CIPC validation: "YYYY/XXXXXX/YY" regex, year 1900-2100
  - Tax number validation: exactly 10 digits
  - VAT number validation: exactly 10 digits, starts with 4
  - Export: functions `validateSaId()`, `validateCipc()`, `validateTaxNumber()`, `validateVatNumber()`

- [ ] **Create `normalizer/file-validator.ts`** ✅ DONE in design phase
  - Encoding detection: UTF-8, Windows-1252 (via chardet or iconv-lite)
  - File size validation: max 50MB
  - File extension validation: .xlsx, .csv, .xls, .xlsm only
  - Row count validation: max 10,000 rows
  - Export: function `validateUpload(file)` → `{valid: boolean, encoding: string, error?: string}`

- [ ] **Update `parsers/mapping-heuristics.ts`** ✅ DONE in design phase
  - 3-pass algorithm: exact → synonym → substring
  - English headers: "Client Name", "Entity Type", "Registration Number", "Tax Number", etc.
  - Afrikaans headers: "Kliënt Naam", "Entiteit Tipe", "Registrasie Nommer", "Belastingnommer", "BTW Nommer", "Belastingjaar"
  - Diacritic stripping: remove accents before matching (normalize('NFD'))
  - Confidence scoring: exact=1.0, synonym=0.9, substring=0.7
  - Output: `{[columnName]: {mapped_to: fieldName, confidence: number}}`

- [ ] **Create `rules/engine.ts`** ✅ DONE in design phase
  - Load rules from `rules/rules.json`
  - Implement rule evaluator: evaluate condition, apply action
  - Sticky reverts: detect manual edits, preserve them on re-run
  - Only fill empty: don't overwrite non-null fields unless rule has `override: true`
  - Batch processing: process all clusters in single pass
  - Export: function `applyRules(clusters, rules)` → modified clusters

- [ ] **Create `merger/conflict-detector.ts`** ✅ DONE in design phase
  - Detect conflicts when incrementally importing new files into existing session
  - Track: old_value, new_value, source conflict
  - Resolve with: keep_manual (preserve operator edit), accept_source (use new source hierarchy)
  - Export: function `detectConflicts(existingCluster, newRecord)` → conflicts array

- [ ] **Create `schema/template-version.ts`** ✅ DONE in design phase
  - Load template file, compute SHA256 hash
  - Store hash in session metadata
  - On export, verify template hash matches — warn if mismatch
  - Export: `getTemplateVersion()` → `{hash: string, version: string, fields: 86}`

- [ ] **Verify Build**
  ```bash
  npm run typecheck
  npm run build
  # Expect 0 errors, 0 warnings
  ```

**Verification**: Open Supabase dashboard, confirm all tables exist and RLS enabled. Run `npm run build` successfully.

---

### Days 3-4: Data Pipeline Core

**Goal**: Implement dedup, merge, validation, export engine.

- [ ] **Update `matcher/index.ts`** ✅ DONE in design phase
  - Implement `dedup(mappedRecords)` function:
    - Group by primary key (Registration Number, ID Number, Trust Deed)
    - Create clusters for exact matches
    - Return: `clusters[], pendingNameMatches[]`
  - Implement name similarity matching (Levenshtein ≥ 0.85)
  - Implement `applyNameMatches(sessionId, approvedMatches, rejectedMatches)` — finalize dedup
  - Do NOT auto-merge name matches — only collect suggestions

- [ ] **Update `merger/index.ts`** (already correct in design)
  - Implement `mergeCluster(cluster)` function:
    - Apply source hierarchy: CIPC > SARS > Sage > Xero > Excel
    - Per field, select first non-empty from highest-priority source
    - Record conflicts in cluster.merged.conflicts
    - Return: merged 86-field record
  - Export: function `mergeAllClusters(clusters)` → updated clusters

- [ ] **Update `validator/index.ts`** ✅ DONE in design phase
  - Implement validation levels:
    - Hard-required: Name, Entity Type, Relationship
    - Conditional: Company must have (Registration Number OR Tax Number)
    - Format: SA ID Luhn, CIPC regex, Tax/VAT digits
  - Per cluster, return: `{errors: [], warnings: [], valid: boolean}`
  - Export: function `validateCluster(cluster)` → validation result

- [ ] **Update `exporter/index.ts`** ✅ DONE in design phase
  - Implement ExcelJS export:
    - Load `/public/datagrows_canonical_template.xlsx`
    - Write cluster data to rows 3+
    - Preserve x14 dropdown validations
    - Filter archived records
    - Return: buffer (or stream)
  - Export: async function `exportToExcel(clusters, template)` → Uint8Array

- [ ] **Update `api/export/[sessionId]/route.ts`** ✅ DONE in design phase
  - GET endpoint: generate and stream .xlsx
  - Verify session ownership
  - Call exporter, create export_versions record
  - Stream download with correct headers
  - Support `?version=N` query to fetch prior export

- [ ] **Create `api/pipeline/[sessionId]/route.ts`** (optional, for future SSE)
  - POST endpoint for server-side pipeline processing
  - Accept stage param: normalize, dedup, merge, validate
  - Return SSE stream with progress events
  - Stub for now; can be enhanced post-launch

- [ ] **Full Pipeline Test**
  - Create test fixture: 3 CSV files (Sage, CIPC, SARS)
  - Upload → auto-map → dedup → merge → validate → export
  - Verify output .xlsx has all records, correct field order
  - Check that dropdowns are preserved

**Verification**: Run pipeline integration test. Export should be valid .xlsx with 86 columns.

---

### Days 5-7: UI Components

**Goal**: Build all React components for 3-step pipeline.

- [ ] **Create `ImportStep.tsx`**
  - Drag-and-drop file upload with visual feedback
  - Auto-detect source (hint from filename: "Sage", "CIPC", etc.)
  - Source pills: [CIPC] [SARS] [Sage] [Xero] [Excel] [Employees]
  - File cards showing: name, rows, detected encoding, detected columns
  - "Staff Names" textarea input for fuzzy matching names
  - [Upload Complete] button → call backend, create uploads table entries

- [ ] **Create `MappingConfirmation.tsx`**
  - Display per-file: detected columns, auto-mapped field, confidence %
  - Dropdown selector for each column: [86 field options] | [Skip]
  - Edit mapping in place with visual feedback
  - [Confirm Mappings] button → verify no unmapped columns, set mappings_confirmed=true

- [ ] **Create `DedupConfirmation.tsx`** ✅ DONE in design phase
  - Display all name-based match suggestions (Levenshtein ≥ 0.85)
  - Per suggestion: show both names, sources, [Merge] [Keep Separate] [Invalid] buttons
  - On action, update UI, call applyNameMatches
  - [Confirm Deduplication] button → set dedup_confirmed=true

- [ ] **Create `StaffMatching.tsx`**
  - Fuzzy match input staff names against firm_staff list
  - Show: input name, matched name(s), confidence %
  - Can confirm matches or skip
  - Used in ReviewStep for "Authorised User" name matching

- [ ] **Update `ReviewStep.tsx`**
  - Display all 86 fields (grouped by category) for all clusters (virtual scroll)
  - Conflict indicators: dot on field if source conflict detected
  - Click conflict dot → show `ConflictPopover`
  - Inline editing: click field → input/select → validate → save
  - Bulk actions: multi-select clusters, set field value for all
  - Skip clusters: toggle archived=true with reason (optional)
  - Auto-fill tags: fields with auto-filled values show "auto" tag, rules-filled show "rules" tag

- [ ] **Create `BulkActionBar.tsx`**
  - Multi-select checkbox for each cluster (sticky on scroll)
  - Action buttons: [Set Field] [Archive] [Unarchive] [Validate]
  - On [Set Field], modal opens → select field + value → apply to all selected
  - Toast feedback: "Updated 12 records"

- [ ] **Create `ConflictPopover.tsx`**
  - Modal or popover showing: field name, all source values (CIPC, SARS, Sage, etc.)
  - Current merged value (chosen by hierarchy)
  - Radio buttons or dropdown to override → select different source value
  - [Apply] button saves edit, increments conflicts resolved counter

- [ ] **Create `SidebarNav.tsx`**
  - Breadcrumb: Import → Mapping → Dedup → Review → Export
  - Step indicators: current step highlighted, previous steps checked
  - Buttons for each step (disabled if dependencies not met)
  - Back/Next navigation

- [ ] **Create `SidebarClients.tsx`**
  - List of all clusters with virtual scroll (500+ items)
  - Per cluster: name, entity type, source badges (CIPC, SARS, Sage)
  - Status indicator: validation errors (red), warnings (yellow), valid (green)
  - Filter: by status, by source, search by name
  - Click cluster → scroll ReviewStep to that cluster

- [ ] **Create `DropZone.tsx`**
  - Reusable drag-and-drop component
  - Visual feedback: highlight on drag-over
  - Show: "Drop files here or click to browse"
  - Accept: .xlsx, .csv, .xls, .xlsm
  - Return: file + source type (from ImportStep context)

**Verification**: All components render without errors. Cypress/Playwright e2e test for basic flow: upload → map → export.

---

### Days 8-9: Pages & Full Integration

**Goal**: Wire all components together, test full flow.

- [ ] **Rewrite `sessions/[id]/page.tsx`**
  - Main layout: sidebar (nav + clients) + main content (step component)
  - Fetch session data on load
  - Render current step based on session.status
  - Session header: firm name, operator, last updated
  - Session locking: subscribe to Realtime presence, show "X is editing" warning
  - Handle navigation: step buttons update session status
  - Error boundary + error toast for failed API calls

- [ ] **Update Home Page (`page.tsx`)**
  - Sessions list: firm name, status, operator, last updated
  - Status badges: [Importing] [Reviewing] [Exported] [Archived]
  - [New Session] button → modal to create firm + session
  - Filter: by firm, by status
  - Click session → navigate to /sessions/[id]

- [ ] **Create Session Modal**
  - Form: firm name (autocomplete, search existing or create new), operator (select current user)
  - [Create] button → POST /api/sessions → redirect to new session

- [ ] **Update `ExportStep.tsx`**
  - Export button: POST /api/export/[sessionId] → download .xlsx
  - Version history table: version #, exported by, exported at, client count, [Download] button
  - Warning: if clusters have unsaved edits or validation errors, warn before export
  - Success toast: "Exported 450 clients"

- [ ] **Session Locking (Realtime)**
  - On session page load: subscribe to Realtime presence for session_id
  - Broadcast current user: `{user: operator, timestamp: now}`
  - Show warning if another operator is editing
  - Release lock on page unload or 30-min timeout

- [ ] **Wire Components**
  - ImportStep → upload files → create uploads, raw_records → navigate to Mapping
  - MappingConfirmation → confirm mappings → create mapped_records, clusters → navigate to Dedup
  - DedupConfirmation → apply dedup → finalize clusters → navigate to Review
  - ReviewStep → manual edits → create edits records → navigate to Export
  - ExportStep → export → download .xlsx

- [ ] **Error Handling**
  - API errors: show toast with error message, log to console
  - Validation errors: show inline errors on ReviewStep
  - File upload errors: encoding, size, format → show friendly message
  - Prevent navigation away if unsaved edits (beforeunload)

- [ ] **End-to-End Flow Test**
  - Upload 3 files (Sage, CIPC, SARS) → map → dedup → review (check conflicts display) → export
  - Verify: .xlsx has correct columns, row order, dropdown validations preserved

**Verification**: Full flow test passes. Operator can start new session, complete pipeline, download .xlsx.

---

### Days 10-11: Testing & Quality Assurance

**Goal**: Comprehensive unit + integration testing, edge cases.

- [ ] **Unit Tests**
  - `normalizer/index.ts`: dates (dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd), entity types, registration numbers, emails, phones, booleans, months
  - `validator/id-validator.ts`: SA ID (valid 13-digit, invalid checksum, 12-digit recovery, pre-1900), CIPC (valid, format recovery, invalid year), Tax (10 digits), VAT (10 digits starting with 4)
  - `normalizer/file-validator.ts`: encoding detection (UTF-8, Windows-1252), file size limits, extension validation
  - `parsers/mapping-heuristics.ts`: exact match, synonym match, substring match, Afrikaans headers, diacritic stripping
  - `matcher/index.ts`: primary key matching, name similarity (≥0.85), pending matches not auto-merged
  - `merger/index.ts`: hierarchy winners, conflict recording
  - `validator/index.ts`: hard-required checks, conditional checks, format validation
  - `exporter/index.ts`: 86-field assertion, column order, archived filtering

- [ ] **Integration Tests**
  - Full pipeline: 3 source files (Sage CSV, CIPC CSV, SARS Excel) → parse → map → dedup → merge → validate → export → verify .xlsx
  - Verify output: correct columns, correct row order, correct merged values (source hierarchy)
  - Edge case: duplicate registration number → auto-merged into 1 cluster
  - Edge case: name-based match suggestion → operator confirms → merged

- [ ] **Edge Case Tests**
  - SA ID: 12-digit "000123456789" → auto-prepend zero → "0000123456789" (13 digits, validate Luhn)
  - SA ID: pre-1900 birth date (1800-01-01) → valid (for very old entities)
  - CIPC: unformatted "201812345607" → formatted "2018/123456/07"
  - CIPC: invalid year "9999/123456/07" → validation error
  - Afrikaans headers: "Kliënt Naam" → matches "Client Name", "Belastingnommer" → matches "Tax Number"
  - Windows-1252 encoding: CSV with accented chars (é, ö, ü) → detect, parse correctly
  - Password-protected Excel file → show error message "Cannot read password-protected files"
  - Empty file or headers-only → show warning, allow skip
  - 500+ client export → ensure dropdown validations preserved, performance acceptable
  - Incremental import: upload file 1 → export v1 → upload file 2 → detect conflicts → preserve manual edits

- [ ] **Performance Tests**
  - Parse 10MB CSV in browser (SheetJS) → should complete in <5 sec
  - Export 500 clients server-side (ExcelJS) → should complete in <10 sec
  - Virtual scrolling: 500+ clients in sidebar → smooth scrolling, <16ms per frame
  - Supabase query: fetch 1000+ raw_records → <2 sec

- [ ] **Manual Testing**
  - Real firm data (with consent): 3 files, 50-100 clients → full flow
  - Test with actual Sage, CIPC, SARS file formats (if available)
  - Verify merged output looks correct to accountant/operator

**Verification**: All tests passing. `npm run test` shows 0 failures. Manual test completes successfully.

---

### Days 12-13: QA, Polish & Launch

**Goal**: Final sign-off, deployment, launch.

- [ ] **Operator UAT**
  - Simz (product owner) tests full flow with test data
  - Sign-off: "Ready to launch"
  - Document any last-minute issues, fix critical ones

- [ ] **Export Validation**
  - Export sample dataset from Woza La
  - Import into DataGrows system
  - Verify: all 86 columns present, no import errors, data integrity maintained

- [ ] **Responsive CSS / Polish**
  - Test on tablet (iPad 768px) and mobile (iPhone 375px)
  - Fix layout issues in sidebar, buttons, modals
  - Ensure dropdowns and virtual scroll work on mobile (or disable for mobile)
  - Dark mode (optional, default to light)

- [ ] **Supabase Setup (Production)**
  - Run migration on Supabase production project
  - Create RLS policies for auth users
  - Create service role for export operations
  - Test connection from Vercel

- [ ] **Vercel Deployment**
  - Connect GitHub repo to Vercel
  - Set environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
  - Deploy to preview, then production
  - Test deployed app: upload → export → download

- [ ] **Supabase Storage Bucket** (if needed for large exports)
  - Create bucket: "woza-la-exports" (private)
  - Set RLS policy: users can only download their own exports
  - Update exporter to write to bucket, generate signed URL

- [ ] **Error Monitoring** (optional, Sentry)
  - Set up Sentry project
  - Add SDK to Next.js app
  - Monitor errors in production

- [ ] **Backup Strategy**
  - Confirm Supabase automated backups are enabled
  - Document recovery procedure

- [ ] **Training / Documentation for Clerks**
  - 1-page quick start: how to upload files, map columns, review dedup, export
  - Screenshot walkthroughs
  - FAQ: common errors and solutions

- [ ] **Go-Live**
  - Announce to firm clerks
  - Share app URL, login credentials
  - Monitor first few sessions for issues
  - Be on standby for support

**Verification**: Deployed app works end-to-end. Exports are valid. Operator UAT signed off.

---

## Items Already Completed (Design Phase)

These are marked with ✅ because they were completed during the design/architecture phase:

- ✅ `validator/id-validator.ts` — SA ID Luhn, CIPC regex, Tax/VAT validation
- ✅ `normalizer/file-validator.ts` — Encoding detection, file size/extension validation
- ✅ `parsers/mapping-heuristics.ts` — 3-pass mapping with Afrikaans support
- ✅ `rules/engine.ts` — Declarative rule engine with sticky reverts
- ✅ `merger/conflict-detector.ts` — Conflict detection for incremental imports
- ✅ `schema/template-version.ts` — Template versioning
- ✅ `matcher/index.ts` — Dedup confirmation gate (partially; refinements in Day 3)
- ✅ `validator/index.ts` — SA-specific validation (partially; refinements in Day 3)
- ✅ `exporter/index.ts` — ExcelJS export with assertions (partially; refinements in Day 3)
- ✅ `DedupConfirmation.tsx` — Dedup review component
- ✅ `api/export/[sessionId]/route.ts` — Export API with versioning

For these items, Days 1-4 focus on refinement, integration, and verification rather than full from-scratch implementation.

---

## Definition of Done

A feature is done when:

1. **Code Quality**
   - `tsc --noEmit` passes with 0 errors, 0 warnings
   - `npm run build` succeeds
   - Code follows TypeScript strict mode (no `any` types)
   - Comments explain complex logic

2. **Testing**
   - Unit tests written and passing (if applicable)
   - Integration test covers happy path
   - Edge cases tested (SA ID, CIPC, Afrikaans, etc.)

3. **Functionality**
   - Feature works as specified in TECHNICAL_ARCHITECTURE.md
   - Error handling is robust (try-catch, validation, user feedback)
   - Performance is acceptable (parsing <5s, export <10s)

4. **UI/UX**
   - Component renders without console errors
   - Responsive on desktop, tablet, mobile
   - Loading states, error toasts, success feedback
   - Keyboard navigation (tab, enter, escape)

5. **Data Integrity**
   - All data persisted to Supabase correctly
   - RLS policies enforced
   - Audit trail (edits table) complete
   - No data loss on pipeline stages

6. **Documentation**
   - Code comments for complex functions
   - API routes documented in TECHNICAL_ARCHITECTURE.md
   - Test cases documented in TESTING_AND_LAUNCH.md

---

## Risk Mitigations

| Risk | Mitigation |
|------|---|
| Encoding detection fails on unusual files | Test with real Sage/CIPC/SARS files early (Day 2); fallback to UTF-8 |
| SA ID Luhn validation too strict (pre-1900 dates) | Allow IDs with birth dates 1800-2100; document limits |
| Name matching (Levenshtein) causes false positives | Threshold 0.85 empirically chosen; manual review gate catches errors |
| ExcelJS doesn't preserve x14 dropdowns | Test template file immediately (Day 3); if needed, post-process XML |
| Session locking prevents legitimate edits | Lock expires after 30 min; operator can force unlock if needed |
| Performance degrades with 500+ clients | Virtual scroll for sidebar; server-side validation; profile/optimize if needed |
| Vercel cold start delays export | Use streaming response; test with real data |

---

## Communication Cadence

- **Daily Standup**: 15 min, async Slack updates (progress, blockers)
- **Weekly Sync**: 30 min, discuss sprint progress, adjust plan if needed
- **UAT**: Dedicated session near end of sprint with product owner

---

## Sprint Success Criteria

- [ ] All 20 failure modes addressed (from design doc)
- [ ] Operator can complete full flow without developer help
- [ ] Export produces valid .xlsx accepted by DataGrows
- [ ] `tsc --noEmit && npm run build` pass with 0 errors
- [ ] 90%+ test coverage for critical modules (normalizer, validator, exporter)
- [ ] Deployed to Vercel and tested in production
- [ ] Operator UAT signed off

---

## Post-Sprint Roadmap

After v2 launch, consider:

1. **SSE Progress Updates**: Implement `api/pipeline/[sessionId]/route.ts` for real-time progress bars on long operations
2. **Batch Import**: Allow uploading ZIP file with multiple source files, auto-process all
3. **Template Management**: UI to upload custom templates, versioning with checksum validation
4. **Audit Reports**: Download full edit history (who changed what, when)
5. **Scheduled Exports**: Set up recurring exports on a schedule (weekly, monthly)
6. **API Integration**: Expose Woza La as API for DataGrows internal tools

