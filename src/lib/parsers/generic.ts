/**
 * Generic spreadsheet parser.
 *
 * Reads Sage/Xero/SARS/CIPC/manual Excel files into raw rows and detected
 * columns. The clerk then maps the detected columns onto DataGrows canonical
 * fields using the column-mapping UI (clientMappingHeuristics.ts provides
 * sensible defaults).
 *
 * Runs client-side in the browser using SheetJS (xlsx).
 */

import * as XLSX from 'xlsx';

export interface ParsedSheet {
  /** Name of the sheet in the workbook */
  sheetName: string;
  /** Column headers as they appeared in row 1 */
  detectedColumns: string[];
  /** Raw rows as arrays of [header -> value] objects */
  rows: Record<string, unknown>[];
}

export interface ParsedFile {
  fileName: string;
  sheets: ParsedSheet[];
  /** The "best" sheet — the one with the most populated cells */
  primarySheetName: string;
}

/** Parse an ArrayBuffer (from a FileReader or Supabase download) into sheets. */
export function parseWorkbook(
  buffer: ArrayBuffer,
  fileName: string,
): ParsedFile {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  const sheets: ParsedSheet[] = wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    // Read as array-of-arrays first so we can detect the real header row
    // (some Sage/Xero exports put metadata in rows 1-3 before headers).
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    const headerRowIdx = detectHeaderRow(matrix);
    const headers = (matrix[headerRowIdx] ?? []).map((h, i) =>
      String(h ?? '').trim() || `Column_${i + 1}`,
    );

    const dataRows = matrix.slice(headerRowIdx + 1);
    const rows = dataRows
      .filter((r) => r.some((cell) => cell !== '' && cell !== null && cell !== undefined))
      .map((r) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => { obj[h] = r[i]; });
        return obj;
      });

    return { sheetName, detectedColumns: headers, rows };
  });

  const primary = sheets
    .slice()
    .sort((a, b) => b.rows.length - a.rows.length)[0];

  return {
    fileName,
    sheets,
    primarySheetName: primary?.sheetName ?? sheets[0]?.sheetName ?? '',
  };
}

/**
 * Best-guess at which row in the matrix is the header row.
 * Sage and Xero sometimes put a title or report metadata in row 1-3.
 * We pick the first row where most cells are strings (not numbers/blanks).
 */
function detectHeaderRow(matrix: unknown[][]): number {
  const maxScan = Math.min(matrix.length, 10);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] ?? [];
    if (row.length < 2) continue;
    const filled = row.filter((c) => c !== '' && c !== null && c !== undefined);
    if (filled.length === 0) continue;
    const stringRatio = filled.filter((c) => typeof c === 'string').length / filled.length;
    const score = filled.length * stringRatio;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}
