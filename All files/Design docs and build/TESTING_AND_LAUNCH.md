# Woza La v2 — Testing & Launch Strategy

## Overview

This document outlines comprehensive testing strategy (unit, integration, edge case, performance) and launch checklist for Woza La v2. The goal is shipping a production-ready app that reliably processes multi-source accounting data into valid DataGrows masterfiles.

---

## Unit Tests

### Module: `normalizer/index.ts`

**Purpose**: Field-level normalization applied to all mapped records.

**Test Cases**:

```typescript
describe('normalizer/index.ts', () => {
  
  describe('date normalization', () => {
    test('converts dd/mm/yyyy to standard format', () => {
      expect(normalizeDate('15/03/2024')).toBe('15/03/2024');
    });
    
    test('detects and converts mm/dd/yyyy (US format)', () => {
      expect(normalizeDate('03/15/2024')).toBe('15/03/2024');
    });
    
    test('converts yyyy-mm-dd ISO format', () => {
      expect(normalizeDate('2024-03-15')).toBe('15/03/2024');
    });
    
    test('returns null for invalid dates', () => {
      expect(normalizeDate('invalid')).toBeNull();
    });
    
    test('handles month names', () => {
      expect(normalizeDate('March 15, 2024')).toBe('15/03/2024');
    });
    
    test('handles Afrikaans month names', () => {
      expect(normalizeDate('15 Maart 2024')).toBe('15/03/2024');
    });
  });
  
  describe('entity type normalization', () => {
    test('normalizes common variations', () => {
      expect(normalizeEntityType('Pty')).toBe('Pty Ltd');
      expect(normalizeEntityType('PTY LIMITED')).toBe('Pty Ltd');
      expect(normalizeEntityType('Proprietary Limited')).toBe('Pty Ltd');
    });
    
    test('normalizes CC variations', () => {
      expect(normalizeEntityType('Close Corporation')).toBe('CC');
      expect(normalizeEntityType('CC (Close Corporation)')).toBe('CC');
    });
    
    test('normalizes Trust variations', () => {
      expect(normalizeEntityType('Trust')).toBe('Trust');
      expect(normalizeEntityType('TRUST')).toBe('Trust');
    });
    
    test('returns unknown for unrecognized types', () => {
      expect(normalizeEntityType('Unknown Type')).toBe('Unknown');
    });
  });
  
  describe('SA ID normalization', () => {
    test('leaves 13-digit valid ID unchanged', () => {
      expect(normalizeSaId('8301015800183')).toBe('8301015800183');
    });
    
    test('prepends zero to 12-digit ID', () => {
      expect(normalizeSaId('801015800183')).toBe('0801015800183');
    });
    
    test('returns null for invalid IDs', () => {
      expect(normalizeSaId('invalid')).toBeNull();
    });
  });
  
  describe('CIPC normalization', () => {
    test('formats unformatted CIPC number', () => {
      expect(normalizeCipc('201812345607')).toBe('2018/123456/07');
    });
    
    test('leaves formatted CIPC unchanged', () => {
      expect(normalizeCipc('2018/123456/07')).toBe('2018/123456/07');
    });
    
    test('returns null for invalid formats', () => {
      expect(normalizeCipc('invalid')).toBeNull();
    });
  });
  
  describe('email normalization', () => {
    test('splits semicolon-separated emails', () => {
      const result = normalizeEmail('john@example.com; jane@example.com');
      expect(result).toEqual(['john@example.com', 'jane@example.com']);
    });
    
    test('handles comma-separated emails', () => {
      const result = normalizeEmail('john@example.com, jane@example.com');
      expect(result).toEqual(['john@example.com', 'jane@example.com']);
    });
    
    test('returns single email as array', () => {
      const result = normalizeEmail('john@example.com');
      expect(result).toEqual(['john@example.com']);
    });
    
    test('validates email format', () => {
      const result = normalizeEmail('invalid-email');
      expect(result).toBeNull();
    });
  });
  
  describe('phone normalization', () => {
    test('removes non-digit characters', () => {
      expect(normalizePhone('021-123-4567')).toBe('+27211234567');
    });
    
    test('prefixes +27 if starts with 0', () => {
      expect(normalizePhone('0211234567')).toBe('+27211234567');
    });
    
    test('handles international format', () => {
      expect(normalizePhone('+27211234567')).toBe('+27211234567');
    });
    
    test('returns null for too-short numbers', () => {
      expect(normalizePhone('123')).toBeNull();
    });
  });
  
  describe('boolean normalization', () => {
    test('parses yes/no variations', () => {
      expect(normalizeBoolean('Yes')).toBe(true);
      expect(normalizeBoolean('Y')).toBe(true);
      expect(normalizeBoolean('No')).toBe(false);
      expect(normalizeBoolean('N')).toBe(false);
    });
    
    test('parses 1/0', () => {
      expect(normalizeBoolean('1')).toBe(true);
      expect(normalizeBoolean('0')).toBe(false);
    });
    
    test('parses true/false', () => {
      expect(normalizeBoolean('true')).toBe(true);
      expect(normalizeBoolean('false')).toBe(false);
    });
    
    test('returns null for ambiguous values', () => {
      expect(normalizeBoolean('maybe')).toBeNull();
    });
  });
  
  describe('month normalization', () => {
    test('parses month names (English)', () => {
      expect(normalizeMonth('January')).toBe(1);
      expect(normalizeMonth('February')).toBe(2);
      expect(normalizeMonth('December')).toBe(12);
    });
    
    test('parses abbreviated months', () => {
      expect(normalizeMonth('Jan')).toBe(1);
      expect(normalizeMonth('Feb')).toBe(2);
    });
    
    test('parses Afrikaans month names', () => {
      expect(normalizeMonth('Januari')).toBe(1);
      expect(normalizeMonth('Februarie')).toBe(2);
      expect(normalizeMonth('Desember')).toBe(12);
    });
    
    test('parses numeric strings', () => {
      expect(normalizeMonth('1')).toBe(1);
      expect(normalizeMonth('12')).toBe(12);
    });
    
    test('returns null for invalid months', () => {
      expect(normalizeMonth('invalid')).toBeNull();
    });
  });
});
```

