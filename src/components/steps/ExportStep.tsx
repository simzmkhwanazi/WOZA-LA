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

export function ExportStep({
  sessionId,
  firmName,
}: {
  sessionId: string;
  firmName: string;
}) {
  const supabase = createClient();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<'datagrows' | 'archived' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      if (r.archived) {
        archived += 1;
        continue;
      }
      const v = validateRecord(r.merged);
      const errs = v.issues.filter((i) => i.severity === 'error').length;
      const warns = v.issues.filter((i) => i.severity === 'warning').length;
      if (errs > 0) withErrors += 1;
      if (warns > 0) withWarnings += 1;
      if (errs === 0) readyToExport += 1;
      if (r.merged.status === 'Dormant') dormant += 1;
    }

    setSummary({
      total: rows.length,
      readyToExport,
      withErrors,
      withWarnings,
      archived,
      dormant,
    });
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function download(type: 'datagrows' | 'archived') {
    setDownloading(type);
    setError(null);
    try {
      const res = await fetch(`/api/export/${sessionId}?type=${type}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
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

  if (loading) return <p className="text-navy-500">Loading export summary…</p>;
  if (!summary) return <p className="text-rose-600">No cluster data available.</p>;

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Export to DataGrows</h3>
        <p className="text-sm text-navy-500 mb-4">
          Download the populated DataGrows import template. Only records with no
          blocking errors are included. Archived records go in a separate follow-up
          report.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Stat label="Total clusters" value={summary.total} />
          <Stat label="Ready to export" value={summary.readyToExport} tone="ok" />
          <Stat label="Blocked (errors)" value={summary.withErrors} tone="error" />
          <Stat label="Warnings" value={summary.withWarnings} tone="warn" />
          <Stat label="Dormant" value={summary.dormant} tone="muted" />
          <Stat label="Archived" value={summary.archived} tone="muted" />
        </div>

        {summary.withErrors > 0 && (
          <div className="mb-4 p-3 bg-rose-50 text-rose-900 text-sm rounded">
            <strong>{summary.withErrors}</strong> record(s) still have blocking errors.
            They will be skipped unless you fix them in the Review tab first.
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            className="btn btn-primary"
            onClick={() => download('datagrows')}
            disabled={downloading !== null || summary.readyToExport === 0}
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
          <button className="btn btn-ghost" onClick={load} disabled={downloading !== null}>
            Refresh
          </button>
        </div>

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      <div className="card p-6 text-sm text-navy-600">
        <h4 className="font-semibold text-navy-800 mb-2">What happens on export</h4>
        <ol className="list-decimal ml-5 space-y-1">
          <li>Server loads <code>public/datagrows_canonical_template.xlsx</code> (with all x14 dropdowns intact).</li>
          <li>Writes one row per non-archived cluster starting at row 3, column by column, following the 86-field order.</li>
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
}: {
  label: string;
  value: number;
  tone?: 'default' | 'ok' | 'error' | 'warn' | 'muted';
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-teal-700'
      : tone === 'error'
        ? 'text-rose-600'
        : tone === 'warn'
          ? 'text-amber-600'
          : tone === 'muted'
            ? 'text-navy-400'
            : 'text-navy-800';
  return (
    <div className="border border-navy-100 rounded-lg p-3">
      <p className="text-xs text-navy-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
