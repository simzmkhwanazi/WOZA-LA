import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, status, created_at, operator_name, firms(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-navy-800">Onboarding Sessions</h2>
          <p className="text-sm text-navy-500 mt-1">
            One session per firm. Produces a single DataGrows master Excel.
          </p>
        </div>
        <Link href="/sessions/new" className="btn btn-primary">
          New Session
        </Link>
      </div>

      <div className="card overflow-hidden">
        {sessions && sessions.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-navy-700 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Firm</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Operator</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {sessions.map((s) => {
                const firmName = Array.isArray(s.firms)
                  ? (s.firms[0] as { name?: string } | undefined)?.name ?? '—'
                  : (s.firms as { name?: string } | null)?.name ?? '—';
                const { cls, label } = statusBadge(s.status);
                return (
                  <tr key={s.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3 font-medium text-navy-800">{firmName}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${cls}`}>{label}</span>
                    </td>
                    <td className="px-4 py-3 text-navy-500">
                      {(s as { operator_name?: string | null }).operator_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-navy-500">
                      {new Date(s.created_at).toLocaleDateString('en-ZA')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/sessions/${s.id}`} className="btn btn-ghost text-xs">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-12 text-center text-navy-500">
            <p className="mb-4">No sessions yet.</p>
            <Link href="/sessions/new" className="btn btn-primary">
              Create your first session
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function statusBadge(status: string): { cls: string; label: string } {
  switch (status) {
    case 'uploading':  return { cls: 'badge-muted', label: 'Uploading' };
    case 'mapping':    return { cls: 'badge-warn',  label: 'Mapping' };
    case 'reviewing':  return { cls: 'badge-warn',  label: 'Reviewing' };
    case 'exported':   return { cls: 'badge-ok',    label: 'Exported' };
    case 'archived':   return { cls: 'badge-muted', label: 'Archived' };
    default:           return { cls: 'badge-muted', label: status };
  }
}