**Coverage Target**: 95%+ (all normalization branches tested)

---

### Module: `validator/id-validator.ts`

**Purpose**: South Africa-specific ID validation (SA ID, CIPC, Tax, VAT).

**Test Cases**:

```typescript
describe('validator/id-validator.ts', () => {
  
  describe('validateSaId', () => {
    test('validates correct 13-digit SA ID', () => {
      // Real Luhn example: 8301015800183
      expect(validateSaId('8301015800183')).toBe(true);
    });
    
    test('rejects invalid Luhn checksum', () => {
      expect(validateSaId('8301015800184')).toBe(false);
    });
    
    test('rejects wrong length', () => {
      expect(validateSaId('801015800183')).toBe(false);  // 12 digits
      expect(validateSaId('83010158001830')).toBe(false);  // 14 digits
    });
    
    test('allows pre-1900 birth dates', () => {
      // ID with YY=80 (1880, not 1980)
      // This would be a historical entity; should be allowed
      expect(validateSaId('0001015800183')).toBe(true);  // 0000-01-01 is valid for old records
    });
    
    test('rejects non-numeric characters', () => {
      expect(validateSaId('830101580018A')).toBe(false);
    });
    
    test('auto-prepends zero to 12-digit IDs', () => {
      // This should be called by normalizer, but validator should handle it
      const result = validateSaId('0801015800183', {autoFix: true});
      expect(result).toBe(true);
    });
  });
  
  describe('validateCipc', () => {
    test('validates formatted CIPC', () => {
      expect(validateCipc('2018/123456/07')).toBe(true);
      expect(validateCipc('1900/000001/00')).toBe(true);
    });
    
    test('rejects invalid year', () => {
      expect(validateCipc('9999/123456/07')).toBe(false);  // Year > 2100
      expect(validateCipc('1899/123456/07')).toBe(false);  // Year < 1900
    });
    
    test('rejects wrong format', () => {
      expect(validateCipc('2018-123456-07')).toBe(false);
      expect(validateCipc('201812345607')).toBe(false);  // unformatted
    });
    
    test('validates unformatted CIPC (auto-fix)', () => {
      const result = validateCipc('201812345607', {autoFix: true});
      expect(result).toBe(true);
    });
    
    test('rejects non-numeric components', () => {
      expect(validateCipc('20XX/123456/07')).toBe(false);
    });
    
    test('recovers from common formatting errors', () => {
      // Some files export as: 2018 123456 07
      expect(validateCipc('2018 123456 07', {autoFix: true})).toBe(true);
    });
  });
  
  describe('validateTaxNumber', () => {
    test('validates 10-digit tax number', () => {
      expect(validateTaxNumber('1234567890')).toBe(true);
      expect(validateTaxNumber('0000000001')).toBe(true);
    });
    
    test('rejects wrong length', () => {
      expect(validateTaxNumber('123456789')).toBe(false);  // 9 digits
      expect(validateTaxNumber('12345678901')).toBe(false);  // 11 digits
    });
    
    test('rejects non-numeric', () => {
      expect(validateTaxNumber('123456789A')).toBe(false);
    });
  });
  
  describe('validateVatNumber', () => {
    test('validates 10-digit VAT number starting with 4', () => {
      expect(validateVatNumber('4123456789')).toBe(true);
      expect(validateVatNumber('4000000001')).toBe(true);
    });
    
    test('rejects non-4 prefix', () => {
      expect(validateVatNumber('1234567890')).toBe(false);
      expect(validateVatNumber('3123456789')).toBe(false);
    });
    
    test('rejects wrong length', () => {
      expect(validateVatNumber('412345678')).toBe(false);
      expect(validateVatNumber('41234567890')).toBe(false);
    });
    
    test('rejects non-numeric', () => {
      expect(validateVatNumber('412345678A')).toBe(false);
    });
  });
});
```

**Coverage Target**: 100% (all edge cases tested)

---

### Module: `normalizer/file-validator.ts`

**Purpose**: Pre-import file validation (encoding, size, format).

**Test Cases**:

