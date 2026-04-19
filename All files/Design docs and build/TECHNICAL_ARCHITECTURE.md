# Woza La v2 — Technical Architecture

## System Overview

Woza La is DataGrows' internal onboarding tool for South African accounting firms. The system implements a three-stage pipeline (Import → Review → Export) that transforms multi-source client data into a standardized 86-column DataGrows masterfile.

### Architecture Layers

The application follows a client-server architecture:

- **Frontend**: Next.js 15 with TypeScript (strict mode), React components, Tailwind CSS, drag-and-drop file handling (SheetJS)
- **Backend**: Supabase (PostgreSQL) with Row Level Security, serverless functions for export processing
- **Data Processing**: In-browser parsing and normalization (SheetJS), server-side validation and export (ExcelJS)

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ WOZA LA V2 DATA PIPELINE                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│ 1. FILE UPLOAD (Client)                                                 │
│    └─> SheetJS parses .xlsx/.csv/.xls                                   │
│    └─> Detect encoding (UTF-8, Windows-1252)                            │
│    └─> Validate file size, extension, row count                         │
│    └─> Store raw data in raw_records table                              │
│                                                                           │
│ 2. HEADER AUTO-MAPPING (Client + Server)                                │
│    └─> 3-pass heuristic: exact → synonym → substring                    │
│    └─> Include English + Afrikaans headers                              │
│    └─> Confidence scoring per column                                    │
│    └─> Store in uploads.column_mapping                                  │
│                                                                           │
│ 3. MAPPING CONFIRMATION GATE (Operator)                                 │
│    └─> Operator reviews all mapped columns                              │
│    └─> Can override auto-mappings per file                              │
│    └─> Must confirm before proceeding                                   │
│    └─> Set sessions.mappings_confirmed = true                           │
│                                                                           │
│ 4. NORMALIZATION (Server)                                               │
│    └─> Date format: dd/mm/yyyy                                          │
│    └─> Entity types: normalize variations                               │
│    └─> SA ID: lead-zero recovery (12-digit → 13)                        │
│    └─> CIPC: format recovery (201812345607 → 2018/123456/07)            │
│    └─> Email: split + validate                                          │
│    └─> Phone: clean formatting                                          │
│    └─> Store in mapped_records table                                    │
│                                                                           │
│ 5. PRIMARY KEY DEDUPLICATION (Server)                                   │
│    └─> Match on Registration Number (companies)                         │
│    └─> Match on ID Number (individuals)                                 │
│    └─> Match on Trust Deed (trusts)                                     │
│    └─> Create clusters with exact key matches                           │
│    └─> Store in clusters table with sources array                       │
│                                                                           │
│ 6. NAME-BASED MATCHING (Server, pending confirmation)                   │
│    └─> Levenshtein similarity ≥ 0.85                                    │
│    └─> Only suggest matches (do NOT auto-merge)                         │
│    └─> Collect in dedup suggestions array                               │
│                                                                           │
│ 7. DEDUPLICATION CONFIRMATION GATE (Operator)                           │
│    └─> Operator reviews all name-based match suggestions                │
│    └─> For each: merge, keep-separate, or mark one as invalid           │
│    └─> Call applyNameMatches with approved/rejected IDs                 │
│    └─> Set sessions.dedup_confirmed = true                              │
│                                                                           │
│ 8. HIERARCHY MERGE (Server)                                             │
│    └─> Per field, apply source priority: CIPC > SARS > Sage > Xero > Excel
│    └─> Record conflicts in cluster data                                 │
│    └─> Track all source values for conflict resolution                  │
│                                                                           │
│ 9. RULES ENGINE (Server)                                                │
│    └─> Apply 11 declarative rules from rules.json                       │
│    └─> Rules are sticky — manual edits revert on re-run                 │
│    └─> Entity-type conditional logic                                    │
│    └─> Only fill empty/matching-value fields                            │
│                                                                           │
│ 10. VALIDATION (Server)                                                 │
│     └─> Hard-required fields: Name, Entity Type, Relationship           │
│     └─> Conditional validation by entity type                           │
│     └─> Format validation: SA ID (Luhn), CIPC (regex), Tax/VAT (digits) │
│     └─> Enum matching (e.g., valid entity types)                        │
│     └─> Warn on missing optional fields                                 │
│                                                                           │
│ 11. OPERATOR REVIEW GATE (Operator)                                     │
│     └─> View all 86 fields across all clients                           │
│     └─> See validation status & conflict indicators                     │
│     └─> Manual edits override rules                                     │
│     └─> Skip clients if needed (archived = true)                        │
│                                                                           │
│ 12. FINAL EXPORT (Server)                                               │
│     └─> Load datagrows_canonical_template.xlsx                          │
│     └─> Write data starting at row 3                                    │
│     └─> Preserve x14 dropdown validations                               │
│     └─> Filter archived records                                         │
│     └─> ExcelJS streams buffer to client                                │
│     └─> Version tracked: export_versions table                          │
│     └─> Return .xlsx file download                                      │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

