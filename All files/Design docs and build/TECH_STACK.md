# Technology Stack: Woza La v2

## Framework & Language

### Next.js 15 (App Router)
- **Version:** 15.x (latest)
- **Why:** Server components for data processing, API routes for file handling, built-in image optimization
- **Usage:**
  - App Router for file-based routing (`/app/page.tsx`, `/app/sessions/[id]/page.tsx`, `/app/api/...`)
  - Server components by default (faster rendering, can access DB directly)
  - API routes for import/validate/export endpoints
  - Middleware for authentication (clerk already configured)

### TypeScript 5.x
- **Strict mode:** Enabled (no `any` allowed)
- **Why:** Catch type errors at compile time, especially critical for schema validation where column mapping must be exact
- **Usage:**
  - All files `.ts` or `.tsx` (no `.js`)
  - Run `tsc --noEmit` before commits
  - Define types for:
    - `Record` (normalized client data)
    - `MergeDecision` (dedup operator choice)
    - `ValidationError` (field validation result)
    - `Rule` (business rule definition)
    - `AuditEvent` (audit trail entry)

---

## Database: Supabase

### PostgreSQL 15+
- **Why:** Reliable, open-source, excellent JSON support for audit logs and schema flexibility
- **Usage:**
  - Store sessions, users, import history, export versions
  - Row-level security (RLS) for data isolation (each clerk sees only their sessions)
  - JSON columns for audit logs, rule applications, merge histories (queryable)

### Supabase Auth
- **Type:** Email/password for DataGrows clerk accounts
- **Why:** Clerk integration already in v1; stick with existing auth
- **Usage:**
  - Authenticate clerks on login
  - Store user ID in session records (`created_by`, `active_editor_id`)
  - Use `auth.users.id` for audit trail

### Supabase Realtime
- **Why:** Session locking without polling; true presence detection
- **Usage:**
  - Subscribe to `sessions` table changes (row-level)
  - Presence channel: each clerk broadcasts `{ clerk_id, session_id, timestamp }`
  - Heartbeat every 5 minutes (alive check)
  - 10-minute fallback: if heartbeat missing for 10 min, clerk marked offline
  - Next clerk can take over with warning modal

### Supabase Storage
- **Why:** Store exported .xlsx files and DataGrows template
- **Usage:**
  - Bucket: `exports` for versioned .xlsx files (organized by session_id)
  - Bucket: `templates` for DataGrows masterfile template (single file, versioned by SHA-256 hash)
  - URL expires after 24 hours for security

---

## Styling: Tailwind CSS

### Tailwind CSS 3.x
- **Why:** Utility-first CSS, fast iteration, small bundle size
- **Configuration:**
  - Custom colors:
    - `teal: #2BBCBC` (primary accent, CTAs, success states)
    - `navy: #2D3748` (text, backgrounds, contrast)
  - Custom fonts: `font-poppins` (Google Fonts)
  - Dark mode disabled (not needed)

### Poppins Font
- **Via:** Google Fonts (loaded in `_document.tsx` or `layout.tsx`)
- **Why:** Clean, modern sans-serif; widely available; good readability on screens
- **Usage:** All UI text, form inputs, buttons

### Custom Components
- **Buttons:**
  - Primary (teal background, white text): CTA buttons ("Import", "Export", "Merge")
  - Secondary (navy border, navy text): Approval buttons ("Confirm Mapping", "Keep Separate")
  - Destructive (red background): Delete/unmerge actions
- **Status badges:**
  - 🟦 Ready (teal background, white text)
  - 🟥 Errors (red background, white text, error count)
  - 🟨 Warnings (yellow background, navy text, warning count)
  - ⬜ Skipped (gray background, gray text)
- **Toasts:** Bottom-right corner, teal for success, red for errors, navy text

---

## Excel Parsing & Export

### SheetJS (XLSX) — Client-Side Parsing
- **Version:** `xlsx` package (community edition is fine)
- **Why:**
  - Parse files in browser without server load
  - Handles .xlsx, .xls, .csv seamlessly
  - Can handle files up to ~100MB in modern browsers
  - No external API calls
- **Usage:**
  - In `FileUpload.tsx`: `XLSX.readFile()` or `XLSX.read(file, { type: 'array' })`
  - Extract headers: `XLSX.utils.sheet_to_json()`
  - Detect encoding issues (SheetJS defaults to UTF-8, but Windows-1252 files may need recovery)
- **Limitation:** Cannot preserve Excel x14 data validations (the hidden dropdown definitions). That's why ExcelJS is used for export.