```typescript
describe('normalizer/file-validator.ts', () => {
  
  describe('validateUpload', () => {
    test('accepts UTF-8 encoded CSV', () => {
      const file = new File(['name,age\nJohn,30'], 'test.csv', {type: 'text/csv'});
      const result = validateUpload(file);
      expect(result.valid).toBe(true);
      expect(result.encoding).toBe('UTF-8');
    });
    
    test('detects Windows-1252 encoding', () => {
      // Mock Windows-1252 encoded file with é, ö, ü
      const buffer = Buffer.from([0x6E, 0x61, 0x6D, 0xE9]); // name + é in Windows-1252
      const file = new File([buffer], 'test.csv', {type: 'text/csv'});
      const result = validateUpload(file);
      expect(result.encoding).toMatch(/1252|WINDOWS-1252/i);
    });
    
    test('rejects file > 50MB', () => {
      const largeBuffer = new ArrayBuffer(51 * 1024 * 1024);
      const file = new File([largeBuffer], 'large.xlsx');
      const result = validateUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('size');
    });
    
    test('accepts file ≤ 50MB', () => {
      const buffer = new ArrayBuffer(10 * 1024 * 1024);
      const file = new File([buffer], 'test.xlsx');
      const result = validateUpload(file);
      expect(result.valid).toBe(true);
    });
    
    test('accepts valid file extensions', () => {
      const validExts = ['xlsx', 'csv', 'xls', 'xlsm'];
      validExts.forEach(ext => {
        const file = new File([], `test.${ext}`);
        const result = validateUpload(file);
        expect(result.valid).toBe(true);
      });
    });
    
    test('rejects invalid file extensions', () => {
      const file = new File([], 'test.txt');
      const result = validateUpload(file);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('extension');
    });
    
    test('rejects password-protected Excel files', () => {
      // Mock password-protected file
      // ExcelJS throws specific error for password-protected files
      const result = validateUpload(passwordProtectedFile);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('password');
    });
  });
});
```

**Coverage Target**: 95%+

---

### Module: `parsers/mapping-heuristics.ts`

**Purpose**: Intelligent column header auto-mapping with multi-language support.

**Test Cases**:

```typescript
describe('parsers/mapping-heuristics.ts', () => {
  
  describe('3-pass mapping algorithm', () => {
    test('pass 1: exact match (case-insensitive)', () => {
      const headers = ['Client Name', 'Entity Type'];
      const mapping = mapHeaders(headers);
      expect(mapping['Client Name'].mapped_to).toBe('name');
      expect(mapping['Client Name'].confidence).toBe(1.0);
    });
    
    test('pass 2: synonym match', () => {
      const headers = ['Business Name'];
      const mapping = mapHeaders(headers);
      expect(mapping['Business Name'].mapped_to).toBe('name');
      expect(mapping['Business Name'].confidence).toBe(0.9);
    });
    
    test('pass 3: substring match', () => {
      const headers = ['Registration'];
      const mapping = mapHeaders(headers);
      expect(mapping['Registration'].mapped_to).toBe('registration_number');
      expect(mapping['Registration'].confidence).toBe(0.7);
    });
    
    test('returns null for unmapped headers', () => {
      const headers = ['Random Header 123'];
      const mapping = mapHeaders(headers);
      expect(mapping['Random Header 123'].mapped_to).toBeNull();
      expect(mapping['Random Header 123'].confidence).toBe(0);
    });
  });
  
  describe('Afrikaans header support', () => {
    test('maps Afrikaans "Kliënt Naam" to name', () => {
      const headers = ['Kliënt Naam'];
      const mapping = mapHeaders(headers);
      expect(mapping['Kliënt Naam'].mapped_to).toBe('name');
      expect(mapping['Kliënt Naam'].confidence).toBeGreaterThan(0.8);
    });
    
    test('maps Afrikaans "Belastingnommer" to tax_number', () => {
      const headers = ['Belastingnommer'];
      const mapping = mapHeaders(headers);
      expect(mapping['Belastingnommer'].mapped_to).toBe('tax_number');
    });
    
    test('maps Afrikaans "BTW Nommer" to vat_number', () => {
      const headers = ['BTW Nommer'];
      const mapping = mapHeaders(headers);
      expect(mapping['BTW Nommer'].mapped_to).toBe('vat_number');
    });
    
    test('maps Afrikaans "Entiteit Tipe" to entity_type', () => {
      const headers = ['Entiteit Tipe'];
      const mapping = mapHeaders(headers);
      expect(mapping['Entiteit Tipe'].mapped_to).toBe('entity_type');
    });
  });
  
  describe('diacritic stripping', () => {
    test('strips diacritics before matching', () => {
      const headers = ['Kliënt Nàme'];  // diacritics on both words
      const mapping = mapHeaders(headers);
      expect(mapping['Kliënt Nàme'].mapped_to).toBe('name');
      expect(mapping['Kliënt Nàme'].confidence).toBeGreaterThan(0.7);
    });
  });
});
```

**Coverage Target**: 90%+

---

### Module: `matcher/index.ts`

**Purpose**: Deduplication via primary key matching and name similarity.

**Test Cases**:

