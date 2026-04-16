'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  operator_name: string | null;
  firms: { name: string } | { name: string }[] | null;
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

export default function HomePage() {
  const supabase = createClient();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('sessions')
      .select('id, status, created_at, operator_name, firms(name)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setSessions((data as SessionRow[]) ?? []);
        setLoading(false);
      });
  }, [supabase]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-navy-800">Onboarding Sessions</h2>
          <p className="text-sm text-navy-500 mt-1">
            One session per firm. Produces a single DataGrows master Excel.
          </p>
        </div>
        <Link
          href="/sessions/new"
          className="btn btn-primary flex-shrink-0"
          data-tour="btn-new-session"
        >
          New Session
        </Link>
      </div>

      <div className="card overflow-hidden" data-tour="sessions-table">
        {loading ? (
          <p className="px-6 py-10 text-sm text-navy-500 text-center">Loading…</p>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center text-navy-500">
            <p className="mb-4">No sessions yet.</p>
            <Link href="/sessions/new" className="btn btn-primary">
              Create your first session
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-navy-700 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Firm</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Operator</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {sessions.map((s) => {
                const name = firmName(s);
                const { cls, label } = statusBadge(s.status);
                return (
                  <tr
                    key={s.id}
                    onClick={() => router.push(`/sessions/${s.id}`)}
                    className="hover:bg-navy-50 cursor-pointer active:bg-navy-100 transition-colors"
                  >
                    {/* Firm name — primary tap target on mobile */}
                    <td className="px-4 py-3">
                      <span className="font-semibold text-navy-800 group-hover:text-teal-700">
                        {name}
                      </span>
                      {/* Operator shown as subtitle on mobile only */}
                      {s.operator_name && (
                        <span className="block text-xs text-navy-400 mt-0.5 sm:hidden">
                          {s.operator_name}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`badge ${cls}`}>{label}</span>
                    </td>

                    {/* Operator — hidden on mobile, subtitle handles it */}
                    <td className="px-4 py-3 text-navy-500 hidden sm:table-cell">
                      {s.operator_name ?? '—'}
                    </td>

                    {/* Created date — hidden on mobile + tablet */}
                    <td className="px-4 py-3 text-navy-500 hidden md:table-cell">
                      {new Date(s.created_at).toLocaleDateString('en-ZA')}
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
