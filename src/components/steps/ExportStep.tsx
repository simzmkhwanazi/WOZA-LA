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

type ReviewFilter = 'all' | 'ready' | 'errors' | 'warnings' | 'archived' | 'dormant';

export function ExportStep({
  sessionId,
  firmName,
  onNavigateToReview,
}: {
  sessionId: string;
  firmName: string;
  /** Called when a stat card is clicked — navigates to Review with the given filter. */
  onNavigateToReview?: (filter: ReviewFilter) => void;
}) {
  const supabase = createClient();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<'datagrows' | 'archived' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixMsg, setFixMsg] = useState<string | null>(null);

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

  useEffect(() => { load(); }, [load]);

  async function download(type: 'datagrows' | 'archived') {
    setDownloading(type);
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}?type=${type}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = firmName.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60) || 'firm';
      a.download =
        type === 'archived'
          ? `${safe}_archived_report.xlsx`
          : `${safe}_datagrows_import.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  }

  async function runAutoFix() {
    setFixing(true);
    setFixMsg(null);
    try {
      const res = await fetch('/api/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json() as { fixed?: number; error?: string };
      if (data.error) throw new Error(data.error);
      const n = data.fixed ?? 0;
      setFixMsg(n > 0 ? `AI fixed ${n} record(s). Refreshing…` : 'No automatic fixes found.');
      if (n > 0) await load();
    } catch (err) {
      setFixMsg(`Fix failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFixing(false);
    }
  }

  if (loading) return <p className="text-navy-500">Loading export summary…</p>;
  if (!summary) return <p className="text-rose-600">No cluster data available.</p>;

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Export to DataGrows</h3>
        <p className="text-sm text-navy-500 mb-4">
          Download the populated DataGrows import template. Click any stat card to view those
          records in the Review tab.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Stat
            label="Total clusters"
            value={summary.total}
            onClick={onNavigateToReview ? () => onNavigateToReview('all') : undefined}
          />
          <Stat
            label="Ready to export"
            value={summary.readyToExport}
            tone="ok"
            onClick={onNavigateToReview && summary.readyToExport > 0 ? () => onNavigateToReview('ready') : undefined}
          />
          <Stat
            label="Blocked (errors)"
            value={summary.withErrors}
            tone="error"
            onClick={onNavigateToReview && summary.withErrors > 0 ? () => onNavigateToReview('errors') : undefined}
          />
          <Stat
            label="Warnings"
            value={summary.withWarnings}
            tone="warn"
            onClick={onNavigateToReview && summary.withWarnings > 0 ? () => onNavigateToReview('warnings') : undefined}
          />
          <Stat
            label="Dormant"
            value={summary.dormant}
            tone="muted"
            onClick={onNavigateToReview && summary.dormant > 0 ? () => onNavigateToReview('dormant') : undefined}
          />
          <Stat
            label="Archived"
            value={summary.archived}
            tone="muted"
            onClick={onNavigateToReview && summary.archived > 0 ? () => onNavigateToReview('archived') : undefined}
          />
        </div>

        {summary.withErrors > 0 && (
          <div className="mb-4 p-3 bg-amber-50 text-amber-900 text-sm rounded flex items-start justify-between gap-3">
            <span>
              <strong>{summary.withErrors}</strong> record(s) have errors and will be skipped in the export.
              The remaining <strong>{summary.readyToExport}</strong> clean records will still be exported.
              Fix errors in the Review tab to include them.
            </span>
            <button
              onClick={runAutoFix}
              disabled={fixing}
              className="btn btn-secondary text-sm shrink-0"
            >
              {fixing ? 'Fixing…' : 'Auto-fix with AI'}
            </button>
          </div>
        )}

        {fixMsg && (
          <p className={`text-sm mb-3 ${fixMsg.startsWith('Fix failed') ? 'text-rose-600' : 'text-green-700'}`}>
            {fixMsg}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            className="btn btn-primary"
            onClick={() => download('datagrows')}
            disabled={downloading !== null || (summary.readyToExport === 0 && summary.withErrors === 0)}
          >
            {downloading === 'datagrows'
              ? 'Generating…'
              : `Download DataGrows import (${summary.readyToExport} rows)`}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => download('archived')}
            disabled={downloading !== null || summary.archived === 0}
          >
            {downloading === 'archived'
              ? 'Generating…'
              : `Download archived report (${summary.archived} rows)`}
          </button>
          <button className="btn btn-ghost" onClick={load} disabled={downloading !== null || loading}>
            Refresh
          </button>
        </div>

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      <div className="card p-6 text-sm text-navy-600">
        <h4 className="font-semibold text-navy-800 mb-2">What happens on export</h4>
        <ol className="list-decimal ml-5 space-y-1">
          <li>Server loads <code>public/datagrows_canonical_template.xlsx</code> (with all x14 dropdowns intact).</li>
          <li>Writes one row per non-archived, error-free cluster starting at row 3, in exact 86-column order.</li>
          <li>Clears the row-2 instructions row so the file is ready to upload to DataGrows.</li>
          <li>Streams the <code>.xlsx</code> back to your browser as a download.</li>
        </ol>
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