```typescript
describe('matcher/index.ts', () => {
  
  describe('primary key deduplication', () => {
    test('groups records by registration number', () => {
      const records = [
        {registration_number: '2018/123456/07', name: 'Acme Pty Ltd', source: 'cipc'},
        {registration_number: '2018/123456/07', name: 'ACME PTY LIMITED', source: 'sars'},
      ];
      const clusters = dedup(records);
      expect(clusters.length).toBe(1);
      expect(clusters[0].sources).toContain('cipc');
      expect(clusters[0].sources).toContain('sars');
    });
    
    test('groups records by individual ID number', () => {
      const records = [
        {id_number: '8301015800183', name: 'John Doe', source: 'sars'},
        {id_number: '8301015800183', name: 'J. Doe', source: 'sage'},
      ];
      const clusters = dedup(records);
      expect(clusters.length).toBe(1);
    });
    
    test('groups records by trust deed number', () => {
      const records = [
        {trust_deed_number: 'IT123456', name: 'Smith Trust', source: 'cipc'},
        {trust_deed_number: 'IT123456', name: 'Smith Trust', source: 'excel'},
      ];
      const clusters = dedup(records);
      expect(clusters.length).toBe(1);
    });
    
    test('creates separate clusters for different primary keys', () => {
      const records = [
        {registration_number: '2018/123456/07', name: 'Acme Pty Ltd', source: 'cipc'},
        {registration_number: '2019/123456/07', name: 'Beta Pty Ltd', source: 'cipc'},
      ];
      const clusters = dedup(records);
      expect(clusters.length).toBe(2);
    });
  });
  
  describe('name-based matching', () => {
    test('suggests matches with Levenshtein ≥ 0.85', () => {
      const cluster1 = {merged: {name: 'Acme Pty Ltd'}, sources: ['cipc']};
      const cluster2 = {merged: {name: 'ACME PTY LIMITED'}, sources: ['excel']};
      const suggestions = findNameMatches([cluster1, cluster2]);
      expect(suggestions.length).toBe(1);
      expect(suggestions[0].similarity).toBeGreaterThanOrEqual(0.85);
    });
    
    test('does NOT auto-merge name matches', () => {
      const records = [
        {id_number: null, name: 'Johns Bakery', source: 'excel'},
        {id_number: null, name: 'John's Bakery', source: 'sage'},
      ];
      const {clusters, suggestions} = dedup(records);
      // Should create 2 clusters (no primary key), but suggest merge
      expect(clusters.length).toBe(2);
      expect(suggestions.length).toBe(1);
    });
    
    test('rejects matches with Levenshtein < 0.85', () => {
      const suggestions = findNameMatches([
        {merged: {name: 'Acme Pty Ltd'}},
        {merged: {name: 'Beta Holdings'}},
      ]);
      expect(suggestions.length).toBe(0);
    });
  });
  
  describe('dedup confirmation', () => {
    test('applies approved matches', () => {
      const clusters = [{id: 'c1'}, {id: 'c2'}];
      const approved = [{cluster1Id: 'c1', cluster2Id: 'c2', keep: 'c1'}];
      const result = applyNameMatches(clusters, approved, []);
      expect(result.length).toBe(1);  // merged
    });
    
    test('rejects declined matches', () => {
      const clusters = [{id: 'c1'}, {id: 'c2'}];
      const rejected = [{cluster1Id: 'c1', cluster2Id: 'c2'}];
      const result = applyNameMatches(clusters, [], rejected);
      expect(result.length).toBe(2);  // unchanged
    });
  });
});
```

**Coverage Target**: 95%+

---

### Module: `merger/index.ts` & `conflict-detector.ts`

**Purpose**: Merge multi-source records via hierarchy, detect conflicts.

**Test Cases**:

```typescript
describe('merger/index.ts', () => {
  
  describe('source hierarchy merging', () => {
    test('applies priority: CIPC > SARS > Sage > Xero > Excel', () => {
      const cluster = {
        sources: ['cipc', 'sars', 'sage'],
        members: [
          {source: 'cipc', data: {name: 'Acme Pty Ltd', tax: '1234567890'}},
          {source: 'sars', data: {name: 'ACME PTY LIMITED', tax: '1234567890'}},
          {source: 'sage', data: {name: null, tax: '1234567890'}},
        ],
      };
      const merged = mergeCluster(cluster);
      expect(merged.name).toBe('Acme Pty Ltd');  // CIPC wins
      expect(merged.tax).toBe('1234567890');  // All same
    });
    
    test('records conflicts in merged data', () => {
      const cluster = {
        sources: ['cipc', 'sars'],
        members: [
          {source: 'cipc', data: {address: '123 Main St'}},
          {source: 'sars', data: {address: '456 Oak Ave'}},
        ],
      };
      const merged = mergeCluster(cluster);
      expect(merged.conflicts.address).toBeDefined();
      expect(merged.conflicts.address.cipc).toBe('123 Main St');
      expect(merged.conflicts.address.sars).toBe('456 Oak Ave');
      expect(merged.conflicts.address.chosen).toBe('123 Main St');
    });
    
    test('chooses first non-empty value', () => {
      const cluster = {
        sources: ['cipc', 'sars'],
        members: [
          {source: 'cipc', data: {phone: null}},
          {source: 'sars', data: {phone: '0211234567'}},
        ],
      };
      const merged = mergeCluster(cluster);
      expect(merged.phone).toBe('0211234567');  // SARS has value
    });
  });
});

describe('merger/conflict-detector.ts', () => {
  
  describe('incremental import conflict detection', () => {
    test('detects when new source changes a field', () => {
      const existing = {
        merged: {name: 'Acme Pty Ltd', sources: ['cipc']},
        conflicts: {},
      };
      const newRecord = {
        source: 'sars',
        data: {name: 'ACME PTY LIMITED'},
      };
      const conflicts = detectConflicts(existing, newRecord);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].field).toBe('name');
    });
    
    test('ignores conflicts when new source is lower priority', () => {
      const existing = {
        merged: {name: 'Acme Pty Ltd', sources: ['cipc']},
      };
      const newRecord = {source: 'excel', data: {name: 'Different Name'}};
      const conflicts = detectConflicts(existing, newRecord);
      // Excel is lower priority, so no conflict reported
      expect(conflicts.length).toBe(0);
    });
  });
});
```

**Coverage Target**: 90%+

---

### Module: `rules/engine.ts`

**Purpose**: Apply declarative rules to clusters with sticky manual overrides.

**Test Cases**:

```typescript
describe('rules/engine.ts', () => {
  
  describe('rule application', () => {
    test('applies simple set_field rule', () => {
      const cluster = {
        merged: {entity_type: 'CC', directors: []},
        edits: [],
      };
      const rule = {
        condition: "entity_type === 'CC'",
        action: 'set_field',
        field: 'is_cc',
        value: true,
      };
      const result = applyRule(cluster, rule);
      expect(result.merged.is_cc).toBe(true);
    });
    
    test('only fills empty fields by default', () => {
      const cluster = {
        merged: {notes: 'Existing note', entity_type: 'Pty Ltd'},
      };
      const rule = {
        condition: "entity_type === 'Pty Ltd'",
        action: 'set_field',
        field: 'notes',
        value: 'New note',
        override: false,
      };
      const result = applyRule(cluster, rule);
      expect(result.merged.notes).toBe('Existing note');  // Not overwritten
    });
    
    test('overwrites if rule has override: true', () => {
      const cluster = {
        merged: {notes: 'Old', entity_type: 'Pty Ltd'},
      };
      const rule = {
        condition: "entity_type === 'Pty Ltd'",
        action: 'set_field',
        field: 'notes',
        value: 'New',
        override: true,
      };
      const result = applyRule(cluster, rule);
      expect(result.merged.notes).toBe('New');
    });
  });
  
  describe('sticky manual overrides', () => {
    test('preserves manual edits on re-run', () => {
      const cluster = {
        merged: {name: 'Original', entity_type: 'Pty Ltd'},
        edits: [
          {field: 'name', old_value: 'Original', new_value: 'Manual Override', edited_by: 'clerk@firm.com'},
        ],
      };
      const rules = [
        {
          condition: "entity_type === 'Pty Ltd'",
          action: 'set_field',
          field: 'name',
          value: 'Rule-Generated Name',
        },
      ];
      const result = applyRules(cluster, rules);
      expect(result.merged.name).toBe('Manual Override');  // Manual edit preserved
    });
    
    test('reverts auto-applied rules if not manually edited', () => {
      const cluster = {
        merged: {field: 'auto-generated-value', entity_type: 'Pty Ltd'},
        edits: [],  // No manual edit
        appliedRules: [{ruleId: 'rule_001', field: 'field'}],  // Rule was applied
      };
      const newRules = [
        {id: 'rule_001', action: 'set_field', field: 'field', value: 'new-value'},
      ];
      const result = applyRules(cluster, newRules);
      expect(result.merged.field).toBe('new-value');  // Updated
    });
  });
  
  describe('batch processing', () => {
    test('processes all clusters efficiently', () => {
      const clusters = Array(100).fill(null).map((_, i) => ({
        id: `c${i}`,
        merged: {entity_type: 'Pty Ltd'},
        edits: [],
      }));
      const rules = [{action: 'set_field', field: 'is_pty', value: true}];
      const start = Date.now();
      const result = applyRules(clusters, rules);
      const elapsed = Date.now() - start;
      expect(result.length).toBe(100);
      expect(elapsed).toBeLessThan(1000);  // Should be fast
    });
  });
});
```

**Coverage Target**: 95%+

---

### Module: `validator/index.ts`

**Purpose**: Multi-level validation (hard-required, conditional, format).

**Test Cases**:

```typescript
describe('validator/index.ts', () => {
  
  describe('hard-required validation', () => {
    test('fails if name is missing', () => {
      const cluster = {merged: {entity_type: 'Pty Ltd'}};
      const result = validateCluster(cluster);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({field: 'name'}));
    });
    
    test('fails if entity_type is missing', () => {
      const cluster = {merged: {name: 'Acme'}};
      const result = validateCluster(cluster);
      expect(result.valid).toBe(false);
    });
    
    test('fails if relationship is missing', () => {
      const cluster = {merged: {name: 'Acme', entity_type: 'Pty Ltd'}};
      const result = validateCluster(cluster);
      expect(result.valid).toBe(false);
    });
    
    test('passes with all hard-required fields', () => {
      const cluster = {
        merged: {
          name: 'Acme Pty Ltd',
          entity_type: 'Pty Ltd',
          relationship: 'Client',
        },
      };
      const result = validateCluster(cluster);
      expect(result.errors).toHaveLength(0);
    });
  });
  
  describe('conditional validation', () => {
    test('company must have registration number OR tax number', () => {
      const cluster = {
        merged: {
          name: 'Acme',
          entity_type: 'Pty Ltd',
          relationship: 'Client',
          // No registration_number, no tax_number
        },
      };
      const result = validateCluster(cluster);
      expect(result.warnings).toContainEqual(expect.objectContaining({field: 'registration_number'}));
    });
    
    test('individual must have ID number OR tax number', () => {
      const cluster = {
        merged: {
          name: 'John Doe',
          entity_type: 'Individual',
          relationship: 'Director',
          // No id_number, no tax_number
        },
      };
      const result = validateCluster(cluster);
      expect(result.warnings).toContainEqual(expect.objectContaining({field: 'id_number'}));
    });
  });
  
  describe('format validation', () => {
    test('validates SA ID format', () => {
      const cluster = {
        merged: {
          name: 'John',
          entity_type: 'Individual',
          relationship: 'Director',
          id_number: '123',  // Too short
        },
      };
      const result = validateCluster(cluster);
      expect(result.errors).toContainEqual(expect.objectContaining({field: 'id_number'}));
    });
    
    test('validates CIPC format', () => {
      const cluster = {
        merged: {
          name: 'Acme',
          entity_type: 'Pty Ltd',
          relationship: 'Client',
          registration_number: 'invalid',
        },
      };
      const result = validateCluster(cluster);
      expect(result.errors).toContainEqual(expect.objectContaining({field: 'registration_number'}));
    });
  });
});
```

**Coverage Target**: 90%+

---

### Module: `exporter/index.ts`

**Purpose**: ExcelJS template export with 86-field preservation.

**Test Cases**:

```typescript
describe('exporter/index.ts', () => {
  
  describe('template loading and validation', () => {
    test('loads canonical template file', async () => {
      const result = await exportToExcel([], templatePath);
      expect(result).toBeDefined();  // Buffer
    });
    
    test('asserts 86 columns in template', async () => {
      // After loading template, verify it has 86 columns
      const result = await exportToExcel([], templatePath);
      // Parse result, count columns
      expect(columnCount).toBe(86);
    });
  });
  
  describe('data writing', () => {
    test('writes cluster data starting at row 3', async () => {
      const clusters = [{merged: {name: 'Acme', entity_type: 'Pty Ltd'}}];
      const result = await exportToExcel(clusters, templatePath);
      // Parse result, verify data at row 3
      expect(worksheet.getRow(3).values[1]).toBe('Acme');
    });
    
    test('writes all 86 fields in correct order', async () => {
      const cluster = {merged: SAMPLE_86_FIELD_DATA};
      const result = await exportToExcel([cluster], templatePath);
      // Verify column order matches 86-field schema
      FIELD_NAMES.forEach((field, index) => {
        expect(worksheet.getCell(3, index + 1).value).toBeDefined();
      });
    });
    
    test('filters archived records', async () => {
      const clusters = [
        {id: '1', archived: false, merged: {name: 'Active'}},
        {id: '2', archived: true, merged: {name: 'Archived'}},
      ];
      const result = await exportToExcel(clusters, templatePath);
      // Only 1 non-archived record should be in output
      expect(worksheet.lastRow.number).toBe(3);  // Header + 1 data row
    });
  });
  
  describe('dropdown preservation', () => {
    test('preserves x14 validations from template', async () => {
      const clusters = [{merged: {entity_type: 'Pty Ltd'}}];
      const result = await exportToExcel(clusters, templatePath);
      // Check that dataValidations still exist in output
      const xmlString = result.toString();
      expect(xmlString).toContain('x14:dataValidation');
    });
  });
  
  describe('value conversion', () => {
    test('converts boolean values to Excel format', async () => {
      const cluster = {merged: {is_active: true, is_international: false}};
      const result = await exportToExcel([cluster], templatePath);
      // Verify cell values
      expect(cellValue).toBe('Yes'); // or true, depending on template
    });
    
    test('converts dates to dd/mm/yyyy string', async () => {
      const cluster = {merged: {founded_date: '15/03/2024'}};
      const result = await exportToExcel([cluster], templatePath);
      expect(cellValue).toBe('15/03/2024');
    });
  });
});
```

**Coverage Target**: 90%+

---

## Integration Tests

### Full Pipeline End-to-End

**Scenario**: Import 3 source files (Sage, CIPC, SARS), complete pipeline, export valid .xlsx.

```typescript
describe('Integration: Full Pipeline', () => {
  
  test('complete flow: upload → map → dedup → review → export', async () => {
    // 1. Create session
    const session = await createSession('Test Firm', 'clerk@firm.com');
    expect(session.id).toBeDefined();
    expect(session.status).toBe('Importing');
    
    // 2. Upload 3 files
    const sageFile = readFixture('sage-export-50-clients.csv');
    const cipcFile = readFixture('cipc-extract-50-companies.xlsx');
    const sarsFile = readFixture('sars-list-50-entities.csv');
    
    const sageUpload = await uploadFile(session.id, sageFile, 'sage');
    const cipcUpload = await uploadFile(session.id, cipcFile, 'cipc');
    const sarsUpload = await uploadFile(session.id, sarsFile, 'sars');
    
    expect(sageUpload.detected_columns.length).toBeGreaterThan(0);
    
    // 3. Auto-map headers
    const sageMapping = autoMap(sageFile.headers);
    expect(sageMapping['Client Name'].mapped_to).toBe('name');
    
    // 4. Confirm mappings
    await confirmMappings(session.id, [sageUpload.id, cipcUpload.id, sarsUpload.id]);
    
    // Trigger normalization and dedup
    const dedupSuggestions = await getDedupSuggestions(session.id);
    
    // 5. Review and confirm dedup
    const approvedMatches = dedupSuggestions.slice(0, 5).map(s => ({
      cluster1Id: s.c1,
      cluster2Id: s.c2,
      keep: s.c1,
    }));
    await applyNameMatches(session.id, approvedMatches, []);
    
    // 6. Validate and review
    const clusters = await getClusters(session.id);
    expect(clusters.length).toBeGreaterThan(30);  // Some merges
    expect(clusters.length).toBeLessThan(150);  // Not all separate
    
    const validationReport = await validateClusters(session.id);
    expect(validationReport.hardErrors).toHaveLength(0);
    expect(validationReport.warnings.length).toBeLessThan(10);
    
    // 7. Export
    const buffer = await exportToExcel(session.id);
    expect(buffer).toBeDefined();
    
    // 8. Verify .xlsx
    const workbook = await ExcelJS.Workbook.read(buffer);
    const worksheet = workbook.getWorksheet(1);
    expect(worksheet.columnCount).toBe(86);
    expect(worksheet.rowCount).toBeGreaterThan(30);
  });
});
```

---

### Incremental Import Scenario

**Scenario**: Upload file 1, export → then upload file 2, detect conflicts.

