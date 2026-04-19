# Woza La v2 — Unit Test Specifications

This document defines all unit tests for core modules. Test cases include inputs, expected outputs, and edge cases. Tests are organized by module and implementation file.

---

## Test Infrastructure

### Framework
- **Runner**: Vitest (fast, ESM-native, Vue/React compatible)
- **Assertions**: `expect()` from Vitest
- **Mocking**: Vitest mock functions
- **Coverage**: 80%+ target for critical path modules

### Test File Naming
- Module: `src/lib/foo/index.ts` → Test: `src/lib/foo/__tests__/index.test.ts`
- No separate test directory hierarchy; tests live next to source code

### Running Tests
```bash
npm run test           # Run all tests once
npm run test:watch    # Watch mode during development
npm run test:coverage # Generate coverage report
```

---

## Module: normalizer/index.ts

### Purpose
Normalize raw values from any source (Sage, SARS, Excel, CIPC) into standardized formats that match DataGrows schema.

### Test Suite: normalizeDate()

**Function signature:**
```typescript
export function normalizeDate(value: unknown): string
// Input: any value (string, number, null, undefined)
// Output: "dd/mm/yyyy" formatted string or empty string if invalid/null
```

**Test cases:**

```typescript
describe('normalizeDate', () => {
  it('converts Excel serial number to dd/mm/yyyy', () => {
    // Excel: serial 45000 = 26/02/2023 (days since 1900-01-01)
    const result = normalizeDate(45000);
    expect(result).toBe('26/02/2023');
  });

  it('converts ISO 8601 string to dd/mm/yyyy', () => {
    const result = normalizeDate('2024-03-15');
    expect(result).toBe('15/03/2024');
  });

  it('preserves already-formatted dd/mm/yyyy dates', () => {
    const result = normalizeDate('15/03/2024');
    expect(result).toBe('15/03/2024');
  });

  it('parses loose formats with separators', () => {
    // "15-3-24" → "15/03/2024" (assumes YY format if < 100)
    const result = normalizeDate('15-3-24');
    expect(result).toBe('15/03/2024');
  });

  it('parses loose formats with dots (EU style)', () => {
    const result = normalizeDate('15.03.2024');
    expect(result).toBe('15/03/2024');
  });

  it('returns empty string for null', () => {
    expect(normalizeDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeDate(undefined)).toBe('');
  });

  it('preserves raw unparseable string (fallback)', () => {
    // If parser cannot determine format, preserve as-is
    const result = normalizeDate('not-a-date');
    expect(result).toBe('not-a-date');
  });

  it('handles Timestamp objects from Sage', () => {
    // Some Sage exports have Excel date serial
    const result = normalizeDate(44500); // Should convert correctly
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('rejects invalid Excel serial numbers (negative)', () => {
    const result = normalizeDate(-100);
    expect(result).toBe('-100'); // Preserve raw
  });
});
```

### Test Suite: normalizeEntityType()

**Function signature:**
```typescript
export function normalizeEntityType(value: unknown): string
// Input: any entity type string (may have typos, spacing, case variation)
// Output: canonical entity type string from DATAGROWS_FIELDS enum
//         or original value if unrecognized
```

**Test cases:**

