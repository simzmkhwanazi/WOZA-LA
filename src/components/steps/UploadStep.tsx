'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseWorkbook } from '@/lib/parsers/generic';
import type { SourceType } from '@/lib/schema/sources';
import { SOURCE_LABELS } from '@/lib/schema/sources';

const SOURCE_OPTIONS = [
  { value: 'company',   label: 'Company Details' },
  { value: 'cipc',      label: 'CIPC' },
  { value: 'sars',      label: 'SARS' },
  { value: 'sage',      label: 'Sage' },
  { value: 'xero',      label: 'Xero' },
  { value: 'employees', label: 'Employee List' },
  { value: 'excel',     label: 'Manual Excel' },
] as const;

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

// ── Types ──────────────────────────────────────────────────────────────────────

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

interface UploadItem {
  id: string;
  file: File | null;
  source: string;           // free-text; normalised server-side before DB insert
  status: UploadStatus;
  progress: number;
  error?: string;
}

interface UploadedRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  source_raw: string | null;
  row_count: number | null;
  detected_columns: string[] | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function StatusBadge({ status }: { status: UploadStatus }) {
  if (status === 'idle') return <span className="text-navy-400 text-xs">Ready</span>;
  if (status === 'uploading') return (
    <span className="flex items-center gap-1 text-teal-700 text-xs">
      <span className="inline-block w-3 h-3 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
      Uploading…
    </span>
  );
  if (status === 'success') return <span className="text-emerald-600 text-xs font-medium">✓ Done</span>;
  return <span className="text-rose-600 text-xs font-medium">✗ Failed</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UploadStep({ sessionId, onProceed }: { sessionId: string; onProceed?: () => void }) {
  const supabase = createClient();

  // Queue of items to upload
  const [queue, setQueue] = useState<UploadItem[]>([
    { id: makeId(), file: null, source: 'company', status: 'idle', progress: 0 },
  ]);

  // Already-uploaded files shown in the table below
  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);

  // Whether any upload is in flight
  const [running, setRunning] = useState(false);

  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Load existing uploads ────────────────────────────────────────────────────

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('uploads')
      .select('id, file_name, source_type, source_raw, row_count, detected_columns')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    setUploaded((data as UploadedRow[]) ?? []);
  }, [sessionId, supabase]);

  async function deleteUpload(id: string) {
    setDeleting(id);
    await supabase.from('raw_records').delete().eq('upload_id', id);
    await supabase.from('uploads').delete().eq('id', id);
    setUploaded((prev) => prev.filter((u) => u.id !== id));
    setDeleting(null);
  }

  useEffect(() => { loadUploads(); }, [loadUploads]);

  // ── Queue management ─────────────────────────────────────────────────────────

  function addRow() {
    setQueue((q) => [...q, { id: makeId(), file: null, source: '', status: 'idle', progress: 0 }]);
  }

  function removeRow(id: string) {
    setQueue((q) => q.filter((item) => item.id !== id));
  }

  function setFile(id: string, file: File | null) {
    setQueue((q) => q.map((item) => item.id === id ? { ...item, file, error: undefined, status: 'idle' } : item));
  }

  function setSource(id: string, source: string) {
    setQueue((q) => q.map((item) => item.id === id ? { ...item, source } : item));
  }

  function patchItem(id: string, patch: Partial<UploadItem>) {
    setQueue((q) => q.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  // ── Single-file upload logic ─────────────────────────────────────────────────

  async function uploadOne(item: UploadItem): Promise<void> {
    if (!item.file) {
      patchItem(item.id, { status: 'error', error: 'No file selected' });
      return;
    }

    if (item.file.size > MAX_FILE_BYTES) {
      patchItem(item.id, {
        status: 'error',
        error: `File too large (${(item.file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`,
      });
      return;
    }

    if (!isPdf(item.file) && !isSpreadsheet(item.file)) {
      patchItem(item.id, { status: 'error', error: 'Unsupported file type. Use .xlsx, .xls, .csv, or .pdf.' });
      return;
    }

    patchItem(item.id, { status: 'uploading', progress: 5, error: undefined });

    try {
      // 1. Get a signed upload URL from the server
      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, fileName: item.file.name }),
      });
      const signData = await signRes.json() as { signedUrl?: string; token?: string; path?: string; error?: string };
      if (!signRes.ok) throw new Error(signData.error ?? 'Failed to get upload URL');

      const { token, path: storagePath } = signData as { signedUrl: string; token: string; path: string };

      patchItem(item.id, { progress: 20 });

      // 2. Upload file to storage using signed URL
      const { error: upErr } = await supabase.storage
        .from('uploads')
        .uploadToSignedUrl(storagePath, token, item.file, { upsert: false });
      if (upErr) throw upErr;

      patchItem(item.id, { progress: 60 });

      // 3. Parse spreadsheets client-side
      let rowCount: number | null = null;
      let detectedColumns: string[] | null = null;
      let rows: Record<string, unknown>[] | null = null;

      if (isSpreadsheet(item.file)) {
        const buffer = await item.file.arrayBuffer();
        const parsed = parseWorkbook(buffer, item.file.name);
        const primary = parsed.sheets.find((s) => s.sheetName === parsed.primarySheetName);
        if (primary) {
          rowCount = primary.rows.length;
          detectedColumns = primary.detectedColumns;
          rows = primary.rows;
        }
      }

      patchItem(item.id, { progress: 80 });

      // 4. Save metadata + records via server API
      const saveRes = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sourceType: item.source,
          fileName: item.file.name,
          storagePath,
          rowCount,
          detectedColumns,
          rows,
        }),
      });
      const saveData = await saveRes.json() as { uploadId?: string; error?: string };
      if (!saveRes.ok) throw new Error(saveData.error ?? 'Failed to save upload');

      patchItem(item.id, { status: 'success', progress: 100 });

      // Refresh the uploaded files table
      void loadUploads();

    } catch (err) {
      patchItem(item.id, {
        status: 'error',
        progress: 0,
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }

  // ── Upload All ────────────────────────────────────────────────────────────────

  async function uploadAll() {
    const pending = queue.filter((item) => item.file && item.status !== 'success');
    if (pending.length === 0) return;

    setRunning(true);
    // Mark all pending as queued/uploading visually before they start
    pending.forEach((item) => patchItem(item.id, { status: 'uploading', progress: 2 }));

    await Promise.allSettled(pending.map((item) => uploadOne(item)));
    setRunning(false);
  }

  // Retry a single failed item
  function retryOne(item: UploadItem) {
    patchItem(item.id, { status: 'idle', progress: 0, error: undefined });
    void uploadOne({ ...item, status: 'idle', progress: 0, error: undefined });
  }

  // ── Derived state ─────────────────────────────────────────────────────────────

  const hasPending = queue.some((item) => item.file && item.status !== 'success');
  const allDone = queue.every((item) => !item.file || item.status === 'success');

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Queue builder ───────────────────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Upload source files</h3>
        <p className="text-sm text-navy-500 mb-5">
          Add one row per file. Tag each with its source, then click <strong>Upload All Files</strong>
          to upload them in parallel. Max 50 MB per file.
        </p>

        <div className="space-y-2">
          {queue.map((item, idx) => (
            <div key={item.id} className={`border rounded-xl p-3 transition-colors ${
              item.status === 'success' ? 'border-emerald-200 bg-emerald-50' :
              item.status === 'error'   ? 'border-rose-200 bg-rose-50' :
              item.status === 'uploading' ? 'border-teal-200 bg-teal-50' :
              'border-gray-200 bg-white'
            }`}>
              <div className="flex items-center gap-3">
                {/* Row number */}
                <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0 font-medium">{idx + 1}.</span>

                {/* Source select */}
                <select
                  value={item.source}
                  onChange={(e) => setSource(item.id, e.target.value)}
                  disabled={item.status === 'uploading'}
                  className="input text-sm w-44 flex-shrink-0"
                >
                  <option value="">— Select source —</option>
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* File input */}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={(e) => setFile(item.id, e.target.files?.[0] ?? null)}
                  disabled={item.status === 'uploading'}
                  className="input text-sm flex-1 min-w-0"
                />

                {/* Status */}
                <div className="flex-shrink-0 flex items-center gap-2 min-w-[60px] justify-end">
                  <StatusBadge status={item.status} />
                  {item.status === 'error' && (
                    <button onClick={() => retryOne(item)} className="text-xs text-teal-700 underline">Retry</button>
                  )}
                </div>

                {/* Remove */}
                {item.status !== 'uploading' && queue.length > 1 && (
                  <button
                    onClick={() => removeRow(item.id)}
                    className="text-gray-300 hover:text-rose-500 transition-colors flex-shrink-0 text-xl leading-none"
                    title="Remove row"
                  >×</button>
                )}
              </div>

              {/* Progress bar */}
              {item.status === 'uploading' && (
                <div className="h-1 bg-teal-100 rounded-full overflow-hidden mt-2 mx-8">
                  <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${item.progress}%` }} />
                </div>
              )}

              {/* Error message */}
              {item.error && (
                <p className="text-xs text-rose-600 mt-1.5 mx-8">{item.error}</p>
              )}
            </div>
          ))}
        </div>

        {/* Action row */}
        <div className="flex gap-3 mt-5 flex-wrap">
          <button
            onClick={addRow}
            disabled={running}
            className="btn btn-secondary text-sm"
          >
            + Add File
          </button>
          <button
            onClick={uploadAll}
            disabled={!hasPending || running}
            className="btn btn-primary text-sm"
          >
            {running ? 'Uploading…' : 'Upload All Files'}
          </button>
        </div>

        {allDone && queue.some((i) => i.status === 'success') && (
          <p className="text-sm text-emerald-600 mt-3">
            All files uploaded successfully.
          </p>
        )}

        {/* Proceed to mapping once at least one file is uploaded */}
        {uploaded.length > 0 && onProceed && (
          <div className="mt-5 pt-5 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-navy-500">
              {uploaded.length} file{uploaded.length !== 1 ? 's' : ''} ready — run the mapping pipeline to process records.
            </p>
            <button
              onClick={onProceed}
              disabled={running}
              className="btn btn-primary text-sm"
            >
              Process &amp; Review →
            </button>
          </div>
        )}
      </div>

      {/* ── Uploaded files table ─────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-navy-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-navy-700">Uploaded files ({uploaded.length})</h3>
          {uploaded.some((u) => u.row_count === null && u.detected_columns === null) && (
            <span className="text-xs text-navy-400">PDFs stored as reference — no data extracted</span>
          )}
        </div>
        {uploaded.length === 0 ? (
          <p className="px-6 py-8 text-sm text-navy-500 text-center">No uploads yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-600">
              <tr>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Type</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Rows</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Columns</th>
                <th className="px-4 py-2 font-medium w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {uploaded.map((u) => {
                const isPdfFile = u.file_name.toLowerCase().endsWith('.pdf');
                const isDeleting = deleting === u.id;
                return (
                  <tr key={u.id} className={isDeleting ? 'opacity-40' : ''}>
                    <td className="px-4 py-2 font-medium text-navy-800 max-w-[140px] sm:max-w-none truncate">
                      {u.file_name}
                      {!isPdfFile && u.row_count != null && (
                        <span className="block text-xs text-navy-400 sm:hidden">{u.row_count} rows · {u.detected_columns?.length ?? 0} cols</span>
                      )}
                      {isPdfFile && (
                        <span className="block text-xs text-navy-400 sm:hidden">PDF ref</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className="badge badge-muted"
                        title={u.source_raw && u.source_raw !== u.source_type ? `Original: "${u.source_raw}"` : undefined}
                      >
                        {SOURCE_LABELS[u.source_type]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-navy-400 text-xs uppercase tracking-wide hidden sm:table-cell">
                      {isPdfFile ? 'PDF' : u.file_name.split('.').pop()?.toUpperCase() ?? '—'}
                    </td>
                    <td className="px-4 py-2 hidden sm:table-cell">
                      {isPdfFile
                        ? <span className="text-navy-400 text-xs">ref only</span>
                        : (u.row_count ?? '—')}
                    </td>
                    <td className="px-4 py-2 text-navy-500 hidden md:table-cell">
                      {isPdfFile ? '—' : `${u.detected_columns?.length ?? 0} detected`}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => void deleteUpload(u.id)}
                        disabled={isDeleting}
                        title="Remove this upload"
                        className="text-gray-300 hover:text-rose-500 transition-colors text-xl leading-none disabled:opacity-30"
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
