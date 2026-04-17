'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface SessionStats {
  total: number;
  errors: number;
  warnings: number;
  lastProcessed: string | null;
  hasPendingReExport: boolean;
}

interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  operator_name: string | null;
  last_exported_at: string | null;
  firms: { name: string } | { name: string }[] | null;
  stats?: SessionStats;
}

function firmName(s: SessionRow): string {
  if (!s.firms) return '—';
  if (Array.isArray(s.firms)) return (s.firms[0] as { name?: string })?.name ?? '—';
  return (s.firms as { name: string }).name;
}

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case 'uploading':  return { cls: 'badge-muted',  label: 'Uploading' };
    case 'mapping':    return { cls: 'badge-warn',   label: 'Mapping' };
    case 'reviewing':  return { cls: 'badge-warn',   label: 'Reviewing' };
    case 'exported':   return { cls: 'badge-ok',     label: 'Exported' };
    case 'archived':   return { cls: 'badge-muted',  label: 'Archived' };
    default:           return { cls: 'badge-muted',  label: status };
  }
}

const STAGE_LINKS = [
  { tab: 'upload',    label: 'Upload' },
  { tab: 'mapping',   label: 'Process' },
  { tab: 'review',    label: 'Review' },
  { tab: 'dashboard', label: 'Dashboard' },
  { tab: 'export',    label: 'Export' },
] as const;

export default function HomePage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // Fetch sessions
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('id, status, created_at, operator_name, last_exported_at, firms(name)')
        .order('created_at', { ascending: false })
        .limit(50);

      const rows = (sessionData as SessionRow[]) ?? [];
      if (rows.length === 0) { setSessions([]); setLoading(false); return; }

      // Fetch cluster counts and last processed date per session in one query
      const sessionIds = rows.map((r) => r.id);
      const { data: clusterData } = await supabase
        .from('clusters')
        .select('session_id, merged, archived, created_at')
        .in('session_id', sessionIds);

      // Fetch post-export edits — check if any edits exist after last_exported_at per session
      const exportedSessions = rows.filter((r) => r.last_exported_at);
      let pendingReExportIds = new Set<string>();
      if (exportedSessions.length > 0) {
        // For each exported session, check if edits exist after last_exported_at
        for (const s of exportedSessions) {
          const { count } = await supabase
            .from('edits')
            .select('id', { count: 'exact', head: true })
            .gt('created_at', s.last_exported_at!);
          if ((count ?? 0) > 0) pendingReExportIds.add(s.id);
        }
      }

      // Compute per-session stats from cluster data
      const statsMap: Record<string, SessionStats> = {};
      for (const s of rows) {
        const sessionClusters = (clusterData ?? []).filter((c) => c.session_id === s.id);
        const dates = sessionClusters.map((c) => c.created_at).filter(Boolean).sort().reverse();
        let errors = 0;
        let warnings = 0;
        for (const c of sessionClusters) {
          if (c.archived) continue;
          // Simple validation check from merged data
          const merged = c.merged as Record<string, unknown>;
          if (!merged.client_name || !merged.entity_type || !merged.year_end) errors++;
        }
        statsMap[s.id] = {
          total: sessionClusters.filter((c) => !c.archived).length,
          errors,
          warnings,
          lastProcessed: dates[0] ?? null,
          hasPendingReExport: pendingReExportIds.has(s.id),
        };
      }

      setSessions(rows.map((r) => ({ ...r, stats: statsMap[r.id] })));
      setLoading(false);
    }
    void load();
  }, [supabase]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-navy-800">Onboarding Sessions</h2>
          <p className="text-sm text-navy-500 mt-1">
            One session per firm. Click a stage link to jump directly into any step.
          </p>
        </div>
        <Link href="/sessions/new" className="btn btn-primary flex-shrink-0" data-tour="btn-new-session">
          New Session
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-navy-500 text-center py-10">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="card p-12 text-center text-navy-500">
          <p className="mb-4">No sessions yet.</p>
          <Link href="/sessions/new" className="btn btn-primary">Create your first session</Link>
        </div>
      ) : (
        <div className="space-y-3" data-tour="sessions-table">
          {sessions.map((s) => {
            const name = firmName(s);
            const { cls, label } = statusBadge(s.status);
            const stats = s.stats;
            const date = new Date(s.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
            const lastProc = stats?.lastProcessed
              ? new Date(stats.lastProcessed).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
              : null;

            return (
              <div key={s.id} className="card p-4 sm:p-5 hover:shadow-md transition-shadow">
                {/* Top row: firm name + status + date */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-navy-800 text-base truncate">{name}</h3>
                    {s.operator_name && (
                      <p className="text-xs text-navy-400 mt-0.5">Operator: {s.operator_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`badge ${cls}`}>{label}</span>
                    <span className="text-xs text-navy-400 hidden sm:block">{date}</span>
                  </div>
                </div>

                {/* Mini-stats */}
                {stats && stats.total > 0 && (
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className="text-xs text-navy-600 font-medium">{stats.total} clients</span>
                    {stats.errors > 0 && (
                      <span className="text-xs text-rose-600 font-medium">· {stats.errors} errors</span>
                    )}
                    {stats.warnings > 0 && (
                      <span className="text-xs text-amber-600">· {stats.warnings} warnings</span>
                    )}
                    {lastProc && (
                      <span className="text-xs text-navy-400">· Last processed {lastProc}</span>
                    )}
                    {/* Re-export indicator — soft indigo, non-alarming */}
                    {stats.hasPendingReExport && (
                      <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        ◷ Changes since last export
                      </span>
                    )}
                  </div>
                )}

                {/* Stage jump links */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-navy-400 mr-1">Go to:</span>
                  {STAGE_LINKS.map(({ tab, label: stageLabel }) => (
                    <Link
                      key={tab}
                      href={`/sessions/${s.id}?tab=${tab}`}
                      className="text-xs px-2.5 py-1 rounded-full border border-navy-200 text-navy-600 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {stageLabel}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
