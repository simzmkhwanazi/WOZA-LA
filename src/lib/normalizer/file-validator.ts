/**
 * Pre-import file validation.
 *
 * Checks file size, extension, and attempts encoding detection.
 * Called before handing the file to SheetJS.
 */

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ROW_COUNT = 10_000;
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsm', '.csv']);

export interface FileValidationResult {
  valid: boolean;
  encoding: 'utf-8' | 'windows-1252' | 'unknown';
  error?: string;
  warnings?: string[];
}

/**
 * Detect likely encoding from the first few bytes.
 * Windows-1252 files from SA accounting software often contain bytes
 * in the 0x80-0x9F range that are invalid in UTF-8.
 */
function detectEncoding(bytes: Uint8Array): 'utf-8' | 'windows-1252' | 'unknown' {
  // BOM check — UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';

  // Scan first 4 KB for bytes typical of Windows-1252 (0x80-0x9F range)
  const sample = bytes.slice(0, 4096);
  let win1252Hits = 0;
  let utf8Invalid = 0;

  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b >= 0x80 && b <= 0x9f) {
      // These bytes are valid in Windows-1252 (smart quotes, em-dash, etc.)
      // but are control chars in Unicode — strong signal for Windows-1252
      win1252Hits++;
    } else if (b >= 0x80) {
      // Check if this starts a valid UTF-8 multi-byte sequence
      if ((b & 0xe0) === 0xc0 && i + 1 < sample.length && (sample[i + 1] & 0xc0) === 0x80) {
        i++; // valid 2-byte UTF-8
      } else if ((b & 0xf0) === 0xe0 && i + 2 < sample.length &&
                 (sample[i + 1] & 0xc0) === 0x80 && (sample[i + 2] & 0xc0) === 0x80) {
        i += 2; // valid 3-byte UTF-8
      } else {
        utf8Invalid++;
      }
    }
  }

  if (win1252Hits > 0 || utf8Invalid > 2) return 'windows-1252';
  return 'utf-8';
}

/**
 * Validate a File object before parsing. Returns encoding hint for
 * the caller to pass to SheetJS (codepage option).
 */
export async function validateUpload(file: File): Promise<FileValidationResult> {
  const warnings: string[] = [];

  // Extension check
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      encoding: 'unknown',
      error: `Unsupported file type "${ext}". Allowed: .xlsx, .xls, .xlsm, .csv`,
    };
  }

  // Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      encoding: 'unknown',
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`,
    };
  }

  // Encoding detection (CSV only — xlsx is binary/zipped)
  let encoding: FileValidationResult['encoding'] = 'utf-8';
  if (ext === '.csv') {
    const slice = file.slice(0, 8192);
    const buf = await slice.arrayBuffer();
    encoding = detectEncoding(new Uint8Array(buf));
    if (encoding === 'windows-1252') {
      warnings.push(
        'File appears to be Windows-1252 encoded (common from Sage/Pastel). ' +
        'Characters will be decoded automatically.',
      );
    }
  }

  return { valid: true, encoding, warnings: warnings.length ? warnings : undefined };
}

/**
 * Validate row count after parsing. Returns a warning if too many rows.
 */
export function validateRowCount(count: number): { ok: boolean; warning?: string } {
  if (count > MAX_ROW_COUNT) {
    return {
      ok: false,
      warning: `File has ${count.toLocaleString()} rows — exceeds the ${MAX_ROW_COUNT.toLocaleString()} row limit. ` +
               'Split the file and import in batches.',
    };
  }
  return { ok: true };
}