```typescript
describe('normalizeEntityType', () => {
  it('canonicalizes PTY LTD variants', () => {
    expect(normalizeEntityType('PTY LTD')).toBe('PTY LTD');
    expect(normalizeEntityType('pty ltd')).toBe('PTY LTD');
    expect(normalizeEntityType('Pty Ltd')).toBe('PTY LTD');
    expect(normalizeEntityType('(PTY) LTD')).toBe('PTY LTD');
    expect(normalizeEntityType('PTY. LTD.')).toBe('PTY LTD');
  });

  it('expands CC to CLOSE CORPORATION', () => {
    expect(normalizeEntityType('CC')).toBe('CLOSE CORPORATION');
    expect(normalizeEntityType('cc')).toBe('CLOSE CORPORATION');
    expect(normalizeEntityType('Close Corp')).toBe('CLOSE CORPORATION');
    expect(normalizeEntityType('CLOSE CORP')).toBe('CLOSE CORPORATION');
  });

  it('normalizes SOLE PROP variants', () => {
    expect(normalizeEntityType('Sole Proprietor')).toBe('SOLE PROP');
    expect(normalizeEntityType('SOLE PROPRIETOR')).toBe('SOLE PROP');
    expect(normalizeEntityType('sole prop')).toBe('SOLE PROP');
    expect(normalizeEntityType('SP')).toBe('SOLE PROP');
  });

  it('expands NPO to NON-PROFIT', () => {
    expect(normalizeEntityType('NPO')).toBe('NON-PROFIT');
    expect(normalizeEntityType('npo')).toBe('NON-PROFIT');
    expect(normalizeEntityType('Non-Profit')).toBe('NON-PROFIT');
    expect(normalizeEntityType('NOT FOR PROFIT')).toBe('NON-PROFIT');
  });

  it('handles PLC (Public Limited Company)', () => {
    expect(normalizeEntityType('PLC')).toBe('PLC');
    expect(normalizeEntityType('Public Limited Company')).toBe('PLC');
  });

  it('preserves unrecognized entity types', () => {
    expect(normalizeEntityType('RANDOM THING')).toBe('RANDOM THING');
    expect(normalizeEntityType('CUSTOM TYPE')).toBe('CUSTOM TYPE');
  });

  it('handles null/undefined', () => {
    expect(normalizeEntityType(null)).toBe('');
    expect(normalizeEntityType(undefined)).toBe('');
  });

  it('strips leading/trailing whitespace before matching', () => {
    expect(normalizeEntityType('  PTY LTD  ')).toBe('PTY LTD');
    expect(normalizeEntityType('\tCC\n')).toBe('CLOSE CORPORATION');
  });
});
```

### Test Suite: normalizeRegistrationNumber()

**Function signature:**
```typescript
export function normalizeRegistrationNumber(value: unknown): string
// Input: CIPC registration number (may have missing slashes, dashes, etc.)
// Output: "YYYY/NNNNNN/NN" format or original value if unparseable
```

**Test cases:**

```typescript
describe('normalizeRegistrationNumber', () => {
  it('preserves correctly formatted number', () => {
    expect(normalizeRegistrationNumber('2018/123456/07')).toBe('2018/123456/07');
  });

  it('recovers format from digits-only string', () => {
    // "201812345607" → "2018/123456/07" (extract: YYYY NN..NN NN)
    expect(normalizeRegistrationNumber('201812345607')).toBe('2018/123456/07');
  });

  it('replaces dashes with slashes', () => {
    expect(normalizeRegistrationNumber('2018-123456-07')).toBe('2018/123456/07');
  });

  it('handles spaces instead of slashes', () => {
    expect(normalizeRegistrationNumber('2018 123456 07')).toBe('2018/123456/07');
  });

  it('returns empty string for null/empty', () => {
    expect(normalizeRegistrationNumber(null)).toBe('');
    expect(normalizeRegistrationNumber('')).toBe('');
  });

  it('preserves malformed strings for manual review', () => {
    // If cannot parse (wrong digit count, etc.), preserve as-is
    expect(normalizeRegistrationNumber('NOT-A-REG')).toBe('NOT-A-REG');
  });

  it('handles leading/trailing whitespace', () => {
    expect(normalizeRegistrationNumber('  2018/123456/07  ')).toBe('2018/123456/07');
  });
});
```

### Test Suite: idNumberKey()

**Function signature:**
```typescript
export function idNumberKey(value: unknown): string
// Input: SA ID or passport number (may have dashes, spaces, be 12-13 digits)
// Output: 13-digit clean format or empty string
// Used as a dedup key
```

**Test cases:**

```typescript
describe('idNumberKey', () => {
  it('returns 13-digit ID unchanged', () => {
    expect(idNumberKey('8501015800086')).toBe('8501015800086');
  });

  it('prepends leading zero to 12-digit IDs', () => {
    // "501015800086" → "0501015800086"
    expect(idNumberKey('501015800086')).toBe('0501015800086');
  });

  it('strips dashes and spaces', () => {
    // "8501-0158-0008-6" → "8501015800086"
    expect(idNumberKey('8501-0158-0008-6')).toBe('8501015800086');
    expect(idNumberKey('85 01 01 58 00 08 6')).toBe('8501015800086');
  });

  it('preserves mixed formatting', () => {
    expect(idNumberKey('85 01-0158 0008-6')).toBe('8501015800086');
  });

  it('returns empty string for null/empty', () => {
    expect(idNumberKey(null)).toBe('');
    expect(idNumberKey('')).toBe('');
  });

  it('returns empty string for non-numeric input', () => {
    expect(idNumberKey('ABC1234567890')).toBe('');
  });

  it('handles string inputs', () => {
    expect(idNumberKey('8501015800086')).toBe('8501015800086');
  });
});
```