#### `firms`
```sql
CREATE TABLE firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
```
Stores accounting firm metadata. One firm has many sessions.

#### `sessions`
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  firm_name TEXT NOT NULL,
  operator TEXT NOT NULL,  -- clerk email
  status TEXT DEFAULT 'Importing',  -- Importing | Reviewing | Exported | Archived
  notes TEXT,
  mappings_confirmed BOOLEAN DEFAULT false,
  dedup_confirmed BOOLEAN DEFAULT false,
  staff_matched BOOLEAN DEFAULT false,
  active_editor TEXT,  -- email of operator with lock
  active_editor_since TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_sessions_firm_id ON sessions(firm_id);
CREATE INDEX idx_sessions_firm_name_trgm ON sessions USING GIN(firm_name gin_trgm_ops);
CREATE INDEX idx_sessions_status ON sessions(status);
```
Tracks import session state. `firm_name` has text search index for fuzzy duplicate detection.

#### `uploads`
```sql
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- cipc | sars | sage | xero | excel | employees
  detected_columns TEXT[],  -- array of detected column names
  column_mapping JSONB,  -- { "col_1": "Client Name", "col_2": "Entity Type", ... }
  file_path TEXT,  -- path in Supabase Storage or temp
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_uploads_session_id ON uploads(session_id);
```
Stores uploaded file metadata and column mappings per file.

#### `raw_records`
```sql
CREATE TABLE raw_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data JSONB NOT NULL,  -- raw row as JSON
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_raw_records_upload_id ON raw_records(upload_id);
```
Stores unprocessed rows from uploads.

#### `mapped_records`
```sql
CREATE TABLE mapped_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  data JSONB NOT NULL,  -- normalized, mapped data
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_mapped_records_session_id ON mapped_records(session_id);
CREATE INDEX idx_mapped_records_upload_id ON mapped_records(upload_id);
CREATE INDEX idx_mapped_records_source_type ON mapped_records(source_type);
```
Stores normalized, column-mapped records ready for clustering.

#### `clusters`
```sql
CREATE TABLE clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  primary_key_type TEXT,  -- registration_number | id_number | trust_deed | name
  primary_key_value TEXT,
  merged JSONB NOT NULL,  -- merged record with all 86 fields
  sources TEXT[],  -- array of source types: ['cipc', 'sars', 'sage']
  archived BOOLEAN DEFAULT false,
  archive_reason TEXT,  -- 'invalid', 'duplicate', 'out-of-scope', etc.
  skipped BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_clusters_session_id ON clusters(session_id);
CREATE INDEX idx_clusters_primary_key ON clusters(primary_key_type, primary_key_value);
CREATE INDEX idx_clusters_archived ON clusters(session_id, archived);
```
Groups deduplicated records. One cluster = one final client record.

#### `cluster_members`
```sql
CREATE TABLE cluster_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  mapped_record_id UUID NOT NULL REFERENCES mapped_records(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL
);

