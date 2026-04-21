'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS, FIELD_BY_COL, type FieldDef, type ClientRecord } from '@/lib/schema/datagrows';
import { validateRecord } from '@/lib/validator';

const QUICK_FIELDS = [
  'client_name', 'trading_name', 'entity_type', 'status', 'year_end',
  'accountant', 'partner', 'manager',
  'primary_contact', 'contact_nr', 'contact_email',
  'tax_nr', 'registration_nr', 'vat_nr', 'id_number',
];

const FIELD_GROUPS: { label: string; cols: string[] }[] = [
  { label: 'Identity',         cols: ['A','B','C','D','E','F','G'] },
  { label: 'Registration',     cols: ['H','I','J','K','L','M','N'] },
  { label: 'Contact',          cols: ['Q','R','S','T'] },
  { label: 'Tax Numbers',      cols: ['U','V','W','X','Y','Z'] },
  { label: 'Staff',            cols: ['AA','AB','AC','AD','AE','AF','AG','AH'] },
];

interface ClusterRow {
  id: string;
  data: Record<string, unknown>;
  sourceFiles: string[];
  archived: boolean;
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === 'enum' && field.enum) {
    return (
      <select className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (field.type === 'boolean') {
    const boolStr = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value ?? '');
    return (
      <select className="input" value={boolStr} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="TRUE">Yes</option>
        <option value="FALSE">No</option>
      </select>
    );
  }
  if (field.type === 'longtext') {
    return <textarea className="input resize-none" rows={2} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      type="text"
      className="input"
      value={String(value ?? '')}
      placeholder={field.type === 'date' ? 'dd/mm/yyyy' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ClientsListStep({
  sessionId,
  firmId,
  onReRunImport,
  onGoToDetailedReview,
}: {
  sessionId: string;
  firmId: string;
  onReRunImport: () => void;
  onGoToDetailedReview?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [clients, setClients] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPipelined, setIsPipelined] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'ok' | 'errors' | 'warnings'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState<Record<string, unknown>>({});
  const [savingNew, setSavingNew] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const { data: clusterData } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived')
      .eq('session_id', sessionId);

    if (clusterData && clusterData.length > 0) {
      setIsPipelined(true);
      setClients(
        (clusterData as { id: string; merged: ClientRecord; sources: string[] | null; archived: boolean }[]).map((r) => ({
          id: r.id,
          data: r.merged as Record<string, unknown>,
          sourceFiles: r.sources ?? [],
          archived: r.archived,
        })),
      );
    } else {
      setIsPipelined(false);
      setClients([]);
    }

    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    document.body.style.overflow = (editingId || addingClient) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [editingId, addingClient]);

  const decorated = useMemo(() =>
    clients.map((c) => ({
      ...c,
      validation: isPipelined && !c.archived ? validateRecord(c.data as ClientRecord) : null,
    })),
  [clients, isPipelined]);

  const filtered = useMemo(() => {
    let base = showArchived ? decorated : decorated.filter((c) => !c.archived);

    if (filterStatus === 'ok')       base = base.filter((c) => c.validation?.ok && !c.validation.issues.some(i => i.severity === 'warning'));
    if (filterStatus === 'errors')   base = base.filter((c) => c.validation && !c.validation.ok);
    if (filterStatus === 'warnings') base = base.filter((c) => c.validation?.issues.some(i => i.severity === 'warning'));

    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((c) =>
        String(c.data.client_name ?? '').toLowerCase().includes(q) ||
        String(c.data.trading_name ?? '').toLowerCase().includes(q) ||
        String(c.data.tax_nr ?? '').toLowerCase().includes(q) ||
        String(c.data.registration_nr ?? '').toLowerCase().includes(q),
      );
    }
    return base;
  }, [decorated, search, filterStatus, showArchived]);

  const counts = useMemo(() => {
    const active = decorated.filter((c) => !c.archived);
    return {
      total: active.length,
      ok: active.filter((c) => c.validation?.ok && !c.validation.issues.some(i => i.severity === 'warning')).length,
      errors: active.filter((c) => c.validation && !c.validation.ok).length,
      warnings: active.filter((c) => c.validation?.issues.some(i => i.severity === 'warning') && c.validation.ok).length,
      archived: decorated.filter((c) => c.archived).length,
    };
  }, [decorated]);

  function updateField(id: string, key: string, value: unknown) {
    setLocalEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value } }));
    setClients((prev) =>
      prev.map((c) => c.id === id ? { ...c, data: { ...c.data, [key]: value } } : c),
    );
  }

  async function saveEdits(id: string) {
    const edits = localEdits[id];
    setSaving(true);
    if (edits && Object.keys(edits).length > 0) {
      const client = clients.find((c) => c.id === id);
      if (client) {
        await supabase.from('clusters').update({ merged: client.data }).eq('id', id);
      }
      setLocalEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
    setSaving(false);
    setEditingId(null);
  }

  async function addClientManually() {
    setSavingNew(true);
    const rec: Record<string, unknown> = { ...newClient, _sources: ['manual'], _manual: true };
    await supabase.from('clusters').insert({
      session_id: sessionId,
      primary_key_type: 'none',
      primary_key_value: '',
      merged: rec,
      flags: {},
      conflicts: {},
      sources: ['manual'],
      archived: false,
    });
    setNewClient({});
    setAddingClient(false);
    setSavingNew(false);
    void load();
  }

  async function handleReRunImport() {
    setResetting(true);
    await supabase.from('clusters').delete().eq('session_id', sessionId);
    await supabase.from('sessions').update({ status: 'mapping', dedup_confirmed: false, pending_name_matches: [] }).eq('id', sessionId);
    setResetting(false);
    setShowRerunConfirm(false);
    onReRunImport();
  }

  const editingClient = editingId ? clients.find((c) => c.id === editingId) : null;
  const editingDecIdx = editingId ? filtered.findIndex((c) => c.id === editingId) : -1;
  const prevClient = editingDecIdx > 0 ? filtered[editingDecIdx - 1] : null;
  const nextClient = editingDecIdx < filtered.length - 1 ? filtered[editingDecIdx + 1] : null;

  if (loading) return <div className="card p-6 text-sm text-navy-400">Loading clients…</div>;

  if (!isPipelined) {
    return (
      <div className="card p-10 text-center space-y-3">
        <div className="text-4xl">⏳</div>
        <h3 className="font-semibold text-navy-800">Import not run yet</h3>
        <p className="text-sm text-navy-500 max-w-sm mx-auto">
          Upload your source files on the Import tab, then run the pipeline. Once processed, all clients will appear here.
        </p>
        <button
          className="btn btn-primary text-sm mt-2"
          onClick={() => { setNewClient({}); setAddingClient(true); }}
        >
          + Add Client Manually
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Stat filter bar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        {([
          ['all',      `All (${counts.total})`,          'bg-teal-600 text-white border-teal-600',          'border border-gray-200 text-navy-600 hover:border-teal-400'],
          ['ok',       `Ready (${counts.ok})`,            'bg-emerald-600 text-white border-emerald-600',    'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'],
          ['errors',   `Errors (${counts.errors})`,       'bg-rose-600 text-white border-rose-600',          'border border-rose-200 text-rose-600 hover:bg-rose-50'],
          ['warnings', `Warnings (${counts.warnings})`,   'bg-amber-500 text-white border-amber-500',        'border border-amber-200 text-amber-600 hover:bg-amber-50'],
        ] as [typeof filterStatus, string, string, string][]).map(([k, label, activeClass, inactiveClass]) => (
          <button
            key={k}
            onClick={() => setFilterStatus(k)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${filterStatus === k ? activeClass : inactiveClass}`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
            showArchived ? 'bg-gray-500 text-white border-gray-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          Archived ({counts.archived})
        </button>
        <div className="flex gap-2 ml-auto">
          <button className="btn btn-secondary text-sm" onClick={() => { setNewClient({}); setAddingClient(true); }}>
            + Add Client
          </button>
          <button
            className="btn border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm"
            onClick={() => setShowRerunConfirm(true)}
          >
            Re-run Import
          </button>
          {onGoToDetailedReview && (
            <button className="btn btn-ghost text-sm" onClick={onGoToDetailedReview}>
              Detailed Review →
            </button>
          )}
        </div>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <input
        type="text"
        className="input h-9 text-sm w-full max-w-sm"
        placeholder="Search by name, tax nr or reg nr…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-navy-50 text-left text-navy-700 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2.5 font-medium text-xs w-8">#</th>
                <th className="px-3 py-2.5 font-medium text-xs">Client Name</th>
                <th className="px-3 py-2.5 font-medium text-xs">Entity Type</th>
                <th className="px-3 py-2.5 font-medium text-xs">Tax Nr</th>
                <th className="px-3 py-2.5 font-medium text-xs">Reg Nr</th>
                <th className="px-3 py-2.5 font-medium text-xs">Year End</th>
                <th className="px-3 py-2.5 font-medium text-xs hidden md:table-cell">Accountant</th>
                <th className="px-3 py-2.5 font-medium text-xs hidden sm:table-cell">Email</th>
                <th className="px-3 py-2.5 font-medium text-xs">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {filtered.map((c, idx) => {
                const v = c.validation;
                const errorCount  = v?.issues.filter(i => i.severity === 'error').length ?? 0;
                const warnCount   = v?.issues.filter(i => i.severity === 'warning').length ?? 0;
                const isNameBad   = errorCount > 0 && v?.issues.some(i => i.field === 'client_name');
                return (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer select-none transition-colors ${
                      c.archived ? 'opacity-50 bg-gray-50' :
                      isNameBad  ? 'bg-rose-50 hover:bg-rose-100' :
                      errorCount > 0 ? 'hover:bg-rose-50/40' :
                      'hover:bg-navy-50'
                    }`}
                    onClick={() => setEditingId(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingId(c.id); } }}
                  >
                    <td className="px-3 py-2.5 text-xs text-navy-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-medium max-w-[200px] truncate">
                      <span className={isNameBad ? 'text-rose-700 line-through' : 'text-navy-800'}>
                        {String(c.data.client_name ?? '—')}
                      </span>
                      {c.archived && <span className="ml-1.5 text-[9px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">ARCHIVED</span>}
                    </td>
                    <td className="px-3 py-2.5 text-navy-600 text-xs">{String(c.data.entity_type ?? '—')}</td>
                    <td className="px-3 py-2.5 text-navy-500 text-xs font-mono">{String(c.data.tax_nr ?? '—')}</td>
                    <td className="px-3 py-2.5 text-navy-500 text-xs font-mono">{String(c.data.registration_nr ?? '—')}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {String(c.data.year_end ?? '—') === 'February'
                        ? <span className="text-blue-600 font-medium">February</span>
                        : <span className="text-navy-600">{String(c.data.year_end ?? '—')}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-navy-500 text-xs hidden md:table-cell truncate max-w-[120px]">
                      {String(c.data.accountant ?? '—')}
                    </td>
                    <td className="px-3 py-2.5 text-navy-500 text-xs hidden sm:table-cell truncate max-w-[160px]">
                      {String(c.data.contact_email ?? '—')}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {c.archived ? (
                        <span className="text-gray-400">—</span>
                      ) : errorCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold border border-rose-200 text-[10px]">
                          {errorCount} error{errorCount > 1 ? 's' : ''}
                        </span>
                      ) : warnCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold border border-amber-200 text-[10px]">
                          {warnCount} warn
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200 text-[10px]">OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="px-6 py-8 text-sm text-navy-400 text-center">No clients match your filter.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-navy-100 bg-navy-50 flex items-center justify-between">
          <p className="text-xs text-navy-400">{filtered.length} of {clients.filter(c => showArchived || !c.archived).length} shown</p>
        </div>
      </div>

      {/* ── Edit modal ─────────────────────────────────────────────────────── */}
      {editingId && editingClient && (() => {
        const v = isPipelined ? validateRecord(editingClient.data as ClientRecord) : null;
        return (
          <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => void saveEdits(editingId)} />
            <div className="relative z-10 flex flex-col bg-white w-full h-full sm:m-4 sm:rounded-2xl sm:h-[calc(100vh-2rem)] sm:max-w-3xl sm:mx-auto overflow-hidden shadow-2xl">

              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-navy-100 shrink-0">
                <div>
                  <h3 className="text-lg font-semibold text-navy-800">
                    {String(editingClient.data.client_name ?? 'Unnamed client')}
                  </h3>
                  <p className="text-xs text-navy-400 mt-0.5">
                    Sources: {editingClient.sourceFiles.join(', ') || 'manual'}
                    {localEdits[editingId] && <span className="ml-2 text-teal-600 font-medium">· unsaved changes</span>}
                  </p>
                </div>
                <button onClick={() => void saveEdits(editingId)} className="btn btn-ghost">Close ✕</button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* Validation issues */}
                {v && v.issues.length > 0 && (
                  <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 space-y-2">
                    <p className="text-sm font-semibold text-rose-800">Issues to fix:</p>
                    <ul className="space-y-1.5">
                      {v.issues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className={`mt-0.5 shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                            issue.severity === 'error'
                              ? 'bg-rose-100 text-rose-700 border-rose-300'
                              : 'bg-amber-100 text-amber-700 border-amber-300'
                          }`}>
                            {issue.severity}
                          </span>
                          <span className="text-navy-700">{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Quick fields */}
                <div className="p-4 bg-navy-50 rounded-lg border border-navy-100">
                  <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">Key Details</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {QUICK_FIELDS.map((key) => {
                      const f = DATAGROWS_FIELDS.find((x) => x.key === key);
                      if (!f) return null;
                      const hasIssue = v?.issues.some(i => i.field === f.key);
                      return (
                        <div key={f.key}>
                          <label className={`block text-xs font-medium mb-1 ${hasIssue ? 'text-rose-600' : 'text-navy-600'}`}>
                            {f.header}{hasIssue ? ' ⚠' : ''}
                          </label>
                          <FieldInput field={f} value={editingClient.data[f.key]} onChange={(val) => updateField(editingId, f.key, val)} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* All other field groups */}
                {FIELD_GROUPS.map((group) => {
                  const fields = group.cols
                    .map((col) => FIELD_BY_COL[col])
                    .filter((f): f is FieldDef => !!f && !QUICK_FIELDS.includes(f.key));
                  if (fields.length === 0) return null;
                  return (
                    <div key={group.label} className="p-4 bg-navy-50 rounded-lg border border-navy-100">
                      <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">{group.label}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {fields.map((f) => (
                          <div key={f.key}>
                            <label className="block text-xs font-medium text-navy-600 mb-1">{f.header}</label>
                            <FieldInput field={f} value={editingClient.data[f.key]} onChange={(val) => updateField(editingId, f.key, val)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-navy-100 bg-navy-50 flex items-center justify-between shrink-0">
                <div className="flex gap-2">
                  <button disabled={!prevClient} onClick={() => { void saveEdits(editingId); setTimeout(() => setEditingId(prevClient!.id), 0); }} className="btn btn-ghost text-sm disabled:opacity-30">← Prev</button>
                  <button disabled={!nextClient} onClick={() => { void saveEdits(editingId); setTimeout(() => setEditingId(nextClient!.id), 0); }} className="btn btn-ghost text-sm disabled:opacity-30">Next →</button>
                  <span className="text-xs text-navy-400 self-center ml-1">{editingDecIdx + 1} / {filtered.length}</span>
                </div>
                <button onClick={() => void saveEdits(editingId)} className="btn btn-primary text-sm" disabled={saving}>
                  {saving ? 'Saving…' : 'Save & Close'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Add Client modal ────────────────────────────────────────────────── */}
      {addingClient && (
        <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setAddingClient(false)} />
          <div className="relative z-10 flex flex-col bg-white w-full h-full sm:m-4 sm:rounded-2xl sm:h-[calc(100vh-2rem)] sm:max-w-3xl sm:mx-auto overflow-hidden shadow-2xl">
            <div className="flex items-start justify-between px-6 py-4 border-b border-navy-100 shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-navy-800">Add Client</h3>
                <p className="text-xs text-navy-400 mt-0.5">Added directly to the processed client list.</p>
              </div>
              <button onClick={() => setAddingClient(false)} className="btn btn-ghost">Close ✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="p-4 bg-navy-50 rounded-lg border border-navy-100">
                <div className="grid grid-cols-2 gap-3">
                  {QUICK_FIELDS.map((key) => {
                    const f = DATAGROWS_FIELDS.find((x) => x.key === key);
                    if (!f) return null;
                    return (
                      <div key={f.key}>
                        <label className="block text-xs font-medium text-navy-600 mb-1">{f.header}</label>
                        <FieldInput field={f} value={newClient[f.key]} onChange={(val) => setNewClient((prev) => ({ ...prev, [f.key]: val }))} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-navy-100 bg-navy-50 flex justify-end gap-3 shrink-0">
              <button onClick={() => setAddingClient(false)} className="btn btn-ghost text-sm">Cancel</button>
              <button
                onClick={() => void addClientManually()}
                disabled={savingNew || !newClient.client_name}
                className="btn btn-primary text-sm disabled:opacity-40"
              >
                {savingNew ? 'Saving…' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Re-run Import confirmation ──────────────────────────────────────── */}
      {showRerunConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setShowRerunConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-navy-800">Re-run Import?</h3>
            <p className="text-sm text-navy-500">
              This clears all processed clients (Review and Export pages) and re-runs the full import pipeline from your uploaded files. Manually added clients will also be cleared.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowRerunConfirm(false)} className="btn btn-ghost text-sm">Cancel</button>
              <button
                onClick={() => void handleReRunImport()}
                disabled={resetting}
                className="btn text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 px-4 py-2 rounded-lg disabled:opacity-40"
              >
                {resetting ? 'Clearing…' : 'Re-run Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