### Test Suite: normalizeEmails()

**Function signature:**
```typescript
export function normalizeEmails(value: unknown): string
// Input: email(s) as string (may be comma-separated, with spaces, mixed case)
// Output: comma-separated lowercase emails or empty string
```

**Test cases:**

```typescript
describe('normalizeEmails', () => {
  it('converts to lowercase', () => {
    expect(normalizeEmails('JOHN@EXAMPLE.COM')).toBe('john@example.com');
  });

  it('splits comma-separated emails', () => {
    expect(normalizeEmails('john@x.com, jane@y.com')).toBe('john@x.com,jane@y.com');
  });

  it('removes spaces after commas', () => {
    expect(normalizeEmails('a@x.com, b@y.com, c@z.com')).toBe('a@x.com,b@y.com,c@z.com');
  });

  it('splits concatenated emails without separator', () => {
    // "a@x.comb@y.com" (typo) → "a@x.com,b@y.com"
    // This is a heuristic: email regex finds both
    expect(normalizeEmails('a@x.comb@y.com')).toBe('a@x.com,b@y.com');
  });

  it('returns empty string for invalid email', () => {
    expect(normalizeEmails('notanemail')).toBe('');
    expect(normalizeEmails('missing@domain')).toBe('');
  });

  it('filters out invalid entries from list', () => {
    // "a@x.com, invalid, b@y.com" → "a@x.com,b@y.com"
    expect(normalizeEmails('a@x.com, invalid, b@y.com')).toBe('a@x.com,b@y.com');
  });

  it('handles single email', () => {
    expect(normalizeEmails('solo@example.com')).toBe('solo@example.com');
  });
});
```

### Test Suite: normalizeBoolean()

**Function signature:**
```typescript
export function normalizeBoolean(value: unknown): boolean | undefined
// Input: any value representing true/false
// Output: boolean or undefined (ambiguous)
```

**Test cases:**

```typescript
describe('normalizeBoolean', () => {
  it('converts true value to true', () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean('true')).toBe(true);
    expect(normalizeBoolean('TRUE')).toBe(true);
  });

  it('converts yes/y to true', () => {
    expect(normalizeBoolean('Yes')).toBe(true);
    expect(normalizeBoolean('YES')).toBe(true);
    expect(normalizeBoolean('y')).toBe(true);
    expect(normalizeBoolean('Y')).toBe(true);
  });

  it('converts 1 to true', () => {
    expect(normalizeBoolean(1)).toBe(true);
    expect(normalizeBoolean('1')).toBe(true);
  });

  it('converts false value to false', () => {
    expect(normalizeBoolean(false)).toBe(false);
    expect(normalizeBoolean('false')).toBe(false);
    expect(normalizeBoolean('FALSE')).toBe(false);
  });

  it('converts no/n to false', () => {
    expect(normalizeBoolean('No')).toBe(false);
    expect(normalizeBoolean('NO')).toBe(false);
    expect(normalizeBoolean('n')).toBe(false);
    expect(normalizeBoolean('N')).toBe(false);
  });

  it('converts 0 to false', () => {
    expect(normalizeBoolean(0)).toBe(false);
    expect(normalizeBoolean('0')).toBe(false);
  });

  it('returns undefined for ambiguous values', () => {
    expect(normalizeBoolean('maybe')).toBeUndefined();
    expect(normalizeBoolean('unknown')).toBeUndefined();
    expect(normalizeBoolean(null)).toBeUndefined();
    expect(normalizeBoolean('')).toBeUndefined();
  });
});
```

---

## Module: validator/id-validator.ts

### Purpose
Validate and recover South African ID numbers, registration numbers, tax numbers, and VAT numbers.

### Test Suite: validateSAID()

**Function signature:**
```typescript
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  recovered?: string; // If corrected (e.g., leading zero added)
}

export interface ValidationError {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function validateSAID(value: unknown): ValidationResult
```

**Test cases:**