CREATE INDEX idx_cluster_members_cluster_id ON cluster_members(cluster_id);
```
Maps individual mapped_records to their clusters. Audit trail for merge decisions.

#### `edits`
```sql
CREATE TABLE edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  edited_by TEXT NOT NULL,  -- clerk email
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_edits_session_id ON edits(session_id);
CREATE INDEX idx_edits_cluster_id ON edits(cluster_id);
```
Tracks manual edits for audit and conflict resolution.

#### `firm_staff`
```sql
CREATE TABLE firm_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,  -- director | partner | admin | etc.
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_firm_staff_firm_id ON firm_staff(firm_id);
```
Stores firm staff list for fuzzy name matching (StaffMatching component).

#### `export_versions`
```sql
CREATE TABLE export_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  exported_by TEXT NOT NULL,  -- clerk email
  exported_at TIMESTAMP DEFAULT now(),
  client_count INTEGER,  -- count of non-archived clusters
  file_path TEXT,  -- path to .xlsx in Storage
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_export_versions_session_id ON export_versions(session_id);
```
Tracks export history and allows version rollback.

### Row Level Security (RLS) Policies

All tables enforce RLS:
- User can only access sessions/data for their firm
- Service role client (for exports) bypasses RLS
- Realtime presence prevents concurrent edits

---

## API Routes

### `GET /api/export/[sessionId]`

Generates and downloads the final .xlsx export.

**Query Parameters:**
- `version` (optional): if provided, retrieve prior export version; else generate new

**Flow:**
1. Verify session ownership via auth
2. Fetch all non-archived clusters
3. Load template from `/public/datagrows_canonical_template.xlsx`
4. Write cluster data to template starting at row 3
5. Preserve x14 dropdown validations
6. Create export_versions record
7. Stream .xlsx buffer as download

**Response:**
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="[firm_name]_[date].xlsx"

[binary .xlsx buffer]
```

### `POST /api/pipeline/[sessionId]`

Server-side pipeline processing with Server-Sent Events (SSE) progress updates (future enhancement).

**Request Body:**
```json
{
  "stage": "normalize" | "dedup" | "merge" | "validate" | "export",
  "uploadIds": ["uuid", "uuid"],  // optional, for selective processing
}
```

**Response (SSE stream):**
```
event: progress
data: {"stage": "normalize", "processed": 100, "total": 500, "percent": 20}

event: progress
data: {"stage": "dedup", "processed": 0, "total": 450, "percent": 0}

event: complete
data: {"stage": "validate", "errors": 12, "warnings": 45}
```

---

## Data Pipeline Architecture

### Stage 1: File Upload (Client-side)

**Component**: `ImportStep.tsx`

1. **Parse**: SheetJS reads file format (.xlsx, .csv, .xls)
2. **Validate**:
   - File size: max 50MB
   - Encoding detection (UTF-8, Windows-1252)
   - Row count: max 10,000
3. **Tag Source**: Operator selects source_type pill (CIPC, SARS, Sage, Xero, Excel, Employees)
4. **Store Raw**:
   ```typescript
   raw_records.insert({
     upload_id: uploadId,
     row_index: i,
     data: row_as_json
   })
   ```

### Stage 2: Auto-Mapping (Server)

**File**: `parsers/mapping-heuristics.ts`

3-pass algorithm with confidence scoring:

**Pass 1: Exact Match**
- Compare input header with 86 field names + aliases
- Case-insensitive, diacritic-insensitive
- Confidence: 1.0

**Pass 2: Synonym Match**
- "Client Name" → "Name", "Client", "Business Name"
- "Tax Number" → "Tax ID", "Tax Ref", "Tax Registration"
- Confidence: 0.9

**Pass 3: Substring Match**
- "Client Name" matches "Name" (contains key term)
- Confidence: 0.7

**Language Support**:
- English headers: "Client Name", "Entity Type", "Tax Number"
- Afrikaans headers: "Kliënt Naam", "Entiteit Tipe", "Belastingnommer"
- Strip diacritics before matching

**Output**:
```json
{
  "Client Name": {"mapped_to": "name", "confidence": 1.0},
  "Entiteit Tipe": {"mapped_to": "entity_type", "confidence": 0.95},
  "Unknown Field 1": {"mapped_to": null, "confidence": 0}
}
```

### Stage 3: Mapping Confirmation Gate

**Component**: `MappingConfirmation.tsx`

- Display per-file: detected headers, auto-mapped field, confidence
- Operator can override any mapping
- Dropdown selector for each column (86 fields or "Skip")
- Cannot proceed until all files confirmed
- Set `sessions.mappings_confirmed = true`

