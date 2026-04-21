'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseWorkbook } from '@/lib/parsers/generic';
import type { SourceType } from '@/lib/schema/sources';

// ── Source slot definitions ────────────────────────────────────────────────────

const SOURCE_SLOTS = [
{ value: 'cipc',      label: 'CIPC',            icon: '📋', desc: 'CIPC registration export (.xlsx / .csv)' },
  { value: 'sars',      label: 'SARS',            icon: '🏦', desc: 'SARS eFiling export (.xlsx / .csv)' },
  { value: 'sage',      label: 'Sage',            icon: '💼', desc: 'Sage Pastel / Accounting export (.xlsx / .csv)' },
  { value: 'xero',      label: 'Xero',            icon: '📊', desc: 'Xero contacts export (.xlsx / .csv)' },
{ value: 'excel',     label: 'Manual Excel',    icon: '📑', desc: 'Custom spreadsheet (.xlsx / .csv)' },
] as const;

type SlotSource = typeof SOURCE_SLOTS[number]['value'];

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
  return SPREADSHEET_TYPES.includes(file.type) || /\.(xlsx|xls|csv)$/i.test(file.name);
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface UploadedRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  source_raw: string | null;
  row_count: number | null;
  detected_columns: string[] | null;
  created_at?: string;
}

// ── Manual client form constants ───────────────────────────────────────────────

