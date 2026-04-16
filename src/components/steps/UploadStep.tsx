'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseWorkbook } from '@/lib/parsers/generic';
import type { SourceType } from '@/lib/schema/sources';
import { SOURCE_LABELS } from '@/lib/schema/sources';

const SOURCE_OPTIONS: SourceType[] = ['company', 'sage', 'xero', 'sars', 'cipc', 'excel', 'employees'];

// 50 MB client-side guard — Supabase bucket is also set to 50 MB
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const SPREADSHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
];

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isSpreadsheet(file: File) {
  return (
    SPREADSHEET_TYPES.includes(file.type) ||
    /\.(xlsx|xls|csv)$/i.test(file.name)
  );
}

function fileTypeLabel(file: File) {
  if (isPdf(file)) return 'PDF';
  if (/\.csv$/i.test(file.name)) return 'CSV';
  return 'Excel';
}

interface UploadRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  row_count: number | null;
  detected_columns: string[] | null;
}

export function UploadStep({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>('company');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('uploads')
      .select('id, file_name, source_type, row_count, detected_columns')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    setUploads((data as UploadRow[]) ?? []);
  }, [sessionId, supabase]);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress('Uploading to storage…');

    try {
      const storagePath = `${sessionId}/${Date.now()}-${file.name}`;

      // Upload raw file to Supabase Storage
      const { error: upErr } = await supabase.storage
        .from('uploads')
        .upload(storagePath, file, { upsert: false });
      if (upErr) throw upErr;

      let rowCount: number | null = null;
      let detectedColumns: string[] | null = null;

      if (isSpreadsheet(file)) {
        setUploadProgress('Parsing spreadsheet…');
        const buffer = await file.arrayBuffer();
        const parsed = parseWorkbook(buffer, file.name);
        const primary = parsed.sheets.find((s) => s.sheetName === parsed.primarySheetName);

        if (primary) {
          rowCount = primary.rows.length;
          detectedColumns = primary.detectedColumns;

          // Insert raw_records in chunks of 500
          setUploadProgress('Saving records…');
          const { data: uploadRow, error: rowErr } = await supabase
            .from('uploads')
            .insert({
              session_id: sessionId,
              source_type: sourceType,
              file_name: file.name,
              storage_path: storagePath,
              row_count: rowCount,
              detected_columns: detectedColumns,
            })
            .select()
            .single();
          if (rowErr || !uploadRow) throw rowErr ?? new Error('Insert failed');

          const CHUNK = 500;
          for (let i = 0; i < primary.rows.length; i += CHUNK) {
            const chunk = primary.rows.slice(i, i + CHUNK).map((row, idx) => ({
              upload_id: uploadRow.id,
              row_index: i + idx,
              data: row,
            }));
            const { error: rawErr } = await supabase.from('raw_records').insert(chunk);
            if (rawErr) throw rawErr;
          }
        }
      } else if (isPdf(file)) {
        // PDFs are stored for reference only — no data extraction
        const { error: rowErr } = await supabase
          .from('uploads')
          .insert({
            session_id: sessionId,
            source_type: sourceType,
            file_name: file.name,
            storage_path: storagePath,
            row_count: null,
            detected_columns: null,
          });
        if (rowErr) throw rowErr;
      } else {
        throw new Error('Unsupported file type. Please upload .xlsx, .xls, .csv, or .pdf.');
      }

      await loadUploads();
      e.target.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Upload source files</h3>
        <p className="text-sm text-navy-500 mb-4">
          Upload each file the firm sent you. Tag it with the source so Woza La knows
          which hierarchy to apply when merging. Max 50 MB per file.
        </p>

        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium text-navy-700 mb-1">Source</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
              className="input"
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-navy-700 mb-1">
              File <span className="text-navy-400 font-normal">(.xlsx · .xls · .csv · .pdf)</span>
            </label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={handleFile}
              disabled={uploading}
              className="input"
            />
          </div>
        </div>

        {/* Context hints */}
        {sourceType === 'company' && (
          <p className="text-xs text-navy-400 mt-3 bg-navy-50 rounded-lg px-3 py-2">
            <strong className="text-navy-600">Company Details</strong> — upload the firm&apos;s own
            profile: registration certificate, letterhead, or a spreadsheet with company name,
            registration number, VAT number, PAYE number, address and contact details.
            PDFs are stored as reference documents; spreadsheets are fully parsed.
          </p>
        )}
        {sourceType === 'sars' && (
          <p className="text-xs text-navy-400 mt-3 bg-navy-50 rounded-lg px-3 py-2">
            <strong className="text-navy-600">SARS</strong> — tax certificates, eFiling exports, or
            a spreadsheet of tax numbers. PDFs are stored for reference.
          </p>
        )}
        {sourceType === 'cipc' && (
          <p className="text-xs text-navy-400 mt-3 bg-navy-50 rounded-lg px-3 py-2">
            <strong className="text-navy-600">CIPC</strong> — company registration certificates,
            annual return confirmations, or a CIPC data export. PDFs are stored for reference.
          </p>
        )}

        {uploading && (
          <p className="text-sm text-teal-700 mt-3 flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-teal border-t-transparent rounded-full animate-spin" />
            {uploadProgress || 'Uploading…'}
          </p>
        )}
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-navy-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-navy-700">Uploaded files ({uploads.length})</h3>
          {uploads.some(u => u.row_count === null && u.detected_columns === null) && (
            <span className="text-xs text-navy-400">PDFs stored as reference — no data extracted</span>
          )}
        </div>
        {uploads.length === 0 ? (
          <p className="px-6 py-8 text-sm text-navy-500 text-center">No uploads yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-600">
              <tr>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Rows</th>
                <th className="px-4 py-2 font-medium">Columns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {uploads.map((u) => {
                const isPdfFile = u.file_name.toLowerCase().endsWith('.pdf');
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-2 font-medium text-navy-800">{u.file_name}</td>
                    <td className="px-4 py-2">
                      <span className="badge badge-muted">{SOURCE_LABELS[u.source_type]}</span>
                    </td>
                    <td className="px-4 py-2 text-navy-400 text-xs uppercase tracking-wide">
                      {isPdfFile ? 'PDF' : u.file_name.split('.').pop()?.toUpperCase() ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      {isPdfFile
                        ? <span className="text-navy-400 text-xs">ref only</span>
                        : (u.row_count ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-navy-500">
                      {isPdfFile
                        ? '—'
                        : `${u.detected_columns?.length ?? 0} detected`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