### Stage 4: Normalization (Server)

**File**: `normalizer/index.ts`

Per-field normalization applied to each mapped_record:

| Field | Normalization |
|-------|---|
| Dates | Detect format, convert to dd/mm/yyyy |
| Entity Type | Normalize: "PTY", "Pty Ltd", "PTY LIMITED" → "Pty Ltd" |
| SA ID | 12-digit → prepend zero; validate Luhn |
| CIPC | "201812345607" → "2018/123456/07"; regex validation |
| Email | Split "john.doe@example.com; jane.doe@example.com" → array |
| Phone | Remove non-digits, prepend +27 if starts with 0 |
| Boolean | "Y", "Yes", "1" → true; "N", "No", "0" → false |
| Months | "January" → 1, "Jan" → 1, diacritic-insensitive |
| Tax Number | Validate 10 digits |
| VAT Number | Validate 10 digits starting with 4 |

**Error Handling**: Log warnings for unrecoverable data, store original value in conflict record.

### Stage 5: Primary Key Deduplication (Server)

**File**: `matcher/index.ts` → `dedup()` function

1. **Group by Primary Key**:
   - Company: Registration Number
   - Individual: ID Number
   - Trust: Trust Deed Number
2. **Create Clusters**:
   - All records with same primary key value → one cluster
   - Store sources array: ['cipc', 'sars', 'sage']
3. **Multiple Records per Cluster**:
   - cluster_members table tracks each source record
   - Ready for merge (Stage 8)

**Example**:
```
Input (3 files):
  CIPC: Acme Pty Ltd, RegNr=2018/123456/07
  SARS: Acme Pty Ltd, RegNr=2018/123456/07
  Sage: Acme Pty Ltd, [no RegNr]

Output: 1 cluster with sources=['cipc', 'sars'], merged data ready
```

### Stage 6: Name-Based Matching (Server, Pending)

**File**: `matcher/index.ts` → `findNameMatches()` function

1. **Levenshtein Similarity**: ≥ 0.85 threshold
2. **Only Suggest**: Do NOT auto-merge — collect in dedup_suggestions array
3. **Example**:
   ```
   "Acme Pty Ltd" vs "ACME PTY LIMITED" → 0.95 similarity → suggest match
   "John's Bakery" vs "Johns Bakery" → 0.89 similarity → suggest match
   ```

### Stage 7: Deduplication Confirmation Gate

**Component**: `DedupConfirmation.tsx`

- Display all name-based suggestions
- Per suggestion: [Merge] | [Keep Separate] | [Mark Invalid]
- On merge: create cluster, add both records as cluster_members
- On keep-separate: skip dedup for this pair
- On invalid: archive one record
- Call `applyNameMatches(sessionId, approvedMatches, rejectedMatches)`
- Set `sessions.dedup_confirmed = true`

### Stage 8: Hierarchy Merge (Server)

**File**: `merger/index.ts` → `mergeCluster()` function

**Per-Field Source Priority**:
```
CIPC > SARS > Sage > Xero > Excel
```

**Algorithm**:
1. For each cluster, iterate 86 fields
2. Collect non-empty values from all sources in priority order
3. Choose first non-empty from highest-priority source
4. Record conflicts:
   ```json
   "conflicts": {
     "name": {
       "cipc": "Acme Pty Ltd",
       "sars": "ACME PTY LIMITED",
       "chosen": "Acme Pty Ltd"
     }
   }
   ```
5. Store in `clusters.merged` (JSONB)

**Conflict Tracking**: All source values preserved for later review.

### Stage 9: Rules Engine (Server)

**File**: `rules/engine.ts`

Applies 11 declarative rules from `rules/rules.json`:

```json
[
  {
    "id": "rule_001",
    "name": "Set entity type to CC for dual directors",
    "condition": "data.directors && data.directors.length === 2",
    "action": "set_field",
    "field": "entity_type",
    "value": "CC"
  },
  {
    "id": "rule_002",
    "name": "Flag international records",
    "condition": "data.country_code !== 'ZA'",
    "action": "set_field",
    "field": "is_international",
    "value": true
  }
]
```

