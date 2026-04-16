/**
 * Export layer.
 *
 * Loads the canonical DataGrows template (public/datagrows_canonical_template.xlsx),
 * injects N rows starting at row 3, saves the result.
 *
 * Uses ExcelJS (SERVER-ONLY) so we preserve x14 data validations, styles,
 * merged cells, and the hidden dropdown sheets. This code MUST run in a Node
 * environment (Next.js API route), not in the browser.
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { DATAGROWS_FIELDS, type ClientRecord } from '../schema/datagrows';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'public',
  'datagrows_canonical_template.xlsx',
);

const DATA_START_ROW = 3; // Row 1 = headers, Row 2 = instructions

/**
 * Convert a canonical value to the cell value ExcelJS should write.
 * Dates stay as literal strings (dd/mm/yyyy), booleans become TRUE/FALSE.
 */
function cellValueFor(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  return String(value);
}

export interface ExportOptions {
  /** Where to write the output file. If omitted, returns a buffer only. */
  outputPath?: string;
  /** Records to include (archived records are skipped automatically) */
  records: ClientRecord[];
  /** Whether to also delete the row-2 instructions row (DataGrows says to) */
  stripInstructions?: boolean;
}

export async function exportToDataGrowsTemplate(opts: ExportOptions): Promise<{
  rowsWritten: number;
  skippedArchived: number;
  outputPath?: string;
  buffer: Buffer;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const sheet = wb.getWorksheet('CLIENT IMPORT');
  if (!sheet) throw new Error('CLIENT IMPORT sheet not found in template');

  const records = opts.records.filter((r) => !r._archived);
  const skippedArchived = opts.records.length - records.length;

  records.forEach((record, idx) => {
    const rowNum = DATA_START_ROW + idx;
    DATAGROWS_FIELDS.forEach((field) => {
      const value = (record as Record<string, unknown>)[field.key];
      const cell = sheet.getCell(`${field.col}${rowNum}`);
      cell.value = cellValueFor(value);
    });
  });

  if (opts.stripInstructions) {
    // Clear row 2 content — but don't delete the row (preserves data validations)
    const instructionsRow = sheet.getRow(2);
    instructionsRow.eachCell((cell) => { cell.value = null; });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

  if (opts.outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(opts.outputPath, buffer);
  }

  return {
    rowsWritten: records.length,
    skippedArchived,
    outputPath: opts.outputPath,
    buffer,
  };
}

/**
 * Export the "Archived — Needs Firm Follow-up" report.
 * This is NOT the DataGrows template — it's a plain listing of what we
 * couldn't onboard and why, for the clerk to send back to the firm.
 */
export async function exportArchiveReport(opts: {
  outputPath?: string;
  records: ClientRecord[];
}): Promise<{ rows: number; outputPath?: string; buffer: Buffer }> {
  const archived = opts.records.filter((r) => r._archived);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Archived Clients');

  ws.columns = [
    { header: 'Client Name (raw)', key: 'name', width: 40 },
    { header: 'Entity Type', key: 'entity_type', width: 18 },
    { header: 'Sources', key: 'sources', width: 22 },
    { header: 'Reason Archived', key: 'reason', width: 60 },
  ];

  ws.getRow(1).font = { bold: true };

  archived.forEach((r) => {
    ws.addRow({
      name: r.client_name ?? '',
      entity_type: r.entity_type ?? '',
      sources: (r._sources ?? []).join(', '),
      reason: r._archive_reason ?? '',
    });
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer as ArrayBuffer);

  if (opts.outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(opts.outputPath, buffer);
  }

  return { rows: archived.length, outputPath: opts.outputPath, buffer };
}