```typescript
test('incremental import: upload file 2 → detect conflicts → preserve edits', async () => {
  // ... setup session, upload file 1, export v1 ...
  
  const version1 = await exportExcel(session.id);
  
  // Operator manually edits one record
  await editCluster(clusters[0].id, 'name', 'Manually Corrected Name');
  
  // ... time passes, new data available ...
  
  // Upload file 2 with same company (different source)
  const file2 = readFixture('sage-new-export.csv');
  const upload2 = await uploadFile(session.id, file2, 'sage');
  
  // System processes incremental import
  const conflicts = await getConflicts(session.id);
  
  // Should detect conflict on 'name' field
  expect(conflicts).toContainEqual(
    expect.objectContaining({
      field: 'name',
      oldValue: 'Manually Corrected Name',
      newValue: 'Different Name from Sage',
    })
  );
  
  // Verify manual edit is preserved
  const cluster = await getCluster(clusters[0].id);
  expect(cluster.merged.name).toBe('Manually Corrected Name');  // Manual override wins
});
```

---

## Edge Case Tests

### SA ID Validation Edge Cases

```typescript
test('SA ID: 12-digit with leading zero recovery', async () => {
  // File has: 801015800183 (12 digits)
  const normalized = normalizeSaId('801015800183');
  expect(normalized).toBe('0801015800183');
  
  const valid = validateSaId('0801015800183');
  expect(valid).toBe(true);
});

test('SA ID: pre-1900 birth date allowed', async () => {
  // ID: 0001015800183 (born 1900-01-01)
  // This is very old but legitimate for historical records
  const valid = validateSaId('0001015800183');
  expect(valid).toBe(true);
});

test('SA ID: foreign national (not 13 digits)', async () => {
  // Passport: AB12345678 (10 chars)
  const valid = validateSaId('AB12345678');
  expect(valid).toBe(false);  // Not SA ID format
});
```

### CIPC Validation Edge Cases

```typescript
test('CIPC: unformatted to formatted', async () => {
  const unformatted = '201812345607';
  const formatted = normalizeCipc(unformatted);
  expect(formatted).toBe('2018/123456/07');
  
  const valid = validateCipc(formatted);
  expect(valid).toBe(true);
});

test('CIPC: handles various separators', async () => {
  // Some files have spaces, hyphens, etc.
  expect(normalizeCipc('2018 123456 07', {autoFix: true})).toBe('2018/123456/07');
  expect(normalizeCipc('2018-123456-07', {autoFix: true})).toBe('2018/123456/07');
});

test('CIPC: rejects invalid year', async () => {
  const valid = validateCipc('9999/123456/07');
  expect(valid).toBe(false);
});
```

### File Encoding Edge Cases

```typescript
test('Windows-1252 encoded CSV with accented characters', async () => {
  // File: Frédéric, Müller, Côté
  const file = readFixture('windows-1252-accents.csv');
  const result = validateUpload(file);
  expect(result.encoding).toMatch(/1252/i);
  
  const parsed = parseFile(file, result.encoding);
  expect(parsed[0].name).toBe('Frédéric');
});

test('Password-protected Excel file', async () => {
  const file = readFixture('password-protected.xlsx');
  const result = validateUpload(file);
  expect(result.valid).toBe(false);
  expect(result.error).toContain('password');
});

test('Empty file or headers-only', async () => {
  const file = new File(['Name,Entity Type'], 'headers.csv');
  const parsed = parseFile(file);
  expect(parsed.length).toBe(0);  // No data rows
});
```

### Large Export Performance

```typescript
test('500+ client export preserves dropdowns and completes in <10 sec', async () => {
  const clusters = Array(500).fill(null).map((_, i) => ({
    id: `c${i}`,
    merged: {
      name: `Client ${i}`,
      entity_type: 'Pty Ltd',
      // ... all 86 fields ...
    },
  }));
  
  const start = Date.now();
  const buffer = await exportToExcel(clusters, templatePath);
  const elapsed = Date.now() - start;
  
  expect(buffer).toBeDefined();
  expect(elapsed).toBeLessThan(10000);  // 10 seconds
  
  // Verify dropdowns still present
  const xmlString = buffer.toString('utf8');
  expect(xmlString).toContain('x14:dataValidation');
});
```

### Afrikaans File Headers

```typescript
test('Afrikaans headers mapped correctly', async () => {
  const headers = [
    'Kliënt Naam',
    'Entiteit Tipe',
    'Registrasie Nommer',
    'Belastingnommer',
    'BTW Nommer',
    'Belastingjaar',
  ];
  
  const mapping = mapHeaders(headers);
  expect(mapping['Kliënt Naam'].mapped_to).toBe('name');
  expect(mapping['Entiteit Tipe'].mapped_to).toBe('entity_type');
  expect(mapping['Belastingnommer'].mapped_to).toBe('tax_number');
  expect(mapping['BTW Nommer'].mapped_to).toBe('vat_number');
});
```

### Duplicate Session Detection

```typescript
test('warn when creating session with same firm name', async () => {
  const session1 = await createSession('Acme Accounting', 'clerk1@firm.com');
  
  // Try to create another session with same firm name
  const warning = await checkDuplicateFirm('Acme Accounting');
  expect(warning.isDuplicate).toBe(true);
  expect(warning.existingSession).toBe(session1.id);
});
```

---

## Performance Tests

### Parse Large File

```typescript
test('parse 10MB CSV in <5 seconds (client-side SheetJS)', async () => {
  const largeFile = generateCsvFile(100000); // 100k rows
  const start = Date.now();
  const data = await parseFileInBrowser(largeFile);
  const elapsed = Date.now() - start;
  
  expect(data.length).toBe(100000);
  expect(elapsed).toBeLessThan(5000);
});
```

### Validate Large Batch