**Key Properties**:
- **Sticky Reverts**: If rule was auto-applied but operator manually changed, revert to auto on re-run (unless edit is locked)
- **Conditional Logic**: Only apply if entity_type matches
- **Only Fill Empty**: Don't overwrite non-empty fields unless explicitly flagged
- **Batch Processing**: Apply all rules to all clusters in single pass

### Stage 10: Validation (Server)

**File**: `validator/index.ts`

Three validation levels:

**Hard-Required**:
- Client Name: must not be empty
- Entity Type: must be in enum
- Relationship: must be in enum

**Conditional**:
- Company: must have Registration Number OR Tax Number
- Individual: must have ID Number OR Tax Number
- Trust: must have Trust Deed OR Tax Number

**Format Validation**:
- SA ID: 13 digits, valid Luhn checksum
- CIPC: "YYYY/XXXXXX/YY" regex
- Tax Number: 10 digits
- VAT Number: 10 digits starting with 4
- Email: valid email format
- Phone: contains at least 8 digits

**Output**:
```json
{
  "cluster_id": "uuid",
  "errors": [
    {"field": "name", "message": "Required field missing"}
  ],
  "warnings": [
    {"field": "phone", "message": "Invalid phone format"}
  ],
  "valid": false
}
```

### Stage 11: Operator Review Gate

**Component**: `ReviewStep.tsx`

- Display all 86 fields across all clusters (virtual scroll)
- Conflict indicators (dots) on fields with source conflicts
- Can click conflict dot → `ConflictPopover` shows all source values
- Manual edits override rules + merge decisions
- Skip clients: set `archived = true`
- Bulk actions: multi-select + set field for many records

**Edit Flow**:
```
operator clicks field → opens inline editor OR popover
enters value → triggers validation → stores in edits table
next run will respect manual edit (sticky override)
```

### Stage 12: Export (Server)

**File**: `exporter/index.ts`

1. **Load Template**:
   ```typescript
   const workbook = new ExcelJS.Workbook();
   await workbook.xlsx.readFile('/public/datagrows_canonical_template.xlsx');
   const worksheet = workbook.getWorksheet(1);
   ```

2. **Write Data** (starting row 3):
   ```typescript
   clusters
     .filter(c => !c.archived)
     .forEach((cluster, index) => {
       const row = 3 + index;
       FIELD_NAMES.forEach((field, colIndex) => {
         worksheet.cell(row, colIndex + 1).value = cluster.merged[field];
       });
     });
   ```

3. **Preserve x14 Validations**:
   - ExcelJS maintains dataValidations during write
   - Template has x14 namespace preserved

4. **Stream Download**:
   ```typescript
   const buffer = await workbook.xlsx.writeBuffer();
   response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   response.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
   response.send(buffer);
   ```

5. **Track Version**:
   ```typescript
   export_versions.insert({
     session_id: sessionId,
     version_number: nextVersion,
     exported_by: operator,
     client_count: nonArchivedCount,
     file_path: storagePath
   });
   ```

---

## Security Architecture

### Authentication
- Supabase Auth (Clerk integration)
- JWT tokens in Authorization header
- Session tokens stored in httpOnly cookies

### Authorization
- Row Level Security (RLS) on all tables
- Policy: users can only access data for their firm_id
- Service role client (with anon+service keys) handles export without RLS bypass

### Session Locking
- Supabase Realtime presence: track active_editor
- `active_editor_since` timestamp to detect stale locks
- Lock expires after 30 min of inactivity
- Other operators see warning: "John is editing this session"

### Data Protection
- Sensitive fields (emails, IDs) are treated as PII
- Audit trail: edits table logs all manual changes
- Session timestamps prevent tampering

---

## File Structure

