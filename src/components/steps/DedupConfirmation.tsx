'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PendingNameMatch } from '@/lib/matcher';
import { SOURCE_LABELS, type SourceType } from '@/lib/schema/sources';
import type { ClientRecord } from '@/lib/schema/datagrows';

interface ClusterRow {
  id: string;               // Supabase UUID
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
  archive_reason: string | null;
  primary_key_type: string;
  primary_key_value: string;
}

type Decision = 'approved' | 'rejected' | null;

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    cipc:      'bg-blue-100 text-blue-700',
    sars:      'bg-green-100 text-green-700',
    sage:      'bg-purple-100 text-purple-700',
    xero:      'bg-sky-100 text-sky-700',
    excel:     'bg-gray-100 text-gray-600',
    employees: 'bg-indigo-100 text-indigo-700',
    company:   'bg-orange-100 text-orange-700',
  };
  const label = SOURCE_LABELS[source as SourceType] ?? source;
  const cls = colors[source] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function scoreColor(score: number) {
  if (score >= 0.95) return 'text-green-700';
  if (score >= 0.85) return 'text-amber-600';
  return 'text-red-600';
}

export function DedupConfirmation({
  sessionId,
  onComplete,
}: {
  sessionId: string;
  onComplete: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pendingMatches, setPendingMatches] = useState<PendingNameMatch[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data: session } = await supabase
      .from('sessions')
      .select('pending_name_matches, dedup_confirmed')
      .eq('id', sessionId)
      .single();

    if (session?.dedup_confirmed) {
      // Already confirmed — skip straight to review
      onComplete();
      return;
    }

    const matches = (session?.pending_name_matches as PendingNameMatch[] | null) ?? [];
    setPendingMatches(matches);

    // Pre-fill any decisions already stored on archived clusters
    setDecisions(Object.fromEntries(matches.map((m) => [m.orphanClusterId, null])));
    setLoading(false);
  }, [sessionId, supabase, onComplete]);

  useEffect(() => { void load(); }, [load]);

  const allDecided = useMemo(
    () => pendingMatches.every((m) => decisions[m.orphanClusterId] !== null),
    [pendingMatches, decisions],
  );

  const summary = useMemo(() => {
    const approved = Object.entries(decisions).filter(([, v]) => v === 'approved').map(([k]) => k);
    const rejected = Object.entries(decisions).filter(([, v]) => v === 'rejected').map(([k]) => k);
    return { approved, rejected };
  }, [decisions]);

  function decide(orphanClusterId: string, decision: Decision) {
    setDecisions((prev) => ({ ...prev, [orphanClusterId]: decision }));
  }

  function mergeAll() {
    setDecisions(Object.fromEntries(pendingMatches.map((m) => [m.orphanClusterId, 'approved'])));
  }

  function keepAllSeparate() {
    setDecisions(Object.fromEntries(pendingMatches.map((m) => [m.orphanClusterId, 'rejected'])));
  }

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      // Fetch all clusters for this session
      const { data: clusterRows, error: fetchErr } = await supabase
        .from('clusters')
        .select('id, merged, sources, archived, archive_reason, primary_key_type, primary_key_value')
        .eq('session_id', sessionId);

      if (fetchErr) throw new Error(fetchErr.message);
      const rows = (clusterRows ?? []) as ClusterRow[];

      // Map Supabase UUIDs to in-memory cluster IDs (stored as merged._cluster_id)
      const supabaseIdByLocalId = new Map<string, string>();
      for (const row of rows) {
        const localId = (row.merged as Record<string, unknown>)._cluster_id as string | undefined;
        if (localId) supabaseIdByLocalId.set(localId, row.id);
      }

      // For approved merges: update candidate cluster, delete orphan cluster
      for (const orphanLocalId of summary.approved) {
        const match = pendingMatches.find((m) => m.orphanClusterId === orphanLocalId);
        if (!match) continue;

        const orphanSupabaseId = supabaseIdByLocalId.get(orphanLocalId);
        const candidateSupabaseId = supabaseIdByLocalId.get(match.candidateClusterId);
        if (!orphanSupabaseId || !candidateSupabaseId) continue;

        const orphanRow = rows.find((r) => r.id === orphanSupabaseId);
        const candidateRow = rows.find((r) => r.id === candidateSupabaseId);
        if (!orphanRow || !candidateRow) continue;

        // Merge: candidate fields win, orphan fills blanks
        const mergedRecord: Record<string, unknown> = { ...orphanRow.merged as Record<string, unknown> };
        for (const [k, v] of Object.entries(candidateRow.merged as Record<string, unknown>)) {
          if (v !== null && v !== undefined && v !== '') mergedRecord[k] = v;
        }
        const mergedSources = Array.from(new Set([
          ...(candidateRow.sources ?? []),
          ...(orphanRow.sources ?? []),
        ]));

        await supabase.from('clusters').update({
          merged: mergedRecord,
          sources: mergedSources,
        }).eq('id', candidateSupabaseId);

        await supabase.from('clusters').delete().eq('id', orphanSupabaseId);
      }

      // For rejected: update archive_reason to reflect operator decision
      for (const orphanLocalId of summary.rejected) {
        const match = pendingMatches.find((m) => m.orphanClusterId === orphanLocalId);
        if (!match) continue;
        const orphanSupabaseId = supabaseIdByLocalId.get(orphanLocalId);
        if (!orphanSupabaseId) continue;

        await supabase.from('clusters').update({
          archived: true,
          archive_reason:
            `Operator kept separate from "${match.candidateName}". ` +
            'No primary identifier — return to firm for clarification.',
        }).eq('id', orphanSupabaseId);
      }

      // Mark session dedup_confirmed and advance status
      await supabase.from('sessions').update({
        dedup_confirmed: true,
        status: 'reviewing',
      }).eq('id', sessionId);

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="card p-6 text-sm text-navy-500">Loading dedup review…</div>;
  }

  if (pendingMatches.length === 0) {
    return (
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-2">No Possible Duplicates</h3>
        <p className="text-sm text-navy-500 mb-4">
          All records matched on primary keys (registration number, ID, or trust deed).
          No name-bridge candidates were found.
        </p>
        <button className="btn btn-primary" onClick={onComplete}>Continue to Review →</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card p-6 border-l-4 border-l-teal">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">
              Possible Duplicates — {pendingMatches.length} pair{pendingMatches.length !== 1 ? 's' : ''} need review
            </h3>
            <p className="text-sm text-navy-500 mt-1">
              These records have no shared registration number or ID, but their names are very similar.
              Decide whether to merge each pair or keep them as separate clients.
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={mergeAll} className="text-sm text-teal-700 underline hover:text-teal-900 whitespace-nowrap">
              Merge all
            </button>
            <span className="text-navy-200">|</span>
            <button onClick={keepAllSeparate} className="text-sm text-teal-700 underline hover:text-teal-900 whitespace-nowrap">
              Keep all separate
            </button>
          </div>
        </div>
      </div>

      {/* Pairs */}
      <div className="space-y-3">
        {pendingMatches.map((match) => {
          const decision = decisions[match.orphanClusterId];
          const pct = Math.round(match.score * 100);
          return (
            <div
              key={match.orphanClusterId}
              className={`card p-4 transition-colors ${
                decision === 'approved' ? 'bg-teal-50 border-teal-200' :
                decision === 'rejected' ? 'bg-gray-50' : 'bg-amber-50 border-amber-200'
              }`}
            >
              {/* Names row */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-navy-800 truncate">{match.orphanName}</p>
                  <div className="flex gap-1 mt-1">
                    <SourceBadge source={match.orphanSource} />
                  </div>
                </div>

                <div className="flex-shrink-0 text-center space-y-1">
                  <span className={`text-sm font-semibold ${scoreColor(match.score)}`}>{pct}%</span>
                  <p className="text-xs text-navy-400">match</p>
                  {match.signals && match.signals.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center">
                      {match.signals.map((s) => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-navy-100 text-navy-600 font-medium">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-right">
                  <p className="font-medium text-navy-800 truncate">{match.candidateName}</p>
                  <div className="flex gap-1 mt-1 justify-end flex-wrap">
                    {match.candidateSources.map((s) => (
                      <SourceBadge key={s} source={s} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Decision */}
              {decision === null ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => decide(match.orphanClusterId, 'approved')}
                    className="flex-1 btn bg-teal text-white hover:bg-teal-700 text-sm py-1.5"
                  >
                    Merge
                  </button>
                  <button
                    onClick={() => decide(match.orphanClusterId, 'rejected')}
                    className="flex-1 btn border border-navy-200 bg-white text-navy-700 hover:bg-navy-50 text-sm py-1.5"
                  >
                    Keep Separate
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${decision === 'approved' ? 'text-teal-700' : 'text-navy-600'}`}>
                    {decision === 'approved' ? '✓ Will merge' : '✗ Will keep separate'}
                  </span>
                  <button
                    onClick={() => decide(match.orphanClusterId, null)}
                    className="text-xs text-navy-400 underline hover:text-navy-600"
                  >
                    Undo
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
      )}

      {/* Confirm */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm text-navy-500">
          {Object.values(decisions).filter((v) => v !== null).length} of {pendingMatches.length} decided
        </p>
        <button
          onClick={confirm}
          disabled={!allDecided || saving}
          className={`btn btn-primary ${(!allDecided || saving) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {saving ? 'Saving…' : 'Confirm All Decisions →'}
        </button>
      </div>
    </div>
  );
}