```typescript
test('validate 1000 clusters in <2 seconds', async () => {
  const clusters = Array(1000).fill(null).map((_, i) => ({
    id: `c${i}`,
    merged: SAMPLE_DATA,
  }));
  
  const start = Date.now();
  const results = clusters.map(c => validateCluster(c));
  const elapsed = Date.now() - start;
  
  expect(elapsed).toBeLessThan(2000);
});
```

### Virtual Scroll Performance

```typescript
test('virtual scroll 500+ clients smoothly (60 FPS)', async () => {
  const clients = Array(500).fill(null).map((_, i) => ({id: `c${i}`}));
  
  // Mount SidebarClients component
  const {container} = render(<SidebarClients clients={clients} />);
  
  // Scroll programmatically
  const frameData = measureFrameTime(() => {
    fireEvent.scroll(container, {y: 5000});
  });
  
  expect(frameData.avgFrameTime).toBeLessThan(16.67);  // 60 FPS
});
```

---

## Launch Checklist

### Pre-Launch QA

- [ ] **All unit tests passing**
  ```bash
  npm run test -- --coverage
  # Expect: 0 failures, >85% coverage
  ```

- [ ] **Integration test with real firm data**
  - Use data from 3 real firms (with consent)
  - Complete full pipeline: import → map → dedup → review → export
  - Verify exported .xlsx matches expectations

- [ ] **TypeScript compilation**
  ```bash
  tsc --noEmit
  # Expect: 0 errors, 0 warnings
  ```

- [ ] **Production build**
  ```bash
  npm run build
  # Expect: success, no warnings
  ```

- [ ] **Operator UAT signed off**
  - Simz tests with real firm data
  - Sign-off document: "Ready for launch"

### Infrastructure

- [ ] **Supabase RLS policies verified**
  - Test that users can only access their firm's data
  - Service role can export without restrictions

- [ ] **Environment variables in Vercel**
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_KEY
  - Test with secret rotation

- [ ] **Database migration applied**
  - Run on Vercel/production Supabase
  - Verify all tables exist with correct schema
  - Indexes created

- [ ] **Supabase Storage bucket created** (if needed)
  - Name: "woza-la-exports"
  - RLS policy: users can only access own exports

- [ ] **Domain/SSL configured**
  - Custom domain (if applicable)
  - SSL certificate valid

### Monitoring & Support

- [ ] **Error monitoring set up** (Sentry or similar)
  - Alerts for critical errors
  - Error dashboards accessible

- [ ] **Backup strategy confirmed**
  - Supabase automated backups enabled
  - Recovery procedure documented
  - Test restore on dev environment

- [ ] **Logging configured**
  - Server-side: log all API calls, errors
  - Client-side: log user actions, errors
  - Retention: 30 days minimum

- [ ] **Training materials ready**
  - Quick start guide (1 page)
  - Video walkthrough (optional)
  - FAQ and troubleshooting

- [ ] **On-call support ready**
  - Simz + Developer available first 48 hours
  - Escalation path documented

### Export Validation

- [ ] **DataGrows import test**
  - Export sample dataset from Woza La
  - Import into DataGrows system
  - Verify: no errors, data integrity maintained

- [ ] **Excel file validation**
  - All 86 columns present and in correct order
  - Dropdown validations preserved
  - No corrupted cells

### Post-Launch Monitoring (First 30 Days)

- [ ] **Success metrics tracked**
  - Sessions created per day
  - Export success rate
  - Average pipeline duration
  - Error rates by stage

- [ ] **Bug reports collected and triaged**
  - Customer feedback channel active
  - Critical bugs fixed within 24 hours
  - Non-critical bugs queued for next sprint

- [ ] **Performance baselines established**
  - Parse 10MB file: <5 sec
  - Export 500 clients: <10 sec
  - API response time: <2 sec

- [ ] **User feedback collected**
  - Survey: "How easy was the pipeline?" (1-5)
  - NPS question
  - Feature requests logged

---

## Deployment Steps

### Vercel Deployment

1. **Connect GitHub repo**
   ```bash
   vercel link
   ```

2. **Set environment variables**
   ```bash
   vercel env add SUPABASE_URL
   vercel env add SUPABASE_ANON_KEY
   vercel env add SUPABASE_SERVICE_KEY
   ```

3. **Deploy preview**
   ```bash
   vercel --prod
   # Test at https://[project].vercel.app
   ```

4. **Run smoke tests**
   - Open app in browser
   - Create new session
   - Upload test file
   - Verify no console errors

5. **Deploy to production**
   ```bash
   vercel --prod --confirm
   ```

### Supabase Production Setup

1. **Create production project** (if separate from dev)
2. **Run migrations**
   ```bash
   supabase db push --db-url postgresql://...
   ```
3. **Enable RLS on all tables**
4. **Create storage bucket** (if needed)
5. **Verify backups enabled**

---

## Rollback Plan

If critical issues found post-launch:

1. **Immediate**: Rollback Vercel to previous working commit
   ```bash
   vercel rollback
   ```

2. **Notify users**: Email to all operator accounts
3. **Investigate**: Review error logs, collect user reports
4. **Fix**: Patch issue, test thoroughly
5. **Re-deploy**: Once confidence regained
6. **Post-mortem**: Document what went wrong, prevent future occurrence

---

## Success Definition

Launch is successful when:

1. ✅ First operator completes full pipeline without errors
2. ✅ Export validated by DataGrows system
3. ✅ No critical bugs found in first 24 hours
4. ✅ System handles 10+ concurrent sessions
5. ✅ Average pipeline time: <30 minutes for 100 clients
6. ✅ Export success rate: >99%
7. ✅ Error rate: <1%