```
woza-la/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Home — sessions list
│   │   ├── layout.tsx                        # Root layout + Supabase client setup
│   │   ├── sessions/
│   │   │   └── [id]/
│   │   │       └── page.tsx                  # Session — 3-step pipeline
│   │   └── api/
│   │       ├── export/
│   │       │   └── [sessionId]/
│   │       │       └── route.ts              # Export API
│   │       └── pipeline/
│   │           └── [sessionId]/
│   │               └── route.ts              # Pipeline API (SSE)
│   ├── components/
│   │   ├── steps/
│   │   │   ├── ImportStep.tsx                # File upload + source tagging
│   │   │   ├── MappingConfirmation.tsx       # Mapping review gate
│   │   │   ├── DedupConfirmation.tsx         # Dedup review gate
│   │   │   ├── StaffMatching.tsx             # Fuzzy match against firm_staff
│   │   │   ├── ReviewStep.tsx                # Full 86-field editor
│   │   │   └── ExportStep.tsx                # Export + version history
│   │   ├── DropZone.tsx                      # Drag-and-drop file upload
│   │   ├── SidebarNav.tsx                    # Step navigation
│   │   ├── SidebarClients.tsx                # Client list (virtual scroll)
│   │   ├── BulkActionBar.tsx                 # Multi-select bulk edit
│   │   └── ConflictPopover.tsx               # Source conflict viewer
│   ├── lib/
│   │   ├── schema/
│   │   │   ├── datagrows.ts                  # 86-field definitions
│   │   │   ├── sources.ts                    # Source hierarchy
│   │   │   └── template-version.ts           # Template hash tracking
│   │   ├── normalizer/
│   │   │   ├── index.ts                      # Field normalization orchestrator
│   │   │   ├── headers.ts                    # EN + AF header mappings
│   │   │   ├── file-validator.ts             # Encoding, size, extension validation
│   │   │   └── id-validator.ts               # SA ID, CIPC, Tax, VAT validation
│   │   ├── parsers/
│   │   │   ├── generic.ts                    # SheetJS file parser
│   │   │   └── mapping-heuristics.ts         # 3-pass auto-mapping
│   │   ├── matcher/
│   │   │   ├── index.ts                      # Dedup + confirmation gate
│   │   │   └── levenshtein.ts                # String similarity (≥0.85)
│   │   ├── merger/
│   │   │   ├── index.ts                      # Hierarchy merge + conflict tracking
│   │   │   └── conflict-detector.ts          # Incremental import changes
│   │   ├── rules/
│   │   │   ├── rules.json                    # Declarative rules
│   │   │   └── engine.ts                     # Rule evaluator + sticky reverts
│   │   ├── validator/
│   │   │   ├── index.ts                      # Validation orchestrator
│   │   │   └── id-validator.ts               # SA-specific validators
│   │   ├── exporter/
│   │   │   └── index.ts                      # ExcelJS template export
│   │   └── supabase/
│   │       ├── client.ts                     # Browser Supabase client
│   │       └── server.ts                     # Server Supabase + service client
│   └── public/
│       └── datagrows_canonical_template.xlsx  # THE template (do NOT modify)
├── supabase/
│   ├── schema.sql                            # Full DB migration
│   └── migrations/
│       └── 20240101000000_initial.sql        # Schema creation
├── tests/
│   ├── unit/
│   │   ├── normalizer.test.ts
│   │   ├── matcher.test.ts
│   │   ├── merger.test.ts
│   │   ├── validator.test.ts
│   │   └── exporter.test.ts
│   └── integration/
│       └── pipeline.test.ts
├── package.json
├── tsconfig.json
├── next.config.js
└── tailwind.config.js
```

---

## Key Design Decisions

1. **Client-side Parsing**: SheetJS handles file parsing in browser for instant feedback, no server upload delays.

2. **Confirmation Gates**: Three gates (mapping, dedup, review) give operators control and visibility into data transformation.

3. **Sticky Rules**: Manual edits are preserved on re-runs; rules only fill empty fields by default.

4. **Source Hierarchy**: CIPC data is most authoritative (government source), Excel data least; conflicts are resolved deterministically.

5. **Cluster Architecture**: Multiple records (different sources) map to one cluster (one final client); audit trail preserved via cluster_members.

6. **Template Preservation**: x14 dropdowns in template are preserved in export; no re-validation needed in DataGrows import.

7. **Fuzzy Matching Threshold**: Levenshtein 0.85 catches ~99% of legitimate duplicates without false positives.

8. **RLS + Service Role**: Service role bypasses RLS only for export (trusted server operation); all reads enforce firm_id.

This architecture balances data quality, operator control, auditability, and performance for a single-developer, high-throughput onboarding system.