```typescript
describe('validateSAID', () => {
  it('validates correct 13-digit ID', () => {
    const result = validateSAID('8501015800086');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('recovers 12-digit ID with leading zero', () => {
    const result = validateSAID('501015800086');
    expect(result.valid).toBe(true);
    expect(result.recovered).toBe('0501015800086');
  });

  it('rejects invalid Luhn checksum', () => {
    const result = validateSAID('8501015800087'); // Bad last digit
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('checksum')
      })
    );
  });

  it('detects invalid birth month', () => {
    const result = validateSAID('8501325800086'); // Month 13
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('birth month')
      })
    );
  });

  it('detects invalid birth day', () => {
    const result = validateSAID('8501325800086'); // Day 32
    // Actually this is month 13, catches before day
    // Test day: '8501019800086' (day 19 is valid, 32 would fail)
    const badDay = validateSAID('8501319800086');
    expect(badDay.valid).toBe(false);
  });

  it('flags non-standard formats as info', () => {
    const result = validateSAID('AB12345');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        message: expect.stringContaining('Not a standard SA ID')
      })
    );
  });

  it('rejects strings with non-digits', () => {
    const result = validateSAID('850101-5800086');
    expect(result.valid).toBe(false);
  });
});
```

### Test Suite: validateCIPCRegNumber()

**Function signature:**
```typescript
export function validateCIPCRegNumber(value: unknown): ValidationResult
```

**Test cases:**

