'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { validateRecord } from '@/lib/validator';
import type { ClientRecord } from '@/lib/schema/datagrows';

interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
  archive_reason: string | null;
}

interface Summary {
  total: number;
  readyToExport: number;
  withErrors: number;
  withWarnings: number;
  archived: number;
  dormant: number;
}

interface GeneratedDocument {
  id: string;
  document_type: string;
  version: number;
  file_name: string | null;
  generated_by: string | null;
  created_at: string;
  download_url: string | null;
}

type ReviewFilter = 'all' | 'ready' | 'errors' | 'warnings' | 'archived' | 'dormant';
const DOC_TYPE_LABELS: Record<string, string> = {
  datagrows: 'DataGrows Masterfile',
};

export function ExportStep({
  sessionId,
  firmName,
  onNavigateToReview,
  onExportComplete,
}: {
  sessionId: string;
  firmName: string;
  onNavigateToReview?: (filter: ReviewFilter) => void;
  onExportComplete?: () => void;
}) {
  const supabase = createClient();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived, archive_reason')
      .eq('session_id', sessionId);

    const rows = (data as ClusterRow[]) ?? [];
    let readyToExport = 0;
    let withErrors = 0;
    let withWarnings = 0;
    let archived = 0;
    let dormant = 0;

    for (const r of rows) {
      if (r.archived) { archived += 1; continue; }
      const v = validateRecord(r.merged);
      const errs = v.issues.filter((i) => i.severity === 'error').length;
      const warns = v.issues.filter((i) => i.severity === 'warning').length;
      if (errs > 0) withErrors += 1;
      if (warns > 0) withWarnings += 1;
      if (errs === 0) readyToExport += 1;
      if (r.merged.status === 'Dormant') dormant += 1;
    }

    setSummary({ total: rows.length, readyToExport, withErrors, withWarnings, archived, dormant });
    setLoading(false);
  }, [sessionId, supabase]);

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/export/${sessionId}/documents`);
      if (res.ok) {
        const data = await res.json() as { documents: GeneratedDocument[] };
        setDocuments(data.documents ?? []);
      }
    } catch {
      // Non-critical — document history just won't show
    } finally {
      setDocsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); loadDocuments(); }, [load, loadDocuments]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}?type=datagrows`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use filename from Content-Disposition header if available
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const safe = firmName.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60) || 'firm';
      a.download = match?.[1] ?? `${safe}_datagrows_import.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onExportComplete?.();

      // Refresh document history
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const canGenerate = !generating && ((summary?.readyToExport ?? 0) > 0 || (summary?.withErrors ?? 0) > 0);

  if (loading) return <p className="text-navy-500">Loading export summary…</p>;
  if (!summary) return <p className="text-rose-600">No cluster data available.</p>;

  return (
    <div className="space-y-6">
      {/* ── Summary stat cards ────────────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Export &amp; Reports</h3>
        <p className="text-sm text-navy-500 mb-4">
          Generate documents for this session. Tap any stat card to view those records in Review.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Stat label="Total clusters"  value={summary.total}          onClick={onNavigateToReview ? () => onNavigateToReview('all')      : undefined} />
          <Stat label="Ready to export" value={summary.readyToExport}  tone="ok"    onClick={onNavigateToReview && summary.readyToExport > 0 ? () => onNavigateToReview('ready')    : undefined} />
          <Stat label="Blocked (errors)"value={summary.withErrors}     tone="error" onClick={onNavigateToReview && summary.withErrors > 0    ? () => onNavigateToReview('errors')   : undefined} />
          <Stat label="Warnings"        value={summary.withWarnings}   tone="warn"  onClick={onNavigateToReview && summary.withWarnings > 0  ? () => onNavigateToReview('warnings') : undefined} />
          <Stat label="Dormant"         value={summary.dormant}        tone="muted" onClick={onNavigateToReview && summary.dormant > 0       ? () => onNavigateToReview('dormant')  : undefined} />
          <Stat label="Archived"        value={summary.archived}       tone="muted" onClick={onNavigateToReview && summary.archived > 0      ? () => onNavigateToReview('archived') : undefined} />
        </div>

        {/* Error banner */}
        {summary.withErrors > 0 && (
          <div className="mb-4 p-3 bg-amber-50 text-amber-900 text-sm rounded">
            <strong>{summary.withErrors}</strong> record(s) have errors and will be skipped in the export.
            The remaining <strong>{summary.readyToExport}</strong> clean records will still be exported.
            Go to <strong>Review</strong> to fix errors manually.
          </div>
        )}
      </div>

      {/* ── Download ─────────────────────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-base font-semibold text-navy-800 mb-1">DataGrows Masterfile</h3>
        <p className="text-sm text-navy-500 mb-4">
          86-column .xlsx ready to upload directly into DataGrows. Only error-free, non-archived records are included.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <button
            className="btn btn-primary"
            onClick={generate}
            disabled={!canGenerate}
          >
            {generating ? 'Generating…' : `Download Masterfile (${summary.readyToExport} rows)`}
          </button>
          <button className="btn btn-ghost" onClick={() => { void load(); void loadDocuments(); }} disabled={generating || loading}>
            Refresh
          </button>
        </div>
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      {/* ── Document history ─────────────────────────────────────────────── */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-base font-semibold text-navy-800 mb-3">Document History</h3>
        {docsLoading ? (
          <p className="text-sm text-navy-400">Loading history…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-navy-400">No documents generated yet for this session.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-navy-500 uppercase tracking-wide border-b border-navy-100">
                  <th className="px-2 pb-2">Document</th>
                  <th className="px-2 pb-2">Version</th>
                  <th className="px-2 pb-2 hidden sm:table-cell">By</th>
                  <th className="px-2 pb-2">Date</th>
                  <th className="px-2 pb-2">Download</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc, i) => (
                  <tr
                    key={doc.id}
                    className={`border-b border-navy-50 ${i % 2 === 0 ? '' : 'bg-navy-50/40'}`}
                  >
                    <td className="px-2 py-2.5 font-medium text-navy-800">
                      {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="text-xs bg-navy-100 text-navy-600 px-1.5 py-0.5 rounded-full font-medium">
                        v{doc.version}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-navy-500 hidden sm:table-cell">
                      {doc.generated_by ?? '—'}
                    </td>
                    <td className="px-2 py-2.5 text-navy-500 whitespace-nowrap">
                      {new Date(doc.created_at).toLocaleDateString('en-ZA', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-2 py-2.5">
                      {doc.download_url ? (
                        <a
                          href={doc.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-600 hover:text-teal-800 text-xs font-medium underline"
                        >
                          Download
                        </a>
                      ) : doc.file_name ? (
                        <span className="text-xs text-navy-400" title={doc.file_name}>
                          {doc.file_name.slice(0, 30)}{doc.file_name.length > 30 ? '…' : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-navy-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'error' | 'warn' | 'muted';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'ok'    ? 'text-teal-700' :
    tone === 'error' ? 'text-rose-600' :
    tone === 'warn'  ? 'text-amber-600' :
    tone === 'muted' ? 'text-navy-400' :
    'text-navy-800';

  return (
    <div
      className={`border border-navy-100 rounded-lg p-3 transition-colors ${
        onClick ? 'cursor-pointer hover:border-brand hover:bg-navy-50' : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <p className="text-xs text-navy-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      {onClick && <p className="text-xs text-navy-400 mt-0.5">View in Review →</p>}
    </div>
  );
}
