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
import { validateRecord } from '../validator';

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
  /** Records to include. Archived and errored records are skipped automatically. */
  records: ClientRecord[];
  /** Whether to also clear the row-2 instructions row (DataGrows says to). */
  stripInstructions?: boolean;
}

export interface ExportResult {
  rowsWritten: number;
  skippedArchived: number;
  skippedErrors: number;
  outputPath?: string;
  buffer: Buffer;
}

export async function exportToDataGrowsTemplate(opts: ExportOptions): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const sheet = wb.getWorksheet('CLIENT IMPORT');
  if (!sheet) throw new Error('CLIENT IMPORT sheet not found in template');

  // Skip archived records
  const nonArchived = opts.records.filter((r) => !r._archived);
  const skippedArchived = opts.records.length - nonArchived.length;

  // Skip records with blocking validation errors — write only clean ones
  const records: ClientRecord[] = [];
  let skippedErrors = 0;
  for (const r of nonArchived) {
    const v = validateRecord(r);
    if (v.ok) {
      records.push(r);
    } else {
      skippedErrors++;
    }
  }

  records.forEach((record, idx) => {
    const rowNum = DATA_START_ROW + idx;
    DATAGROWS_FIELDS.forEach((field) => {
      const value = (record as Record<string, unknown>)[field.key];
      const cell = sheet.getCell(`${field.col}${rowNum}`);
      cell.value = cellValueFor(value);
      // Date fields must stay as plain text — if Excel interprets them as date
      // serials the dd/mm/yyyy format breaks when the file is reopened.
      if (field.type === 'date' && value) {
        cell.numFmt = '@'; // '@' = force text, Excel will never reformat it
      }
    });
  });

  // ── Tips & Formats sheet: populate the Accountant dropdown list ────────────
  // The "TIPS & FORMATS" sheet has a single "Accountant (As per Datagrows)"
  // column (col 4). DataGrows uses this list as the dropdown source for every
  // staff-role field (Partner, Manager, Accountant, Accounting Role, etc.) in
  // the CLIENT IMPORT sheet. All unique staff names — regardless of role —
  // must appear here for the dropdowns to work.
  const tipsSheet = wb.getWorksheet('TIPS & FORMATS') ?? wb.getWorksheet('Tips & Formats');
  if (tipsSheet) {
    const STAFF_KEYS = [
      'accountant', 'partner', 'manager',
      'accounting_role', 'cipc_role', 'financials_role', 'hr_role', 'tax_role',
    ];

    // Collect every unique staff name across all roles and all records
    const allStaffNames = [
      ...new Set(
        records.flatMap((r) =>
          STAFF_KEYS.map((k) => String((r as Record<string, unknown>)[k] ?? '').trim()),
        ).filter(Boolean),
      ),
    ];

    if (allStaffNames.length > 0) {
      // The accountant dropdown column is column 4 in TIPS & FORMATS.
      // Find the header row first (row 1 by convention), then write names below
      // any existing entries so we never overwrite content already in the template.
      const ACCOUNTANT_COL = 4;
      let nextRow = 2; // row 1 = header; start checking from row 2
      while (tipsSheet.getCell(nextRow, ACCOUNTANT_COL).value) nextRow++;

      // Only add names that aren't already listed
      const existing = new Set<string>();
      for (let r = 2; r < nextRow; r++) {
        const v = String(tipsSheet.getCell(r, ACCOUNTANT_COL).value ?? '').trim();
        if (v) existing.add(v.toLowerCase());
      }

      for (const name of allStaffNames) {
        if (!existing.has(name.toLowerCase())) {
          tipsSheet.getCell(nextRow, ACCOUNTANT_COL).value = name;
          existing.add(name.toLowerCase());
          nextRow++;
        }
      }
    }
  }

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
    skippedErrors,
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
