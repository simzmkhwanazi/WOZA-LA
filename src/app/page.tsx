'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  operator_name: string | null;
  exported_at: string | null;
  notes: string | null;
  firms: { name: string } | { name: string }[] | null;
  clientCount?: number;
}

function firmName(s: SessionRow): string {
  if (!s.firms) return '—';
  if (Array.isArray(s.firms)) return (s.firms[0] as { name?: string })?.name ?? '—';
  return (s.firms as { name: string }).name;
}

const STATUS_CONFIG: Record<string, { dot: string; label: string; cls: string }> = {
  uploading:  { dot: 'bg-amber-400',  label: 'Importing',  cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  mapping:    { dot: 'bg-purple-400', label: 'Processing', cls: 'text-purple-700 bg-purple-50 border-purple-200' },
  reviewing:  { dot: 'bg-blue-400',   label: 'Reviewing',  cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  exported:   { dot: 'bg-green-400',  label: 'Exported',   cls: 'text-green-700 bg-green-50 border-green-200' },
  archived:   { dot: 'bg-gray-300',   label: 'Archived',   cls: 'text-gray-500 bg-gray-100 border-gray-200' },
};

type FilterKey = 'all' | 'active' | 'exported' | 'archived';

export default function HomePage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newFirm, setNewFirm] = useState('');
  const [newOperator, setNewOperator] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('id, status, created_at, operator_name, exported_at, notes, firms(name)')
        .order('created_at', { ascending: false })
        .limit(100);

      const rows = (sessionData as SessionRow[]) ?? [];
      if (!rows.length) { setSessions([]); setLoading(false); return; }

      // Fetch client counts per session
      const ids = rows.map((r) => r.id);
      const { data: clusterData } = await supabase
        .from('clusters')
        .select('session_id')
        .in('session_id', ids)
        .eq('archived', false);

      const countMap: Record<string, number> = {};
      for (const c of clusterData ?? []) {
        countMap[c.session_id] = (countMap[c.session_id] ?? 0) + 1;
      }

      setSessions(rows.map((r) => ({ ...r, clientCount: countMap[r.id] ?? 0 })));
      setLoading(false);
    }
    void load();
  }, [supabase]);

  async function createSession() {
    if (!newFirm.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firmName: newFirm.trim(),
          operatorName: newOperator.trim() || undefined,
          notes: newNotes.trim() || undefined,
        }),
      });
      const data = await res.json() as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        alert(data.error ?? 'Failed to create session');
        setCreating(false);
        return;
      }
      setShowNewModal(false);
      router.push(`/sessions/${data.sessionId}?tab=upload`);
    } catch {
      alert('Failed to create session');
      setCreating(false);
    }
  }

  // Stats
  const stats = useMemo(() => ({
    total:    sessions.length,
    active:   sessions.filter((s) => ['uploading','mapping','reviewing'].includes(s.status)).length,
    exported: sessions.filter((s) => s.status === 'exported').length,
    attention: sessions.filter((s) => s.status === 'mapping').length,
  }), [sessions]);

  // Filtered list
  const filtered = useMemo(() => {
    let list = sessions;
    if (filter === 'active')   list = list.filter((s) => ['uploading','mapping','reviewing'].includes(s.status));
    if (filter === 'exported') list = list.filter((s) => s.status === 'exported');
    if (filter === 'archived') list = list.filter((s) => s.status === 'archived');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => firmName(s).toLowerCase().includes(q) || (s.operator_name ?? '').toLowerCase().includes(q));
    }
    return list;
  }, [sessions, filter, search]);

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-800">Onboarding Sessions</h1>
        <p className="text-sm text-navy-500 mt-1">Import, consolidate, and export client data for DataGrows onboarding.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { num: stats.total,    label: 'Total sessions', color: 'text-navy-800' },
          { num: stats.active,   label: 'In progress',    color: 'text-teal' },
          { num: stats.exported, label: 'Exported',       color: 'text-green-600' },
          { num: stats.attention,label: 'Needs attention',color: 'text-amber-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-5 py-4">
            <div className={`text-3xl font-bold ${s.color}`}>{s.num}</div>
            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-navy-800">All Sessions</h2>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-5 py-2 bg-teal text-white text-sm font-semibold rounded-lg hover:bg-teal-600 transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Session
        </button>
      </div>

      {/* Search + filters */}
      <div className="flex gap-3 mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search firms or operators…"
          className="flex-1 px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
        />
        {(['all','active','exported','archived'] as FilterKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors capitalize ${
              filter === key
                ? 'bg-teal text-white border-teal'
                : 'bg-white text-gray-600 border-gray-200 hover:border-teal hover:text-teal'
            }`}
          >
            {key === 'all' ? 'All' : key === 'active' ? 'In Progress' : key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      {/* Sessions table */}
      {loading ? (
        <div className="text-sm text-gray-400 text-center py-16">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl text-center py-16">
          <p className="text-gray-400 text-sm mb-4">{sessions.length === 0 ? 'No sessions yet.' : 'No sessions match your filter.'}</p>
          {sessions.length === 0 && (
            <button onClick={() => setShowNewModal(true)} className="px-5 py-2 bg-teal text-white text-sm font-semibold rounded-lg hover:bg-teal-600">
              Create your first session
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Firm</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Clients</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Operator</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Last Updated</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const name = firmName(s);
                const cfg = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.archived;
                const date = new Date(s.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
                return (
                  <tr
                    key={s.id}
                    onClick={() => router.push(`/sessions/${s.id}?tab=upload`)}
                    className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-teal-50 transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-navy-800">{name}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-600">{s.clientCount ?? 0}</td>
                    <td className="px-4 py-3.5 text-gray-600">{s.operator_name ?? '—'}</td>
                    <td className="px-4 py-3.5 text-gray-400">{date}</td>
                    <td className="px-4 py-3.5">
                      {s.notes ? (
                        <span className="text-xs text-gray-400 italic truncate max-w-[160px] block">{s.notes}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Session Modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewModal(false); }}
        >
          <div className="bg-white rounded-2xl p-8 w-[480px] max-w-[90vw] shadow-2xl">
            <h2 className="text-xl font-bold text-navy-800 mb-1">New Onboarding Session</h2>
            <p className="text-sm text-gray-500 mb-6">Create a session to start importing a firm&apos;s client data.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-navy-800 mb-1.5">Firm Name</label>
                <input
                  type="text"
                  value={newFirm}
                  onChange={(e) => setNewFirm(e.target.value)}
                  placeholder="e.g. Rich Accountants"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">The accounting or audit firm you&apos;re onboarding.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-navy-800 mb-1.5">Operator</label>
                <input
                  type="text"
                  value={newOperator}
                  onChange={(e) => setNewOperator(e.target.value)}
                  placeholder="e.g. Simz"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                />
                <p className="text-xs text-gray-400 mt-1">Who&apos;s running this onboarding session.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-navy-800 mb-1.5">
                  Notes <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="e.g. Firm sent Sage + SARS exports"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-7">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-5 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createSession}
                disabled={!newFirm.trim() || creating}
                className="px-6 py-2 text-sm font-semibold bg-teal text-white rounded-lg hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating…' : 'Create Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