const ENTITY_TYPES = ['PTY LTD', 'CC', 'TRUST', 'SOLE PROPRIETOR', 'PARTNERSHIP', 'NPC', 'OTHER'];
const STATUSES = ['Active', 'Inactive', 'Dormant', 'Pending', 'Part of Ownership Structure'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const BLANK_CLIENT = {
  client_name: '', entity_type: '', registration_nr: '', tax_nr: '', vat_nr: '',
  status: 'Active', year_end: '', primary_contact: '', contact_nr: '', contact_email: '',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function UploadStep({ sessionId, onProceed, onViewClients }: { sessionId: string; onProceed?: () => void; onViewClients?: () => void }) {
  const supabase = createClient();

  const [uploaded, setUploaded] = useState<UploadedRow[]>([]);
  const [uploadingSource, setUploadingSource] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | null>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  // Per-slot file input refs
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // View modal
  const [viewingUpload, setViewingUpload] = useState<UploadedRow | null>(null);
  const [viewRows, setViewRows] = useState<{ id: string; data: Record<string, unknown> }[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [selectedViewIds, setSelectedViewIds] = useState<Set<string>>(new Set());
  const [deletingRows, setDeletingRows] = useState(false);

  // Manual client modal
  const [showManual, setShowManual] = useState(false);
  const [manualFields, setManualFields] = useState({ ...BLANK_CLIENT });
  const [savingManual, setSavingManual] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualCount, setManualCount] = useState(0);

  // ── Load existing uploads ────────────────────────────────────────────────────

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('uploads')
      .select('id, file_name, source_type, source_raw, row_count, detected_columns, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    setUploaded((data as UploadedRow[]) ?? []);
  }, [sessionId, supabase]);

  useEffect(() => { void loadUploads(); }, [loadUploads]);

  async function loadManualCount() {
    const { count } = await supabase
      .from('clusters')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .contains('sources', ['manual']);
    setManualCount(count ?? 0);
  }

  useEffect(() => { void loadManualCount(); }, [sessionId]);

  // Latest upload per source type (first in desc order = most recent)
  const uploadBySource = useMemo(() => {
    const map: Record<string, UploadedRow> = {};
    for (const u of uploaded) {
      if (!map[u.source_type]) map[u.source_type] = u;
    }
    return map;
  }, [uploaded]);

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function deleteUpload(u: UploadedRow) {
    await supabase.from('raw_records').delete().eq('upload_id', u.id);
    await supabase.from('uploads').delete().eq('id', u.id);
    // Remove all clusters — pipeline must be re-run after source changes
    await supabase.from('clusters').delete().eq('session_id', sessionId);
    setUploaded((prev) => prev.filter((r) => r.id !== u.id));
  }

  // ── Upload a file for a given source slot ─────────────────────────────────────

  async function uploadForSlot(file: File, sourceType: string) {
    if (file.size > MAX_FILE_BYTES) {
      setUploadErrors((p) => ({ ...p, [sourceType]: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.` }));
      return;
    }
    if (!isPdf(file) && !isSpreadsheet(file)) {
      setUploadErrors((p) => ({ ...p, [sourceType]: 'Unsupported file type. Use .xlsx, .xls, .csv, or .pdf.' }));
      return;
    }

    // If replacing: delete previous upload for this source first
    const existing = uploadBySource[sourceType];
    if (existing) {
      await supabase.from('raw_records').delete().eq('upload_id', existing.id);
      await supabase.from('uploads').delete().eq('id', existing.id);
      // Delete clusters from this source so they're re-generated cleanly
      await supabase.from('clusters').delete().eq('session_id', sessionId);
      setUploaded((prev) => prev.filter((r) => r.id !== existing.id));
    }

    setUploadErrors((p) => ({ ...p, [sourceType]: null }));
    setUploadingSource(sourceType);
    setUploadProgress((p) => ({ ...p, [sourceType]: 5 }));

    const itemId = makeId();
    try {
      const signRes = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, fileName: file.name }),
      });
      const signData = await signRes.json() as { token?: string; path?: string; error?: string };
      if (!signRes.ok) throw new Error(signData.error ?? 'Failed to get upload URL');
      const { token, path: storagePath } = signData as { token: string; path: string };

      setUploadProgress((p) => ({ ...p, [sourceType]: 30 }));

      const { error: upErr } = await supabase.storage
        .from('uploads')
        .uploadToSignedUrl(storagePath, token, file, { upsert: false });
      if (upErr) throw upErr;

      setUploadProgress((p) => ({ ...p, [sourceType]: 60 }));

      let rowCount: number | null = null;
      let detectedColumns: string[] | null = null;
      let rows: Record<string, unknown>[] | null = null;

      if (isSpreadsheet(file)) {
        const buffer = await file.arrayBuffer();
        const parsed = parseWorkbook(buffer, file.name);
        const primary = parsed.sheets.find((s) => s.sheetName === parsed.primarySheetName);
        if (primary) {
          rowCount = primary.rows.length;
          detectedColumns = primary.detectedColumns;
          rows = primary.rows;
        }
      }

      setUploadProgress((p) => ({ ...p, [sourceType]: 80 }));

      const saveRes = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, sourceType, fileName: file.name, storagePath, rowCount, detectedColumns, rows }),
      });
      const saveData = await saveRes.json() as { uploadId?: string; error?: string };
      if (!saveRes.ok) throw new Error(saveData.error ?? 'Failed to save upload');

      setUploadProgress((p) => ({ ...p, [sourceType]: 100 }));
      void loadUploads();
    } catch (err) {
      setUploadErrors((p) => ({ ...p, [sourceType]: err instanceof Error ? err.message : 'Upload failed' }));
    } finally {
      setUploadingSource(null);
      // Clear progress after a short delay
      setTimeout(() => setUploadProgress((p) => ({ ...p, [sourceType]: 0 })), 1500);
    }

    void itemId; // suppress unused warning
  }

  // ── View modal ────────────────────────────────────────────────────────────────

  async function viewUpload(u: UploadedRow) {
    setViewingUpload(u);
    setViewRows([]);
    setSelectedViewIds(new Set());
    setViewLoading(true);
    const { data } = await supabase
      .from('raw_records')
      .select('id, data')
      .eq('upload_id', u.id)
      .limit(1000);
    setViewRows((data ?? []).map((r: { id: string; data: unknown }) => ({
      id: r.id,
      data: r.data as Record<string, unknown>,
    })));
    setViewLoading(false);
  }

  async function deleteSelectedRows() {
    if (selectedViewIds.size === 0) return;
    setDeletingRows(true);
    await supabase.from('raw_records').delete().in('id', [...selectedViewIds]);
    setViewRows((prev) => prev.filter((r) => !selectedViewIds.has(r.id)));
    // Update row count on the upload record
    if (viewingUpload) {
      const newCount = (viewingUpload.row_count ?? 0) - selectedViewIds.size;
      await supabase.from('uploads').update({ row_count: newCount }).eq('id', viewingUpload.id);
      setViewingUpload({ ...viewingUpload, row_count: newCount });
      setUploaded((prev) => prev.map((u) => u.id === viewingUpload.id ? { ...u, row_count: newCount } : u));
    }
    setSelectedViewIds(new Set());
    setDeletingRows(false);
  }

  // ── Manual client ─────────────────────────────────────────────────────────────

  async function saveManualClient() {
    if (!manualFields.client_name.trim()) { setManualError('Client name is required.'); return; }
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
    } finally { setSavingManual(false); }
  }

  const hasAnyUpload = uploaded.length > 0 || manualCount > 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Page heading ── */}
      <div className="pb-3 border-b border-navy-100">
        <h2 className="text-xl font-semibold text-navy-800">Import Source Files</h2>
        <p className="text-sm text-navy-400 mt-0.5">
          Upload each data source below. Once all files are loaded, run the pipeline to merge and review clients.
        </p>
      </div>

      {/* ── Source file slots ── */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider">Uploaded Files</h4>
        <div className="border border-navy-100 rounded-xl overflow-hidden divide-y divide-navy-100">
          {SOURCE_SLOTS.map(({ value: src, label, icon, desc }) => {
            const u = uploadBySource[src];
            const loaded = !!u;
            const isUploading = uploadingSource === src;
            const progress = uploadProgress[src] ?? 0;
            const error = uploadErrors[src];

            return (
              <div key={src} className={`transition-colors ${loaded ? 'bg-white hover:bg-navy-50' : 'bg-navy-50'}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className={`text-xl shrink-0 ${loaded ? '' : 'opacity-40'}`}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${loaded ? 'text-navy-700' : 'text-navy-400'}`}>{label}</p>
                    {loaded ? (
                      <>
                        <p className="text-xs text-navy-400 truncate">{u.file_name}</p>
                        <p className="text-xs text-navy-300 mt-0.5">
                          {u.row_count != null ? `${u.row_count} rows` : 'PDF ref'} · {u.detected_columns?.length ?? 0} columns
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-navy-300">{isUploading ? 'Uploading…' : desc}</p>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
                    className="hidden"
                    ref={(el) => { fileInputRefs.current[src] = el; }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadForSlot(file, src);
                      e.target.value = '';
                    }}
                  />

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {loaded && !isUploading && (
                      <>
                        <button
                          type="button"
                          className="text-xs font-medium text-navy-500 border border-navy-200 bg-white hover:bg-navy-50 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => void viewUpload(u)}
                        >
                          View
                        </button>
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => void deleteUpload(u)}
                          title="Removes this file and resets Review/Export data"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="text-xs font-medium text-teal-700 border border-teal-300 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => fileInputRefs.current[src]?.click()}
                        >
                          Replace
                        </button>
                      </>
                    )}
                    {!loaded && !isUploading && (
                      <button
                        type="button"
                        className="text-xs font-medium text-navy-400 border border-navy-200 bg-white hover:bg-navy-50 px-3 py-1.5 rounded-lg transition-colors"
                        onClick={() => fileInputRefs.current[src]?.click()}
                      >
                        Upload
                      </button>
                    )}
                    {isUploading && (
                      <span className="flex items-center gap-1.5 text-teal-700 text-xs font-medium">
                        <span className="inline-block w-3 h-3 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
                        {progress > 0 ? `${progress}%` : 'Starting…'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {isUploading && progress > 0 && progress < 100 && (
                  <div className="h-1 bg-teal-100 mx-4 mb-2 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                )}

                {/* Error */}
                {error && (
                  <p className="text-xs text-rose-600 px-4 pb-2">{error}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Add clients manually ── */}
      <div className="card p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-navy-800">Add clients manually</h3>
            <p className="text-sm text-navy-400 mt-0.5">
              Enter a client record directly — no file needed.
              {manualCount > 0 && <span className="ml-2 text-teal-600 font-medium">{manualCount} added so far</span>}
            </p>
          </div>
          <button
            onClick={() => { setManualFields({ ...BLANK_CLIENT }); setManualError(null); setShowManual(true); }}
            className="btn btn-secondary text-sm flex-shrink-0"
          >
            + Add Client
          </button>
        </div>
      </div>

      {/* ── Proceed / View Clients bar ── */}
      {hasAnyUpload && (
        <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-navy-500">
            <span className="font-medium text-navy-800">{uploaded.length}</span> file{uploaded.length !== 1 ? 's' : ''} uploaded
            {manualCount > 0 && <span className="ml-2">· {manualCount} manual client{manualCount !== 1 ? 's' : ''}</span>}
          </p>
          <div className="flex gap-2 flex-wrap">
            {onViewClients && (
              <button onClick={onViewClients} className="btn btn-ghost text-sm">
                View All Clients →
              </button>
            )}
            {onProceed && (
              <button onClick={onProceed} className="btn btn-primary text-sm">
                Process &amp; Review →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── View file modal ── */}
      {viewingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingUpload(null)} />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-navy-100">
              <div>
                <h3 className="text-base font-semibold text-navy-800">{viewingUpload.file_name}</h3>
                <p className="text-xs text-navy-400 mt-0.5">
                  {SOURCE_SLOTS.find((s) => s.value === viewingUpload.source_type)?.label ?? viewingUpload.source_type}
                  {' '}· {viewingUpload.row_count ?? 0} rows · {viewingUpload.detected_columns?.length ?? 0} columns
                </p>
              </div>
              <button onClick={() => setViewingUpload(null)} className="btn btn-ghost text-sm">Close ✕</button>
            </div>

            {viewingUpload.detected_columns && viewingUpload.detected_columns.length > 0 && (
              <div className="px-5 py-3 border-b border-navy-100 bg-navy-50">
                <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-2">Detected Columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {viewingUpload.detected_columns.map((col) => (
                    <span key={col} className="inline-flex px-2 py-0.5 rounded bg-white border border-navy-200 text-xs text-navy-600">{col}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Bulk-action bar — shown when rows are selected */}
            {selectedViewIds.size > 0 && (
              <div className="flex items-center gap-3 px-5 py-2.5 bg-rose-50 border-b border-rose-200">
                <span className="text-sm font-semibold text-rose-700">
                  {selectedViewIds.size} row{selectedViewIds.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  className="btn text-sm bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                  disabled={deletingRows}
                  onClick={() => void deleteSelectedRows()}
                >
                  {deletingRows ? 'Removing…' : `Remove ${selectedViewIds.size} from import`}
                </button>
                <button
                  className="text-xs text-rose-500 underline hover:text-rose-700"
                  onClick={() => setSelectedViewIds(new Set())}
                >
                  Clear selection
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {viewLoading ? (
                <p className="px-5 py-8 text-sm text-navy-400 text-center">Loading rows…</p>
              ) : viewRows.length === 0 ? (
                <p className="px-5 py-8 text-sm text-navy-400 text-center">No row data available.</p>
              ) : (() => {
                const NAME_KEYWORDS = ['name', 'company', 'client', 'business', 'account', 'trading'];
                const allCols = Object.keys(viewRows[0].data);
                const cols = [...allCols].sort((a, b) => {
                  const aName = NAME_KEYWORDS.some((k) => a.toLowerCase().includes(k));
                  const bName = NAME_KEYWORDS.some((k) => b.toLowerCase().includes(k));
                  if (aName && !bName) return -1;
                  if (!aName && bName) return 1;
                  return 0;
                });
                const allSelected = viewRows.every((r) => selectedViewIds.has(r.id));
                return (
                  <table className="w-full text-xs min-w-max">
                    <thead className="bg-navy-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={allSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedViewIds(new Set(viewRows.map((r) => r.id)));
                              } else {
                                setSelectedViewIds(new Set());
                              }
                            }}
                            title="Select all"
                          />
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-navy-500 w-8">#</th>
                        {cols.map((c) => (
                          <th key={c} className="px-3 py-2 text-left font-medium text-navy-600 whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {viewRows.map((row, i) => {
                        const isSelected = selectedViewIds.has(row.id);
                        return (
                          <tr
                            key={row.id}
                            className={`cursor-pointer transition-colors ${isSelected ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-navy-50'}`}
                            onClick={() => setSelectedViewIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                              return next;
                            })}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="rounded"
                                checked={isSelected}
                                onChange={(e) => {
                                  setSelectedViewIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(row.id); else next.delete(row.id);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-navy-300">{i + 1}</td>
                            {cols.map((c) => (
                              <td key={c} className="px-3 py-2 text-navy-700 max-w-[200px] truncate">
                                {row.data[c] != null ? String(row.data[c]) : <span className="text-navy-200">—</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
            {viewRows.length > 0 && (
              <div className="px-5 py-2.5 border-t border-navy-100 bg-navy-50 flex items-center justify-between text-xs text-navy-400">
                <span>
                  {selectedViewIds.size > 0
                    ? <span className="text-rose-600 font-medium">{selectedViewIds.size} selected — click &ldquo;Remove from import&rdquo; above to exclude</span>
                    : 'Click rows to select · select-all checkbox in header'}
                </span>
                <span>Showing {viewRows.length} of {viewingUpload.row_count ?? viewRows.length} rows</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Manual client modal ── */}
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
