import * as XLSX from 'xlsx';

/**
 * Represents the result of file validation before import.
 */
export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  encoding: string;
  rowCount: number;
  headerRow: string[];
}

/**
 * Detects the encoding of a file buffer.
 * Checks for UTF-8 BOM, attempts UTF-8 decoding, and looks for Windows-1252 signatures
 * (including Afrikaans characters: ë, ö, ü).
 *
 * @param buffer - ArrayBuffer containing file data
 * @returns Detected encoding: 'utf-8' or 'windows-1252'
 */
export function detectEncoding(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // Check for UTF-8 BOM (0xEF 0xBB 0xBF)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }

  // Try to decode as UTF-8
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buffer);
    return 'utf-8';
  } catch {
    // UTF-8 decoding failed, continue
  }

  // Look for Windows-1252 signature bytes (0x80-0x9F range)
  // These are valid in Windows-1252 but invalid in UTF-8
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte >= 0x80 && byte <= 0x9f) {
      return 'windows-1252';
    }
  }

  // Look for common Afrikaans byte patterns in Windows-1252
  // ë = 0xEB, ö = 0xF6, ü = 0xFC, Ë = 0xCB, Ö = 0xD6, Ü = 0xDC
  const afrikaansPatterns = [0xeb, 0xf6, 0xfc, 0xcb, 0xd6, 0xdc];
  for (const byte of bytes) {
    if (afrikaansPatterns.includes(byte)) {
      return 'windows-1252';
    }
  }

  // Default to UTF-8
  return 'utf-8';
}

/**
 * Decodes a buffer to UTF-8 string using the specified encoding.
 *
 * @param buffer - ArrayBuffer containing file data
 * @param encoding - Source encoding ('utf-8' or 'windows-1252')
 * @returns Decoded UTF-8 string
 */
export function decodeToUTF8(buffer: ArrayBuffer, encoding: string): string {
  const bytes = new Uint8Array(buffer);

  if (encoding === 'windows-1252') {
    // Decode Windows-1252 to UTF-8
    // Windows-1252 mapping for bytes 0x80-0x9F and 0xA0-0xFF
    const win1252Map: Record<number, string> = {
      0x80: '\u20ac', // €
      0x81: '\u0081',
      0x82: '\u201a', // ‚
      0x83: '\u0192', // ƒ
      0x84: '\u201e', // „
      0x85: '\u2026', // …
      0x86: '\u2020', // †
      0x87: '\u2021', // ‡
      0x88: '\u02c6', // ˆ
      0x89: '\u2030', // ‰
      0x8a: '\u0160', // Š
      0x8b: '\u2039', // ‹
      0x8c: '\u0152', // Œ
      0x8d: '\u008d',
      0x8e: '\u017d', // Ž
      0x8f: '\u008f',
      0x90: '\u0090',
      0x91: '\u2018', // '
      0x92: '\u2019', // '
      0x93: '\u201c', // "
      0x94: '\u201d', // "
      0x95: '\u2022', // •
      0x96: '\u2013', // –
      0x97: '\u2014', // —
      0x98: '\u02dc', // ˜
      0x99: '\u2122', // ™
      0x9a: '\u0161', // š
      0x9b: '\u203a', // ›
      0x9c: '\u0153', // œ
      0x9d: '\u009d',
      0x9e: '\u017e', // ž
      0x9f: '\u0178', // Ÿ
    };

    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte in win1252Map) {
        result += win1252Map[byte];
      } else if (byte < 0x80) {
        result += String.fromCharCode(byte);
      } else {
        // 0xA0-0xFF maps directly to Unicode 0xA0-0xFF in Windows-1252
        result += String.fromCharCode(byte);
      }
    }
    return result;
  }

  // Default UTF-8 decoding
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(buffer);
}

/**
 * Validates a file before import, checking size, format, parseability, and encoding.
 * Implements spec section 13.1 pre-validation.
 *
 * @param file - File object to validate
 * @returns FileValidationResult with validation status and metadata
 */
export async function validateFilePreImport(file: File): Promise<FileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let encoding = 'utf-8';
  let rowCount = 0;
  let headerRow: string[] = [];

  // Validate file size (≤ 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    errors.push(`File size exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
  }

  // Validate extension
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!validExtensions.includes(fileExt)) {
    errors.push(`Invalid file extension: ${fileExt}. Expected: .xlsx, .xls, or .csv`);
  }

  // If size is acceptable, attempt to read and parse
  if (errors.length === 0) {
    try {
      const arrayBuffer = await file.arrayBuffer();

      // Detect encoding
      encoding = detectEncoding(arrayBuffer);
      if (encoding === 'windows-1252') {
        warnings.push('File detected as Windows-1252 encoded (will be converted to UTF-8)');
      }

      // Decode to UTF-8
      const content = decodeToUTF8(arrayBuffer, encoding);

      // Try to parse with SheetJS
      const workbook = XLSX.read(content, {
        type: 'string',
        cellFormula: false,
        cellStyles: false,
      });

      if (workbook.SheetNames.length === 0) {
        errors.push('Workbook contains no sheets');
      } else {
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

        rowCount = data.length;

        // Validate structure: at least 1 header row and 1 data row
        if (data.length === 0) {
          errors.push('Sheet must contain at least 1 header row and 1 data row');
        } else if (data.length === 1) {
          warnings.push('Sheet contains only 1 data row (header + 1 row)');
          headerRow = Object.keys(data[0]);
        } else {
          headerRow = Object.keys(data[0]);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`File parsing failed: ${errorMsg}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    encoding,
    rowCount,
    headerRow,
  };
}