```typescript
// Example: Parse uploaded file
import XLSX from 'xlsx';

const file = event.target.files[0];
const data = await file.arrayBuffer();
const workbook = XLSX.read(data, { type: 'array' });
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0];
```

### ExcelJS — Server-Side Export
- **Version:** `exceljs` package
- **Why:**
  - Only library that preserves x14 data validations (Excel's hidden dropdown definitions)
  - Allows loading an existing template and writing data to it
  - More control over cell formatting, formulas, hidden sheets
  - DataGrows template is proprietary and must not be regenerated
- **Usage:**
  - In `api/export.ts`: Load template from Supabase Storage
  - Create new workbook: `const workbook = new ExcelJS.Workbook()`
  - Load template: `await workbook.xlsx.load(templateBuffer)`
  - Write data: `worksheet.addRows(records)` or cell-by-cell writes
  - Copy validations from template to output (they're preserved automatically)
  - Save: `await workbook.xlsx.write(responseStream)`
- **Limitation:** Cannot read template structure from source code (template is binary file). Must download from Supabase Storage.

```typescript
// Example: Export with ExcelJS
import ExcelJS from 'exceljs';
import { supabase } from '@/lib/supabase';

const templateBuffer = await supabase.storage
  .from('templates')
  .download('datagrows_masterfile.xlsx');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(templateBuffer);

const worksheet = workbook.getWorksheet(1);
records.forEach((record, idx) => {
  const row = worksheet.getRow(idx + 2); // Row 1 is headers
  row.values = [record.company_registration_number, record.company_name, ...];
});

await workbook.xlsx.write(response);
```

---

## Data Matching & Deduplication

### fastest-levenshtein
- **Why:** Fast string similarity matching (compiled C++ bindings, much faster than JS implementations)
- **Usage:**
  - In `lib/matchers/dedup.ts`: Compare client names
  - Threshold: 0.85 (match if similarity >= 85%)
  - Example: "ABC (Pty) Ltd" vs "ABC Pty Ltd" → 95% match
  - Operator reviews matches before merging (not automatic)

```typescript
// Example: Find duplicate candidates
import { levenshteinDistance } from 'fastest-levenshtein';

function findDuplicates(records) {
  const candidates = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const dist = levenshteinDistance(
        records[i].client_name.toLowerCase(),
        records[j].client_name.toLowerCase()
      );
      const maxLen = Math.max(
        records[i].client_name.length,
        records[j].client_name.length
      );
      const similarity = 1 - (dist / maxLen);
      
      if (similarity >= 0.85) {
        candidates.push({
          record_a: i,
          record_b: j,
          similarity: similarity * 100,
        });
      }
    }
  }
  return candidates;
}
```

---

## Virtual Scrolling

### react-window
- **Version:** Latest
- **Why:** Handle lists of 200-500+ records without performance degradation
- **Usage:**
  - In `RecordTable.tsx`: Use `FixedSizeList` or `VariableSizeList`
  - Only renders visible rows (huge performance boost for large lists)
  - Support for sorting, filtering while maintaining virtual scroll position
- **Example:**
  ```typescript
  import { FixedSizeList } from 'react-window';
  
  <FixedSizeList
    height={600}
    itemCount={records.length}
    itemSize={50}
  >
    {({ index, style }) => (
      <div style={style}>
        {/* Render record at index */}
      </div>
    )}
  </FixedSizeList>
  ```

---

## State Management

### React Hooks + Supabase Realtime
- **Why:** No Redux/Zustand needed; Supabase Realtime handles multi-user sync
- **Usage:**
  - Use `useState` for local UI state (form inputs, dropdown open/close)
  - Use `useEffect` to subscribe to Supabase Realtime changes
  - On data change, re-fetch from Supabase (refetch pattern, not polling)
  - Session locking uses Realtime presence (see below)

### Session State Persistence
- **Where:** Store in Supabase `sessions` table (JSONB columns)
- **Pattern:**
  1. Clerk loads session
  2. All data stored in DB (records, merges, edits, rules)
  3. Clerk makes change (e.g., merges two records)
  4. Change written to DB immediately
  5. Realtime notification broadcasts to any other clerks (optional read-only view)
- **Benefit:** No data loss if browser crashes; session can be resumed from any device

---

## Session Locking

### Supabase Realtime Presence
- **How it works:**
  1. Clerk opens session → broadcast presence: `{ clerk_id, session_id, timestamp }`
  2. Every 5 minutes → heartbeat sent (renew presence)
  3. If heartbeat missing for 10 minutes → clerk marked offline
  4. If another clerk tries to open session, warning modal: "Previous clerk offline since 10:30. Take over?"
  5. Clerk confirms → `active_editor_id` updated to new clerk, session unlocked

- **Implementation:**
  ```typescript
  useEffect(() => {
    const subscription = supabase
      .channel(`session:${sessionId}`)
      .on('presence', { event: 'sync' }, () => {
        const state = subscription.presenceState();
        // state = { presence_key: [{ clerk_id, session_id, timestamp }] }
      })
      .subscribe();
    
    // Heartbeat every 5 minutes
    const heartbeat = setInterval(() => {
      subscription.track({ clerk_id, session_id, timestamp: new Date() });
    }, 5 * 60 * 1000);
    
    return () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
    };
  }, [sessionId]);
  ```

- **Fallback:** If Realtime fails, check `active_editor_since` in DB (10-min cutoff)

---

## Validation & Normalization

### Custom SA ID Validator (`lib/validators/sa-id.ts`)
- **Purpose:** Validate South African ID numbers (13-digit or 12-digit with leading zero recovery)
- **Logic:**
  1. Check if ID is 12 digits (missing leading zero)
  2. Add leading zero if needed
  3. Validate Luhn checksum (standard algorithm)
  4. Log recovery in audit trail
- **Example:**
  - Input: "503123456789" (12 digits)
  - Output: "0503123456789" (13 digits, leading zero added)
  - Validation: Luhn checksum passes
  - Audit: "Leading zero recovered for ID"

### Custom CIPC Validator (`lib/validators/cipc.ts`)
- **Purpose:** Normalize CIPC registration numbers to standard format (2005001234)
- **Formats accepted:**
  - "2005/001234" (with slash) → "2005001234"
  - "2005-001234" (with dash) → "2005001234"
  - "2,005-001,234" (with separators) → "2005001234"
- **Logic:**
  1. Remove all non-numeric characters
  2. Validate length (8 digits)
  3. Check checksum if applicable
  4. Return normalized format

### Custom Tax/VAT Validator (`lib/validators/tax.ts`)
- **Purpose:** Validate 10-digit tax ID / VAT numbers
- **Formats accepted:**
  - "1234567890" (numeric)
  - "123-456-789-0" (with dashes)
  - "123.456.789.0" (with dots)
- **Logic:**
  1. Remove separators
  2. Validate length (10 digits)
  3. Return numeric format

### Custom Encoding Detector (`lib/encoding.ts`)
- **Purpose:** Detect file encoding (Windows-1252, ISO-8859-1, UTF-8) and convert
- **Library:** `chardet` or manual heuristic (check BOM, try decoding)
- **Process:**
  1. Read first 100 bytes of file
  2. Check for BOM (Byte Order Mark) → identifies encoding
  3. If no BOM, try decoding as UTF-8 (most reliable for English text)
  4. If UTF-8 fails, try Windows-1252 (common in South African Excel exports)
  5. Warn user if encoding detected is not UTF-8
  6. Convert to UTF-8 internally

### Afrikaans Header Mapper (`lib/mappers/afrikaans.ts`)
- **Purpose:** Map Afrikaans column headers to English DataGrows fields
- **Dictionary (25+ entries):**
  - "Naam" → "Company Name"
  - "Registrasienommer" → "Registration Number"
  - "Belastingverhouding" → "Tax Status"
  - "Eienaarsnaam" → "Owner Name"
  - etc.
- **Diacritic stripping:** "Nä̈m" → "Naam" (remove diacritics, then match)
- **Fuzzy matching fallback:** If exact match fails, use Levenshtein distance

---

## Deployment

### Vercel (Frontend)
- **Why:** Next.js optimized, automatic deployments on git push, edge functions (optional)
- **Configuration:**
  - Environment variables: Supabase URL, Anon Key
  - Build command: `next build`
  - Start command: `next start`
  - Deployment: On merge to `main`

### Supabase Cloud (Database & Auth)
- **Why:** Managed PostgreSQL, built-in auth, storage, Realtime all in one
- **Configuration:**
  - Database: PostgreSQL 15+ (with JSON support, RLS enabled)
  - Auth: Email/password or OAuth (email for DataGrows)
  - Storage: `exports` and `templates` buckets
  - Realtime: Enabled for `sessions` table

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx (server-side only)
```

---

## Package Dependencies (Summary)

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 15.x | Framework |
| `react`, `react-dom` | 18.x or 19.x | UI |
| `typescript` | 5.x | Type checking |
| `tailwindcss` | 3.x | Styling |
| `@supabase/supabase-js` | Latest | Database client |
| `xlsx` | Latest | File parsing (client) |
| `exceljs` | Latest | File export (server) |
| `fastest-levenshtein` | Latest | String similarity |
| `react-window` | Latest | Virtual scrolling |
| `eslint`, `prettier` | Latest | Code quality |

---

## Key Design Decisions Explained

### Why SheetJS Client-Side + ExcelJS Server-Side?
- **Client-side parsing (SheetJS):** Reduces server load; users can parse 100MB files locally; instant feedback
- **Server-side export (ExcelJS):** SheetJS strips x14 validations (Excel's data validation metadata); ExcelJS preserves them; DataGrows template must not be regenerated
- **Result:** Best of both worlds—fast parsing, accurate export with all formatting preserved

### Why Supabase over Firebase?
- **Open-source:** PostgreSQL is more powerful than Firestore for complex queries
- **RLS:** Row-level security for multi-tenant isolation (each clerk sees only their own sessions)
- **Realtime:** Built-in presence for session locking (no need for separate WebSocket server)
- **Storage:** Supabase Storage integrated with auth (easier permissions management)
- **Cost:** PostgreSQL typically cheaper than Firestore at scale

### Why Tailwind over Material-UI?
- **Bundle size:** Tailwind much lighter (utility classes only, tree-shaking removes unused CSS)
- **Customization:** Easy to implement custom teal/navy palette (Material requires theme overrides)
- **Speed:** Utility-first approach faster to iterate (write CSS in HTML, no switching files)

### Why React Hooks + Supabase Realtime over Redux?
- **Simplicity:** Redux adds boilerplate for this use case (mostly just read/write from DB)
- **Supabase Realtime:** Acts as state store; multi-user sync automatic
- **Scalability:** Works the same for 1 user or 100 concurrent clerks (server handles concurrency)

### Why fastest-levenshtein over Other Matching?
- **Speed:** Compiled C++ bindings, fast enough for 500+ records
- **Threshold:** 0.85 (85% similarity) balances false positives vs false negatives
- **Transparency:** Operator reviews every match (not blind automatic merging)

### Why Supabase Realtime Presence over Polling?
- **Latency:** Real-time updates (WebSocket) vs 10-second polls (HTTP)
- **Bandwidth:** Presence is minimal metadata; polling would fetch entire session repeatedly
- **Cost:** Realtime included with Supabase; no extra infrastructure

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| File upload (100MB) | < 5 seconds | Client-side parsing |
| Import step completion | < 10 seconds | Normalization + dedup finding |
| Review step load | < 2 seconds | Virtual scrolling handles 500+ records |
| Export generation | < 3 seconds | ExcelJS writes fast |
| Session locking heartbeat | 5 minutes | Configurable, trade-off between responsiveness & overhead |
| Session fallback timeout | 10 minutes | Manual override possible with warning |

---

## Security Considerations

### Row-Level Security (RLS)
- Each clerk can only read/write their own sessions
- Policy: `SELECT/UPDATE/DELETE WHERE created_by = auth.user_id()`

### Authentication
- Supabase Auth (email/password)
- Session tokens stored in httpOnly cookie (automatic with Supabase client)
- Server-side validation on API routes (check auth token)

### Data Privacy
- No sensitive data in logs (ID numbers hashed in debug logs)
- Export files accessible via signed URLs (expire after 24 hours)
- Audit trail immutable (logs stored in JSONB, not editable)

### File Upload Safety
- Max file size: 100MB
- Allowed formats: .xlsx, .xls, .csv only (magic bytes verified)
- Uploaded files scanned for malware (optional: integrate VirusTotal API)
- Files deleted after processing (not stored permanently)

---

## Monitoring & Debugging

### Logging
- Client-side: `console.log` for debugging (use `process.env.NODE_ENV` to disable in production)
- Server-side: Log to Supabase `logs` table (queryable, searchable by session_id)
- Audit trail: Structured JSON in `sessions.audit_log` (immutable)

### Error Tracking (Optional)
- Sentry.io for production error reporting
- Captures unhandled exceptions, API errors, performance issues

### Database Monitoring
- Supabase dashboard shows query performance, connection pool status
- Set up alerts for slow queries, high error rates

---

## Conclusion

The tech stack is carefully chosen for Woza La's specific needs:
- **Reliability:** PostgreSQL + Supabase for data integrity
- **Speed:** Client-side file parsing, virtual scrolling for large lists
- **Export fidelity:** ExcelJS preserves x14 validations (no data loss)
- **Multi-user safety:** Realtime presence for session locking
- **Maintainability:** TypeScript strict mode catches errors early
- **Cost-effectiveness:** Vercel + Supabase is cheaper than enterprise alternatives

The goal is to build once and deploy forever (Q2 2026 and beyond with zero rework expected).

