'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  source: string;
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

const ENTITY_TYPES = ['PTY LTD', 'CC', 'TRUST', 'SOLE PROPRIETOR', 'PARTNERSHIP', 'NPC', 'OTHER'];
const STATUSES = ['Active', 'Inactive', 'Dormant', 'Pending', 'Part of Ownership Structure'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const BLANK_CLIENT = {
  client_name: '', entity_type: '', registration_nr: '', tax_nr: '', vat_nr: '',
  status: 'Active', year_end: '', primary_contact: '', contact_nr: '', contact_email: '',
};

export function UploadStep({ sessionId, onProceed }: { sessionId: string; onProceed?: () => void }) {
  const supabase = createClient();

  const [queue, setQueue] = useState<UploadItem[]>([
    { id: makeId(), file: null, source: 'company', status: 'idle', progress: 0 },
  ]);
  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);
  const [running, setRunning] = useState(false);

  // ── Manual client modal ──────────────────────────────────────────────────────
  const [showManual, setShowManual] = useState(false);
  const [manualFields, setManualFields] = useState({ ...BLANK_CLIENT });
  const [savingManual, setSavingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualCount, setManualCount] = useState(0);

  async function loadManualCount() {
    const { count } = await supabase
      .from('clusters')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .contains('sources', ['manual']);
    setManualCount(count ?? 0);
  }

  useEffect(() => { void loadManualCount(); }, [sessionId]);

  async function saveManualClient() {
    if (!manualFields.client_name.trim()) {
      setManualError('Client name is required.');
      return;
    }
    setSavingManual(true);
    setManualError(null);
    try {
      const { error } = await supabase.from('clusters').insert({
        session_id: sessionId,
        merged: manualFields,
        sources: ['manual'],
        archived: false,
        archive_reason: null,
        primary_key_value: manualFields.client_name.trim(),
      });
      if (error) throw error;
      setManualFields({ ...BLANK_CLIENT });
      setShowManual(false);
      void loadManualCount();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Failed to save client.');
    } finally {
      setSavingManual(false);
    }
  }

  // ── Batch selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingBatch, setDeletingBatch] = useState(false);

  // ── Replace: maps uploadId → hidden file input ref ───────────────────────────
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Load existing uploads ────────────────────────────────────────────────────

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('uploads')
      .select('id, file_name, source_type, source_raw, row_count, detected_columns')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    setUploaded((data as UploadedRow[]) ?? []);
  }, [sessionId, supabase]);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  // ── Delete helpers ────────────────────────────────────────────────────────────

  async function deleteOne(id: string) {
    await supabase.from('raw_records').delete().eq('upload_id', id);
    await supabase.from('uploads').delete().eq('id', id);
    setUploaded((prev) => prev.filter((u) => u.id !== id));
    setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    setDeletingBatch(true);
    await Promise.allSettled([...selected].map(deleteOne));
    setDeletingBatch(false);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    if (selected.size === uploaded.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(uploaded.map((u) => u.id)));
    }
  }

  // ── Change source type of an already-uploaded file ───────────────────────────

  async function changeSourceType(id: string, newSource: SourceType) {
    await supabase.from('uploads').update({ source_type: newSource, source_raw: newSource }).eq('id', id);
    setUploaded((prev) => prev.map((u) => u.id === id ? { ...u, source_type: newSource } : u));
  }

  // ── Replace: delete old row and re-upload with same source type ───────────────

  async function handleReplace(row: UploadedRow, file: File) {
    // Delete the old upload first
    await deleteOne(row.id);
    // Queue new upload with same source type
    const newId = makeId();
    setQueue((q) => [...q, { id: newId, file, source: row.source_type, status: 'idle', progress: 0 }]);
    // Small delay so state updates before uploadOne reads it
    setTimeout(() => {
      void uploadOne({ id: newId, file, source: row.source_type, status: 'idle', progress: 0 });
    }, 50);
  }

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
      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, fileName: item.file.name }),
      });
      const signData = await signRes.json() as { signedUrl?: string; token?: string; path?: string; error?: string };
      if (!signRes.ok) throw new Error(signData.error ?? 'Failed to get upload URL');

      const { token, path: storagePath } = signData as { signedUrl: string; token: string; path: string };

      patchItem(item.id, { progress: 20 });

      const { error: upErr } = await supabase.storage
        .from('uploads')
        .uploadToSignedUrl(storagePath, token, item.file, { upsert: false });
      if (upErr) throw upErr;

      patchItem(item.id, { progress: 60 });

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
    pending.forEach((item) => patchItem(item.id, { status: 'uploading', progress: 2 }));
    await Promise.allSettled(pending.map((item) => uploadOne(item)));
    setRunning(false);
  }

  function retryOne(item: UploadItem) {
    patchItem(item.id, { status: 'idle', progress: 0, error: undefined });
    void uploadOne({ ...item, status: 'idle', progress: 0, error: undefined });
  }

  const hasPending = queue.some((item) => item.file && item.status !== 'success');
  const allDone = queue.every((item) => !item.file || item.status === 'success');
  const allSelected = uploaded.length > 0 && selected.size === uploaded.length;

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
                <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0 font-medium">{idx + 1}.</span>

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

                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={(e) => setFile(item.id, e.target.files?.[0] ?? null)}
                  disabled={item.status === 'uploading'}
                  className="input text-sm flex-1 min-w-0"
                />

                <div className="flex-shrink-0 flex items-center gap-2 min-w-[60px] justify-end">
                  <StatusBadge status={item.status} />
                  {item.status === 'error' && (
                    <button onClick={() => retryOne(item)} className="text-xs text-teal-700 underline">Retry</button>
                  )}
                </div>

                {item.status !== 'uploading' && queue.length > 1 && (
                  <button
                    onClick={() => removeRow(item.id)}
                    className="text-gray-300 hover:text-rose-500 transition-colors flex-shrink-0 text-xl leading-none"
                    title="Remove row"
                  >×</button>
                )}
              </div>

              {item.status === 'uploading' && (
                <div className="h-1 bg-teal-100 rounded-full overflow-hidden mt-2 mx-8">
                  <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${item.progress}%` }} />
                </div>
              )}

              {item.error && (
                <p className="text-xs text-rose-600 mt-1.5 mx-8">{item.error}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-5 flex-wrap">
          <button onClick={addRow} disabled={running} className="btn btn-secondary text-sm">
            + Add File
          </button>
          <button onClick={uploadAll} disabled={!hasPending || running} className="btn btn-primary text-sm">
            {running ? 'Uploading…' : 'Upload All Files'}
          </button>
        </div>

        {allDone && queue.some((i) => i.status === 'success') && (
          <p className="text-sm text-emerald-600 mt-3">All files uploaded successfully.</p>
        )}

        {uploaded.length > 0 && onProceed && (
          <div className="mt-5 pt-5 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-navy-500">
              {uploaded.length} file{uploaded.length !== 1 ? 's' : ''} ready — run the mapping pipeline to process records.
            </p>
            <button onClick={onProceed} disabled={running} className="btn btn-primary text-sm">
              Process &amp; Review →
            </button>
          </div>
        )}
      </div>

      {/* ── Uploaded files table ─────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-navy-100 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-navy-700">Uploaded files ({uploaded.length})</h3>
          {selected.size > 0 && (
            <button
              onClick={() => void deleteSelected()}
              disabled={deletingBatch}
              className="ml-auto text-xs font-medium text-white bg-rose-500 hover:bg-rose-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {deletingBatch ? 'Deleting…' : `Delete ${selected.size} selected`}
            </button>
          )}
        </div>

        {uploaded.length === 0 ? (
          <p className="px-6 py-8 text-sm text-navy-500 text-center">No uploads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-navy-600">
                <tr>
                  <th className="px-4 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded accent-teal-600"
                      title="Select all"
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium hidden sm:table-cell">Type</th>
                  <th className="px-4 py-2 font-medium hidden sm:table-cell">Rows</th>
                  <th className="px-4 py-2 font-medium hidden md:table-cell">Columns</th>
                  <th className="px-4 py-2 font-medium w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {uploaded.map((u) => {
                  const isPdfFile = u.file_name.toLowerCase().endsWith('.pdf');
                  const isChecked = selected.has(u.id);
                  return (
                    <tr key={u.id} className={`${isChecked ? 'bg-rose-50' : ''} ${deletingBatch && isChecked ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(u.id)}
                          className="rounded accent-teal-600"
                        />
                      </td>
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
                        <select
                          value={u.source_type}
                          onChange={(e) => void changeSourceType(u.id, e.target.value as SourceType)}
                          className="input text-xs py-1 px-2 w-36"
                        >
                          {SOURCE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-navy-400 text-xs uppercase tracking-wide hidden sm:table-cell">
                        {isPdfFile ? 'PDF' : u.file_name.split('.').pop()?.toUpperCase() ?? '—'}
                      </td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        {isPdfFile ? <span className="text-navy-400 text-xs">ref only</span> : (u.row_count ?? '—')}
                      </td>
                      <td className="px-4 py-2 text-navy-500 hidden md:table-cell">
                        {isPdfFile ? '—' : `${u.detected_columns?.length ?? 0} detected`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Replace — hidden file input triggered on click */}
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv,.pdf"
                            className="hidden"
                            ref={(el) => { replaceRefs.current[u.id] = el; }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleReplace(u, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => replaceRefs.current[u.id]?.click()}
                            title="Replace with a new file"
                            className="text-xs text-teal-600 hover:text-teal-800 font-medium"
                          >
                            Replace
                          </button>
                          <button
                            onClick={() => void deleteOne(u.id)}
                            title="Remove this upload"
                            className="text-gray-300 hover:text-rose-500 transition-colors text-xl leading-none"
                          >×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add client manually ──────────────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-navy-800">Add clients manually</h3>
            <p className="text-sm text-navy-400 mt-0.5">
              Enter a client record directly — no file needed.
              {manualCount > 0 && <span className="ml-2 text-teal-600 font-medium">{manualCount} added so far</span>}
            </p>
          </div>
          <button onClick={() => { setManualFields({ ...BLANK_CLIENT }); setManualError(null); setShowManual(true); }} className="btn btn-secondary text-sm flex-shrink-0">
            + Add Client
          </button>
        </div>
      </div>

      {/* ── Manual client modal ─────────────────────────────────────────────── */}
      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowManual(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-navy-800">Add Client Manually</h2>
              <button onClick={() => setShowManual(false)} className="text-navy-300 hover:text-navy-700 text-2xl leading-none">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-navy-500 mb-1">Client Name <span className="text-rose-500">*</span></label>
                <input className="input w-full" value={manualFields.client_name} onChange={(e) => setManualFields((f) => ({ ...f, client_name: e.target.value }))} placeholder="e.g. Blue Capital (Pty) Ltd" />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Entity Type</label>
                <select className="input w-full" value={manualFields.entity_type} onChange={(e) => setManualFields((f) => ({ ...f, entity_type: e.target.value }))}>
                  <option value="">— Select —</option>
                  {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Status</label>
                <select className="input w-full" value={manualFields.status} onChange={(e) => setManualFields((f) => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Registration Nr</label>
                <input className="input w-full" value={manualFields.registration_nr} onChange={(e) => setManualFields((f) => ({ ...f, registration_nr: e.target.value }))} placeholder="2022/123456/07" />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Tax Nr</label>
                <input className="input w-full" value={manualFields.tax_nr} onChange={(e) => setManualFields((f) => ({ ...f, tax_nr: e.target.value }))} placeholder="1234567890" />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">VAT Nr</label>
                <input className="input w-full" value={manualFields.vat_nr} onChange={(e) => setManualFields((f) => ({ ...f, vat_nr: e.target.value }))} placeholder="4123456789" />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Year End</label>
                <select className="input w-full" value={manualFields.year_end} onChange={(e) => setManualFields((f) => ({ ...f, year_end: e.target.value }))}>
                  <option value="">— Month —</option>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Primary Contact</label>
                <input className="input w-full" value={manualFields.primary_contact} onChange={(e) => setManualFields((f) => ({ ...f, primary_contact: e.target.value }))} placeholder="Jane Smith" />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Phone</label>
                <input className="input w-full" value={manualFields.contact_nr} onChange={(e) => setManualFields((f) => ({ ...f, contact_nr: e.target.value }))} placeholder="+27 11 000 0000" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-navy-500 mb-1">Email</label>
                <input className="input w-full" type="email" value={manualFields.contact_email} onChange={(e) => setManualFields((f) => ({ ...f, contact_email: e.target.value }))} placeholder="info@example.co.za" />
              </div>
            </div>

            {manualError && <p className="text-sm text-rose-600">{manualError}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={() => setShowManual(false)} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={() => void saveManualClient()} disabled={savingManual} className="btn btn-primary text-sm">
                {savingManual ? 'Saving…' : 'Save Client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
