import { Workbook } from 'exceljs';
import path from 'node:path';
import { DATAGROWS_FIELDS, type ClientRecord } from '../schema/datagrows';

const TEMPLATE_PATH = path.join(process.cwd(), 'public', 'datagrows_canonical_template.xlsx');
const DATA_START_ROW = 3; // Row 1 = headers, Row 2 = instructions

/**
 * Converts Excel column letters to 0-based index.
 * A=0, B=1, ..., Z=25, AA=26, ..., CH=85
 *
 * @param col - Excel column letters (e.g., 'A', 'AA', 'CH')
 * @returns 0-based column index
 */
export function colToIndex(col: string): number {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return index - 1;
}

/**
 * Converts 0-based column index to Excel column letters.
 * 0=A, 1=B, ..., 25=Z, 26=AA, ..., 85=CH
 *
 * @param index - 0-based column index
 * @returns Excel column letters
 */
export function indexToCol(index: number): string {
  let col = '';
  let num = index + 1;
  while (num > 0) {
    const remainder = (num - 1) % 26;
    col = String.fromCharCode('A'.charCodeAt(0) + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}

/**
 * Validates the DataGrows template structure.
 * Asserts that there are exactly 86 fields and column mapping is correct.
 *
 * @throws Error if validation fails
 */
export function validateTemplateStructure(): void {
  // Assert 86 fields
  if (DATAGROWS_FIELDS.length !== 86) {
    throw new Error(
      `Expected 86 DataGrows fields, but found ${DATAGROWS_FIELDS.length}. Template may be out of sync.`
    );
  }

  // Validate column mapping
  const seenCols = new Set<number>();
  for (let i = 0; i < DATAGROWS_FIELDS.length; i++) {
    const field = DATAGROWS_FIELDS[i];
    const expectedIndex = i;
    const actualIndex = colToIndex(field.col);

    if (actualIndex !== expectedIndex) {
      throw new Error(
        `Field ${i} ("${field.key}") mapped to column ${field.col} (index ${actualIndex}), expected column ${indexToCol(expectedIndex)} (index ${expectedIndex})`
      );
    }

    if (seenCols.has(actualIndex)) {
      throw new Error(`Duplicate column mapping detected: ${field.col} appears multiple times`);
    }
    seenCols.add(actualIndex);
  }

  // Verify columns are sequential A-CH
  const expectedColumns = new Set<number>();
  for (let i = 0; i < 86; i++) {
    expectedColumns.add(i);
  }
  if (seenCols.size !== expectedColumns.size || ![...seenCols].every(c => expectedColumns.has(c))) {
    throw new Error('Column mapping is not sequential from A to CH');
  }
}

function cellValueFor(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  return String(value);
}

export interface ExportOptions {
  outputPath?: string;
  records: ClientRecord[];
  stripInstructions?: boolean;
}

/**
 * Exports records to DataGrows template format.
 * Loads the canonical template, writes records, and returns buffer.
 * Implements spec section 9.2 with hardening: 86-field assertion and column order validation.
 *
 * @param opts - Export options containing records, optional outputPath, and stripInstructions flag
 * @returns Promise resolving to object with rowsWritten, skippedArchived, outputPath, and buffer
 * @throws Error if template validation fails or template file not found
 */
export async function exportToDataGrowsTemplate(opts: ExportOptions): Promise<{
  rowsWritten: number;
  skippedArchived: number;
  outputPath?: string;
  buffer: Buffer;
}> {
  // Validate template structure BEFORE writing any data
  validateTemplateStructure();

  const wb = new Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const sheet = wb.getWorksheet('CLIENT IMPORT');
  if (!sheet) throw new Error('CLIENT IMPORT sheet not found');

  // Filter out archived records
  const records = opts.records.filter((r) => !r._archived);
  const skippedArchived = opts.records.length - records.length;

  // Write data rows (starting at row 3, which is DATA_START_ROW)
  records.forEach((record, idx) => {
    const rowNum = DATA_START_ROW + idx;
    DATAGROWS_FIELDS.forEach((field) => {
      const value = (record as Record<string, unknown>)[field.key];
      const cell = sheet.getCell(`${field.col}${rowNum}`);
      cell.value = cellValueFor(value);
    });
  });

  // Strip instructions row if requested
  if (opts.stripInstructions) {
    const instructionsRow = sheet.getRow(2);
    instructionsRow.eachCell((cell) => { cell.value = null; });
  }

  // Verification pass: read back row 3 and verify cell count
  if (records.length > 0) {
    const row3 = sheet.getRow(DATA_START_ROW);
    let cellCount = 0;
    for (let i = 1; i <= 86; i++) {
      if (row3.getCell(i).value !== null && row3.getCell(i).value !== undefined) {
        cellCount++;
      }
    }
    // Log verification info (in production, this could be stored)
    console.log(`Export verification: Row 3 has ${cellCount} populated cells out of 86 fields`);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

  if (opts.outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(opts.outputPath, buffer);
  }

  return { rowsWritten: records.length, skippedArchived, outputPath: opts.outputPath, buffer };
}

/**
 * Gets export metadata for tracking and auditing.
 *
 * @param records - Records being exported
 * @param version - Export version number
 * @returns Export metadata object
 */
export function getExportMetadata(
  records: ClientRecord[],
  version: number
): Record<string, unknown> {
  return {
    version,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    fieldCount: DATAGROWS_FIELDS.length,
    woZaLaVersion: process.env.APP_VERSION || 'unknown',
  };
}