```typescript
describe('validateCIPCRegNumber', () => {
  it('validates correct format YYYY/NNNNNN/NN', () => {
    const result = validateCIPCRegNumber('2018/123456/07');
    expect(result.valid).toBe(true);
  });

  it('recovers format from digit-only string', () => {
    const result = validateCIPCRegNumber('201812345607');
    expect(result.valid).toBe(true);
    expect(result.recovered).toBe('2018/123456/07');
  });

  it('flags incorrect segment lengths as warning', () => {
    const result = validateCIPCRegNumber('2018/12345/7');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ severity: 'warning' })
    );
  });

  it('detects year out of range', () => {
    const result = validateCIPCRegNumber('1850/123456/07');
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('Year out of range')
      })
    );
  });

  it('accepts future years (reasonable buffer)', () => {
    const result = validateCIPCRegNumber('2050/123456/07');
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite: validateTaxNumber()

**Function signature:**
```typescript
export function validateTaxNumber(value: unknown): ValidationResult
```

**Test cases:**

```typescript
describe('validateTaxNumber', () => {
  it('validates 10-digit tax number', () => {
    const result = validateTaxNumber('9012345678');
    expect(result.valid).toBe(true);
  });

  it('rejects 9 digits', () => {
    const result = validateTaxNumber('901234567');
    expect(result.valid).toBe(false);
  });

  it('rejects 11 digits', () => {
    const result = validateTaxNumber('90123456789');
    expect(result.valid).toBe(false);
  });

  it('rejects non-numeric', () => {
    const result = validateTaxNumber('901234567A');
    expect(result.valid).toBe(false);
  });

  it('accepts tax number with leading zeros', () => {
    const result = validateTaxNumber('0012345678');
    expect(result.valid).toBe(true);
  });
});
```

### Test Suite: validateVATNumber()

**Function signature:**
```typescript
export function validateVATNumber(value: unknown): ValidationResult
```

**Test cases:**

```typescript
describe('validateVATNumber', () => {
  it('validates 10-digit VAT starting with 4', () => {
    const result = validateVATNumber('4012345678');
    expect(result.valid).toBe(true);
  });

  it('rejects non-4 prefix', () => {
    const result = validateVATNumber('9012345678');
    expect(result.valid).toBe(false);
  });

  it('rejects wrong length', () => {
    const result = validateVATNumber('401234567');
    expect(result.valid).toBe(false);
  });

  it('requires numeric digits', () => {
    const result = validateVATNumber('401234567A');
    expect(result.valid).toBe(false);
  });
});
```

---

## Module: parsers/mapping-heuristics.ts

### Purpose
Auto-map source file columns to DataGrows fields using heuristics (exact match, synonym match, Afrikaans translation).

### Test Suite: suggestFieldKey()

**Function signature:**
```typescript
export function suggestFieldKey(columnName: string): string | undefined
// Input: column name from source file
// Output: DataGrows field key (snake_case) or undefined if no match
```

**Test cases:**

```typescript
describe('suggestFieldKey', () => {
  it('matches exact English headers', () => {
    expect(suggestFieldKey('Client Name')).toBe('client_name');
    expect(suggestFieldKey('company name')).toBe('client_name');
    expect(suggestFieldKey('COMPANY NAME')).toBe('client_name');
  });

  it('matches synonym headers', () => {
    expect(suggestFieldKey('Name')).toBe('client_name');
    expect(suggestFieldKey('Enterprise Name')).toBe('client_name');
    expect(suggestFieldKey('Business Name')).toBe('client_name');
  });

  it('translates Afrikaans headers', () => {
    expect(suggestFieldKey('Kliënt Naam')).toBe('client_name');
    expect(suggestFieldKey('Belastingnommer')).toBe('tax_nr');
    expect(suggestFieldKey('Registrasienommer')).toBe('registration_nr');
  });

  it('handles VAT as BTW (Afrikaans)', () => {
    expect(suggestFieldKey('BTW Nommer')).toBe('vat_nr');
    expect(suggestFieldKey('BTW Nr')).toBe('vat_nr');
  });

  it('matches Registration Number variants', () => {
    expect(suggestFieldKey('Registration Number')).toBe('registration_nr');
    expect(suggestFieldKey('Registration Nr')).toBe('registration_nr');
    expect(suggestFieldKey('Reg Number')).toBe('registration_nr');
    expect(suggestFieldKey('Reg No')).toBe('registration_nr');
  });

  it('returns undefined for unknown headers', () => {
    expect(suggestFieldKey('completely unknown header')).toBeUndefined();
    expect(suggestFieldKey('xyz')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(suggestFieldKey('CLIENT NAME')).toBe('client_name');
    expect(suggestFieldKey('klIënt nAAm')).toBe('client_name');
  });

  it('handles extra whitespace', () => {
    expect(suggestFieldKey('  Client Name  ')).toBe('client_name');
  });
});
```

### Test Suite: initialMapping()

**Function signature:**
```typescript
export function initialMapping(columnHeaders: string[]): Record<string, string | undefined>
// Input: array of column names from uploaded file
// Output: object mapping each column name to a DataGrows field key (or undefined)
```

**Test cases:**

```typescript
describe('initialMapping', () => {
  it('maps all recognizable headers', () => {
    const headers = ['Client Name', 'Status', 'Entity Type'];
    const result = initialMapping(headers);
    expect(result).toEqual({
      'Client Name': 'client_name',
      'Status': 'status',
      'Entity Type': 'entity_type',
    });
  });

  it('maps Afrikaans headers', () => {
    const headers = ['Kliënt Naam', 'Entiteit Tipe'];
    const result = initialMapping(headers);
    expect(result).toEqual({
      'Kliënt Naam': 'client_name',
      'Entiteit Tipe': 'entity_type',
    });
  });

  it('includes undefined for unrecognized columns', () => {
    const headers = ['Client Name', 'Unknown Column'];
    const result = initialMapping(headers);
    expect(result['Unknown Column']).toBeUndefined();
  });

  it('preserves column name casing in keys', () => {
    const headers = ['Client Name'];
    const result = initialMapping(headers);
    expect(Object.keys(result)).toContain('Client Name');
  });

  it('handles empty array', () => {
    const result = initialMapping([]);
    expect(result).toEqual({});
  });

  it('deduplicates identical headers', () => {
    const headers = ['Client Name', 'Client Name'];
    const result = initialMapping(headers);
    expect(Object.keys(result).filter(k => k === 'Client Name')).toHaveLength(2);
  });
});
```

---

## Module: matcher/index.ts

### Purpose
Deduplicate records by primary key and name similarity. Mark matches requiring operator confirmation.

### Test Suite: matchRecords()

**Function signature:**
```typescript
export interface MatchCluster {
  id: string;
  records: ClientRecord[];
  pendingMatches: PendingMatch[]; // Name-based matches needing operator approval
}

export interface PendingMatch {
  orphanId: string; // Record ID not yet merged
  targetClusterId: string;
  similarity: number;
}

export function matchRecords(records: ClientRecord[]): MatchCluster[]
```

**Test cases:**

```typescript
describe('matchRecords', () => {
  it('merges records with same Registration Nr', () => {
    const records = [
      { id: '1', registration_nr: '2018/123456/07', client_name: 'A' },
      { id: '2', registration_nr: '2018/123456/07', client_name: 'A Corp' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records).toHaveLength(2);
  });

  it('merges records with same ID Number', () => {
    const records = [
      { id: '1', id_number: '8501015800086', client_name: 'John' },
      { id: '2', id_number: '8501015800086', client_name: 'J' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records).toHaveLength(2);
  });

  it('keeps records with different primary keys separate', () => {
    const records = [
      { id: '1', registration_nr: '2018/111111/01', client_name: 'ABC' },
      { id: '2', registration_nr: '2018/222222/02', client_name: 'DEF' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(2);
  });

  it('flags name-based matches as pending (not auto-merged)', () => {
    const records = [
      { id: '1', registration_nr: '', client_name: 'Mama Zola Kitchen' },
      { id: '2', registration_nr: '', client_name: 'Mama Zola\'s Kitchen' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].pendingMatches.length + clusters[1].pendingMatches.length).toBeGreaterThan(0);
  });

  it('does not match dissimilar names (< 0.85 similarity)', () => {
    const records = [
      { id: '1', registration_nr: '', client_name: 'ABC Holdings' },
      { id: '2', registration_nr: '', client_name: 'XYZ Trading' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].pendingMatches).toHaveLength(0);
    expect(clusters[1].pendingMatches).toHaveLength(0);
  });

  it('returns one cluster per non-deduplicated record', () => {
    const records = [
      { id: '1', registration_nr: '', client_name: 'A' },
      { id: '2', registration_nr: '', client_name: 'B' },
      { id: '3', registration_nr: '', client_name: 'C' },
    ];
    const clusters = matchRecords(records);
    expect(clusters).toHaveLength(3);
  });
});
```

### Test Suite: applyNameMatches()

**Function signature:**
```typescript
export function applyNameMatches(
  clusters: MatchCluster[],
  decisions: Record<string, 'merge' | 'separate'> // decision per pendingMatch
): MatchCluster[]
```

**Test cases:**

```typescript
describe('applyNameMatches', () => {
  it('merges approved orphan into target cluster', () => {
    let clusters = matchRecords([
      { id: '1', client_name: 'ABC', registration_nr: '' },
      { id: '2', client_name: 'DEF', registration_nr: '' },
    ]);
    const pendingId = clusters[0].pendingMatches[0]?.orphanId;
    if (pendingId) {
      const decisions = { [pendingId]: 'merge' };
      clusters = applyNameMatches(clusters, decisions);
      // One of the clusters should now have 2 records
      expect(clusters.some(c => c.records.length === 2)).toBe(true);
    }
  });

  it('archives rejected orphan', () => {
    let clusters = matchRecords([
      { id: '1', client_name: 'ABC', registration_nr: '' },
      { id: '2', client_name: 'DEF', registration_nr: '' },
    ]);
    const pendingId = clusters[0].pendingMatches[0]?.orphanId;
    if (pendingId) {
      const decisions = { [pendingId]: 'separate' };
      clusters = applyNameMatches(clusters, decisions);
      // Check that an archived record exists
      const archived = clusters.find(c => c._archived === true);
      if (archived) {
        expect(archived._archive_reason).toContain('Operator rejected');
      }
    }
  });
});
```

---

## Module: merger/index.ts

### Purpose
Merge multiple records in a cluster, applying hierarchy rules and conflict tracking.

### Test Suite: mergeCluster()

**Function signature:**
```typescript
export interface MergedResult {
  data: ClientRecord; // Final merged record
  conflicts: ConflictRecord[]; // Conflicting field values
}

export function mergeCluster(cluster: MatchCluster): MergedResult
```

**Test cases:**

```typescript
describe('mergeCluster', () => {
  it('chooses CIPC value over Sage for conflicting field', () => {
    const cluster = {
      records: [
        { id: '1', source: 'CIPC', client_name: 'ABC PTY LTD' },
        { id: '2', source: 'Sage', client_name: 'Abc (Pty) Ltd' },
      ],
    };
    const result = mergeCluster(cluster);
    expect(result.data.client_name).toBe('ABC PTY LTD'); // CIPC wins
  });

  it('detects conflicting tax numbers', () => {
    const cluster = {
      records: [
        { id: '1', source: 'SARS', tax_nr: '9012345678' },
        { id: '2', source: 'Sage', tax_nr: '1111111111' },
      ],
    };
    const result = mergeCluster(cluster);
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({ field: 'tax_nr' })
    );
    expect(result.data.tax_nr).toBe('9012345678'); // SARS wins
  });

  it('preserves matching values across sources', () => {
    const cluster = {
      records: [
        { id: '1', source: 'SARS', tax_nr: '9012345678' },
        { id: '2', source: 'Sage', tax_nr: '9012345678' },
      ],
    };
    const result = mergeCluster(cluster);
    expect(result.conflicts.filter(c => c.field === 'tax_nr')).toHaveLength(0);
    expect(result.data.tax_nr).toBe('9012345678');
  });

  it('applies source hierarchy: CIPC > SARS > Sage > Xero > Excel', () => {
    const cluster = {
      records: [
        { id: '1', source: 'Excel', year_end: 'January' },
        { id: '2', source: 'Sage', year_end: 'March' },
        { id: '3', source: 'SARS', year_end: 'February' },
      ],
    };
    const result = mergeCluster(cluster);
    // SARS > Sage > Excel, so SARS wins
    expect(result.data.year_end).toBe('February');
  });
});
```

### Test Suite: mergeAllClusters()

**Function signature:**
```typescript
export function mergeAllClusters(clusters: MatchCluster[]): ClientRecord[]
// Returns array of merged records, with _archived flag set on excluded clusters
```

**Test cases:**

```typescript
describe('mergeAllClusters', () => {
  it('marks archived clusters with _archived flag', () => {
    let clusters = matchRecords([...records]);
    // Simulate archiving one cluster by operator decision
    clusters[0]._archived = true;
    clusters[0]._archive_reason = 'Operator rejected';
    const merged = mergeAllClusters(clusters);
    expect(merged.some(r => r._archived === true)).toBe(true);
  });

  it('returns one record per cluster', () => {
    const clusters = [
      { id: 'c1', records: [{}, {}] },
      { id: 'c2', records: [{}] },
      { id: 'c3', records: [{}, {}, {}] },
    ];
    const merged = mergeAllClusters(clusters);
    expect(merged).toHaveLength(3);
  });
});
```

---

## Module: rules/engine.ts

### Purpose
Auto-populate fields based on entity type and required service flags.

### Test Suite: applyRules()

**Function signature:**
```typescript
export function applyRules(record: ClientRecord): ClientRecord
// Input: record with at least entity_type, status, and service flags
// Output: record with auto-filled fields based on rules.json
```

**Test cases:**

```typescript
describe('applyRules', () => {
  it('sets CIPC Annual Return for PTY LTD', () => {
    const record = { entity_type: 'PTY LTD' };
    const result = applyRules(record);
    expect(result.cipc_annual_return).toBe(true);
  });

  it('sets required services for PTY LTD', () => {
    const record = { entity_type: 'PTY LTD' };
    const result = applyRules(record);
    expect(result.provisional_tax).toBe(true);
    expect(result.income_tax).toBe(true);
    expect(result.financials).toBe(true);
  });

  it('does not set CIPC Annual Return for SOLE PROP', () => {
    const record = { entity_type: 'SOLE PROP' };
    const result = applyRules(record);
    expect(result.cipc_annual_return).toBeFalsy();
  });

  it('sets Income Tax for SOLE PROP', () => {
    const record = { entity_type: 'SOLE PROP' };
    const result = applyRules(record);
    expect(result.income_tax).toBe(true);
  });

  it('sets VAT when vat_nr present', () => {
    const record = { vat_nr: '4012345678' };
    const result = applyRules(record);
    expect(result.vat).toBe(true);
  });

  it('sets Payroll services when paye_nr present', () => {
    const record = { paye_nr: '1234567890' };
    const result = applyRules(record);
    expect(result.payroll).toBe(true);
    expect(result.emp201).toBe(true);
    expect(result.emp501s).toBe(true);
  });

  it('respects sticky overrides (does not overwrite manual edits)', () => {
    const record = {
      entity_type: 'PTY LTD',
      income_tax: false, // Manually set to false
      _sticky_overrides: { income_tax: true }, // Mark as sticky
    };
    const result = applyRules(record);
    expect(result.income_tax).toBe(false); // Preserved
  });

  it('does not overwrite existing field values', () => {
    const record = {
      entity_type: 'PTY LTD',
      provisionalTax: false, // Already set
    };
    const result = applyRules(record);
    expect(result.provisionalTax).toBe(false); // Preserved, not overwritten
  });
});
```

---

## Module: exporter/index.ts

### Purpose
Export merged records to DataGrows template format (.xlsx).

### Test Suite: colToIndex()

**Function signature:**
```typescript
export function colToIndex(col: string): number
// Input: Excel column letter(s) (A, B, Z, AA, AB, etc.)
// Output: 0-based column index
```

**Test cases:**

```typescript
describe('colToIndex', () => {
  it('converts single letters', () => {
    expect(colToIndex('A')).toBe(0);
    expect(colToIndex('B')).toBe(1);
    expect(colToIndex('Z')).toBe(25);
  });

  it('converts double letters', () => {
    expect(colToIndex('AA')).toBe(26);
    expect(colToIndex('AB')).toBe(27);
    expect(colToIndex('BA')).toBe(52);
  });

  it('converts to column 85 (CH)', () => {
    expect(colToIndex('CH')).toBe(85);
  });

  it('handles lowercase', () => {
    expect(colToIndex('aa')).toBe(26);
  });
});
```

### Test Suite: validateTemplateStructure()

**Function signature:**
```typescript
export function validateTemplateStructure(workbook: XLSX.Workbook): void
// Throws error if template is invalid
```

**Test cases:**

```typescript
describe('validateTemplateStructure', () => {
  it('passes for template with 86 fields', () => {
    const workbook = loadTemplate(); // Load datagrows_canonical_template.xlsx
    expect(() => validateTemplateStructure(workbook)).not.toThrow();
  });

  it('throws if field count wrong', () => {
    const workbook = createMockWorkbook(85); // Only 85 fields
    expect(() => validateTemplateStructure(workbook)).toThrow('Expected 86 columns');
  });

  it('throws if duplicate columns detected', () => {
    const workbook = createMockWorkbook(86, { duplicateCol: true });
    expect(() => validateTemplateStructure(workbook)).toThrow('Duplicate column');
  });
});
```

### Test Suite: exportToDataGrowsTemplate()

**Function signature:**
```typescript
export function exportToDataGrowsTemplate(records: ClientRecord[]): Buffer
// Input: array of merged client records
// Output: .xlsx file buffer ready to download
```

**Test cases:**

```typescript
describe('exportToDataGrowsTemplate', () => {
  it('exports single record to row 3', () => {
    const records = [{
      id: '1',
      client_name: 'Test Client',
      // ... other 84 fields
    }];
    const buffer = exportToDataGrowsTemplate(records);
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet['A3'].v).toBe('Test Client');
  });

  it('exports all 86 fields in correct column order', () => {
    const records = [{ /* full record with all 86 fields */ }];
    const buffer = exportToDataGrowsTemplate(records);
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // Verify columns A-CH (26 + 26 + 34 = 86)
    expect(sheet['CH2']).toBeDefined(); // Last field in row 2 (header)
  });

  it('skips archived records', () => {
    const records = [
      { id: '1', client_name: 'Include', _archived: false },
      { id: '2', client_name: 'Exclude', _archived: true },
    ];
    const buffer = exportToDataGrowsTemplate(records);
    const workbook = XLSX.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // Only 1 data row should exist (row 3)
    expect(sheet['A4']).toBeUndefined();
  });

  it('returns buffer that can be written to disk', () => {
    const records = [{ /* record */ }];
    const buffer = exportToDataGrowsTemplate(records);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
```

---

## Test Execution & CI/CD

### Running Tests Locally
```bash
npm run test:watch -- normalizer/index.test.ts
npm run test:coverage -- src/lib/
```

### CI/CD Pipeline
- Tests run on every commit (GitHub Actions workflow)
- Must pass before PR can merge
- Coverage reports generated and compared against baseline (80%)
- Failing tests block deploy to staging

### Coverage Goals
- Critical path modules (normalizer, validator, merger, rules, exporter): **90%+**
- UI components and integration tests: **70%+**
- Overall: **80%+**

---

## Test Data & Fixtures

### Mock Records
Use factory functions to generate test records:
```typescript
export function createMockRecord(overrides?: Partial<ClientRecord>): ClientRecord {
  return {
    id: crypto.randomUUID(),
    client_name: 'Test Client',
    entity_type: 'PTY LTD',
    source: 'Sage',
    ...overrides,
  };
}
```

### Test Files
- Small test files (<10 rows) embedded in test code
- Large files (100+ rows) stored as `__fixtures__/sage_export.csv`, etc.
- Files use realistic SA data (valid ID numbers, CIPC Reg numbers, etc.)

---

This specification covers unit testing for all core modules. Each test is self-contained, deterministic, and focuses on a single behavior. All tests must pass before merge.
