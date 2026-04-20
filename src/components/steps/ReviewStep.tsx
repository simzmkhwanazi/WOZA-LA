'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS, FIELD_BY_COL, REQUIRED_FIELDS, type FieldDef, type ClientRecord } from '@/lib/schema/datagrows';
import { validateRecord } from '@/lib/validator';
import { humanizeIssue } from '@/lib/validator/humanize';

// ── Field groups — every column accounted for ────────────────────────────────
const FIELD_GROUPS: { label: string; cols: string[] }[] = [
  { label: 'Identity',         cols: ['A','B','C','D','E'] },
  { label: 'Registration',     cols: ['F','G','H','I','J','K','L','M','N'] },
  { label: 'Personal',         cols: ['O','P'] },
  { label: 'Contact',          cols: ['Q','R','S','T'] },
  { label: 'Tax Numbers',      cols: ['U','V','W','X','Y','Z'] },
  { label: 'Staff',            cols: ['AA','AB','AC','AD','AE','AF','AG','AH'] },
  { label: 'Accounting',       cols: ['AI','AJ','AK'] },
  { label: 'VAT',              cols: ['AL','AM'] },
  { label: 'Payroll',          cols: ['AN','AO','AP','AQ','AR','AS'] },
  { label: 'Employment',       cols: ['AT','AU'] },
  { label: 'Services',         cols: ['AV','AW','AX','AY','AZ','BA','BB','BC','BD','BE','BF','BG'] },
  { label: 'Operations',       cols: ['BH','BI','BJ','BK','BL','BM','BN','BO','BP','BQ','BR'] },
  { label: 'Physical Address', cols: ['BS','BT','BU','BV','BW','BX','BY','BZ'] },
  { label: 'Postal Address',   cols: ['CA','CB','CC','CD','CE','CF','CG','CH'] },
];

// ── Per-field input rendered according to type ────────────────────────────────
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.type === 'enum' && field.enum) {
    const strVal = String(value ?? '');
    return (
      <select className="input" value={strVal} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (field.type === 'boolean') {
    const boolStr =
      typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value ?? '');
    return (
      <select className="input" value={boolStr} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="TRUE">Yes</option>
        <option value="FALSE">No</option>
      </select>
    );
  }

  if (field.type === 'longtext') {
    return (
      <textarea
        className="input resize-none"
        rows={2}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      />
    );
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

// ── Modified-after-export tooltip ────────────────────────────────────────────
interface EditRecord {
  cluster_id: string;
  field_key: string;
  old_value: unknown;
  new_value: unknown;
  operator: string | null;
  created_at: string;
}

function ModifiedMarker({ edits }: { edits: EditRecord[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="Modified after last export"
        className="text-amber-500 hover:text-amber-600 transition-colors"
        aria-label="View changes since last export"
      >
        ◷
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-6 w-72 bg-white border border-navy-200 rounded-lg shadow-lg p-3 text-xs">
          <p className="font-semibold text-navy-700 mb-2">Changes since last export</p>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {edits.map((e, i) => {
              const fieldLabel = DATAGROWS_FIELDS.find((f) => f.key === e.field_key)?.header ?? e.field_key;
              const date = new Date(e.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
              return (
                <li key={i} className="text-navy-600">
                  <span className="font-medium">{fieldLabel}:</span>{' '}
                  <span className="text-rose-500 line-through">{String(e.old_value ?? '—')}</span>
                  {' → '}
                  <span className="text-green-600">{String(e.new_value ?? '—')}</span>
                  <span className="text-navy-400 ml-1">({date}{e.operator ? `, ${e.operator}` : ''})</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[];
  archived: boolean;
  archive_reason: string | null;
  primary_key_value: string;
}

type Filter = 'all' | 'ready' | 'errors' | 'warnings' | 'archived' | 'dormant';
type FirmTab = 'company' | 'employees' | 'suppliers';

export function ReviewStep({
  sessionId,
  operatorName,
  initialFilter,
  onOpenFirmSlideOver,
  onGoToImport,
  onProceedToExport,
}: {
  sessionId: string;
  operatorName?: string | null;
  initialFilter?: Filter;
  onOpenFirmSlideOver?: (tab: FirmTab) => void;
  onGoToImport?: () => void;
  onProceedToExport?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Default to 'all' — clerks can see and edit any record, clean or not
  const [filter, setFilter] = useState<Filter>(initialFilter ?? 'all');
  const [editing, setEditing] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixed: number } | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [lastExportedAt, setLastExportedAt] = useState<Date | null>(null);
  const [postExportEdits, setPostExportEdits] = useState<EditRecord[]>([]);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    // Load clusters
    const { data: clusterData } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived, archive_reason, primary_key_value')
      .eq('session_id', sessionId);
    setClusters((clusterData as ClusterRow[]) ?? []);

    // Load session's last_exported_at for modified-after-export markers
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('last_exported_at')
      .eq('id', sessionId)
      .single();
    const exportedAt = sessionData?.last_exported_at ? new Date(sessionData.last_exported_at) : null;
    setLastExportedAt(exportedAt);

    // If there was an export, load all edits made after it (for modified markers)
    if (exportedAt) {
      const { data: editData } = await supabase
        .from('edits')
        .select('cluster_id, field_key, old_value, new_value, operator, created_at')
        .gt('created_at', exportedAt.toISOString())
        .in('cluster_id', (clusterData ?? []).map((c: ClusterRow) => c.id));
      setPostExportEdits((editData as EditRecord[]) ?? []);
    } else {
      setPostExportEdits([]);
    }

    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (editing) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [editing]);

  // Group post-export edits by cluster id for O(1) lookup
  const editsByCluster = useMemo(() => {
    const map: Record<string, EditRecord[]> = {};
    for (const e of postExportEdits) {
      if (!map[e.cluster_id]) map[e.cluster_id] = [];
      map[e.cluster_id].push(e);
    }
    return map;
  }, [postExportEdits]);

  const decorated = useMemo(() => {
    return clusters.map((c) => {
      const validation = validateRecord(c.merged);
      return { ...c, validation };
    });
  }, [clusters]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'ready':
        return decorated.filter((c) => !c.archived && c.validation.ok);
      case 'errors':
        return decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'error'));
      case 'warnings':
        return decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'warning'));
      case 'archived':
        return decorated.filter((c) => c.archived);
      case 'dormant':
        return decorated.filter((c) => c.merged.status === 'Dormant');
      default:
        return decorated;
    }
  }, [decorated, filter]);

  const counts = useMemo(() => ({
    all: decorated.length,
    ready: decorated.filter((c) => !c.archived && c.validation.ok).length,
    errors: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'error')).length,
    warnings: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'warning')).length,
    archived: decorated.filter((c) => c.archived).length,
    dormant: decorated.filter((c) => c.merged.status === 'Dormant').length,
  }), [decorated]);

  async function runAutoFix() {
    setFixing(true);
    setFixResult(null);
    try {
      const res = await fetch('/api/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json() as { fixed?: number; error?: string };
      if (data.error) throw new Error(data.error);
      setFixResult({ fixed: data.fixed ?? 0 });
      if ((data.fixed ?? 0) > 0) await load();
    } catch (err) {
      setFixResult({ fixed: -1 });
      console.error('[auto-fix]', err);
    } finally {
      setFixing(false);
    }
  }

  async function updateField(clusterId: string, fieldKey: string, value: unknown) {
    const target = clusters.find((c) => c.id === clusterId);
    if (!target) return;
    const oldValue = (target.merged as Record<string, unknown>)[fieldKey] ?? null;
    const newMerged = { ...target.merged, [fieldKey]: value };
    await supabase.from('clusters').update({ merged: newMerged }).eq('id', clusterId);
    await supabase.from('edits').insert({
      cluster_id: clusterId,
      field_key: fieldKey,
      old_value: oldValue,
      new_value: value,
      operator: operatorName ?? null,
    });
    setClusters((prev) => prev.map((c) => (c.id === clusterId ? { ...c, merged: newMerged } : c)));
    // Update local post-export edits so the marker appears immediately
    if (lastExportedAt) {
      const newEdit: EditRecord = {
        cluster_id: clusterId,
        field_key: fieldKey,
        old_value: oldValue,
        new_value: value,
        operator: operatorName ?? null,
        created_at: new Date().toISOString(),
      };
      setPostExportEdits((prev) => [...prev, newEdit]);
    }
    // Brief "saved" indicator
    setSavedField(fieldKey);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedField(null), 1500);
  }

  if (loading) return <p className="text-navy-500">Loading review data…</p>;

  if (clusters.length === 0) {
    return (
      <div className="card p-10 text-center space-y-3">
        <div className="text-4xl">📂</div>
        <h3 className="font-semibold text-navy-800 text-lg">No client data yet</h3>
        <p className="text-sm text-navy-500 max-w-sm mx-auto">
          Go to <strong>Import</strong>, upload your source files, then run the mapping pipeline.
          Processed clients will appear here for review.
        </p>
        {onGoToImport && (
          <button onClick={onGoToImport} className="btn btn-primary text-sm mt-2">
            ← Go to Import
          </button>
        )}
      </div>
    );
  }

  // Preview columns: Name, Entity Type, Reg Nr, Tax Nr, Status
  const preview = DATAGROWS_FIELDS.filter((f) =>
    ['client_name', 'entity_type', 'registration_nr', 'tax_nr', 'status'].includes(f.key),
  );

  return (
    <div className="space-y-4">

      {/* ── Firm data quick-links ────────────────────────────────────────────── */}
      {onOpenFirmSlideOver && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-navy-500 font-medium">Firm data:</span>
          {([
            ['company',   'Company Info'],
            ['employees', 'Employees'],
            ['suppliers', 'Suppliers'],
          ] as [FirmTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => onOpenFirmSlideOver(tab)}
              className="btn btn-ghost text-xs border border-navy-200 hover:border-teal-400 hover:text-teal-700"
            >
              {label} ↗
            </button>
          ))}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="-mx-4 sm:mx-0">
        <div className="flex overflow-x-auto gap-2 px-4 sm:px-0 pb-1 scrollbar-none items-center">
          {([
            ['all',      `All (${counts.all})`],
            ['ready',    `Ready (${counts.ready})`],
            ['errors',   `Errors (${counts.errors})`],
            ['warnings', `Warnings (${counts.warnings})`],
            ['dormant',  `Dormant (${counts.dormant})`],
            ['archived', `Archived (${counts.archived})`],
          ] as [Filter, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`btn flex-shrink-0 ${filter === k ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            {fixResult && fixResult.fixed >= 0 && (
              <span className="text-sm text-green-700 bg-green-50 px-2 py-1 rounded">
                {fixResult.fixed > 0 ? `AI fixed ${fixResult.fixed} record(s)` : 'No automatic fixes found'}
              </span>
            )}
            {fixResult && fixResult.fixed === -1 && (
              <span className="text-sm text-red-600">Fix failed — try again</span>
            )}
            {counts.errors > 0 && (
              <button
                onClick={runAutoFix}
                disabled={fixing}
                className="btn btn-secondary text-sm flex-shrink-0"
              >
                {fixing ? 'Running AI fix…' : `Auto-fix ${counts.errors} error(s)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Client table ─────────────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="px-3 py-2 text-xs text-navy-400 border-b border-navy-100 bg-navy-50 flex items-center justify-between">
          <span>Click any row to open and edit — including clean records</span>
          {lastExportedAt && postExportEdits.length > 0 && (
            <span className="text-amber-600">
              ◷ {postExportEdits.length} change{postExportEdits.length !== 1 ? 's' : ''} since last export
            </span>
          )}
        </div>
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-navy-50 text-left text-navy-700">
            <tr>
              {preview.map((f) => (
                <th key={f.key} className="px-3 py-3 font-medium whitespace-nowrap">{f.header}</th>
              ))}
              <th className="px-3 py-3 font-medium hidden sm:table-cell whitespace-nowrap">Sources</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {filtered.map((c) => {
              const errors = c.validation.issues.filter((i) => i.severity === 'error').length;
              const warns = c.validation.issues.filter((i) => i.severity === 'warning').length;
              const isOpen = editing === c.id;
              const clusterEdits = editsByCluster[c.id] ?? [];
              const isModified = clusterEdits.length > 0;
              return (
                <tr
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className={`cursor-pointer select-none transition-colors ${c.archived ? 'opacity-60' : ''} ${isOpen ? 'bg-teal-50 hover:bg-teal-50' : 'hover:bg-navy-50'}`}
                  onClick={() => setEditing(isOpen ? null : c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(isOpen ? null : c.id); } }}
                >
                  {preview.map((f) => (
                    <td key={f.key} className="px-3 py-2.5 max-w-[160px] truncate text-navy-800">
                      {String((c.merged as Record<string, unknown>)[f.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-xs text-navy-500 hidden sm:table-cell">{c.sources.join(', ')}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      {errors > 0 && <span className="badge badge-error">{errors} err</span>}
                      {warns > 0 && <span className="badge badge-warn">{warns} warn</span>}
                      {errors === 0 && warns === 0 && !c.archived && <span className="badge badge-ok">OK</span>}
                      {c.archived && <span className="badge badge-muted">Archived</span>}
                      {isModified && <ModifiedMarker edits={clusterEdits} />}
                      <span className="text-navy-300 text-xs ml-0.5" title="Click row to edit">✎</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-navy-400 text-center">
            No records match this filter.
          </p>
        )}
      </div>

      {/* ── Proceed to Export ────────────────────────────────────────────── */}
      {onProceedToExport && clusters.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-navy-500">
            <span className="font-medium text-navy-800">{counts.ready}</span> record{counts.ready !== 1 ? 's' : ''} ready
            {counts.errors > 0 && <span className="text-rose-500 ml-2">· {counts.errors} with errors</span>}
          </p>
          <button onClick={onProceedToExport} className="btn btn-primary text-sm">
            Continue to Export →
          </button>
        </div>
      )}

      {/* ── Full-screen edit modal ────────────────────────────────────────── */}
      {editing && (() => {
        const target = clusters.find((cl) => cl.id === editing);
        if (!target) return null;
        const v = validateRecord(target.merged);
        return (
          <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setEditing(null)}
            />

            {/* Panel */}
            <div
              ref={editPanelRef}
              className="relative z-10 flex flex-col bg-white w-full h-full sm:m-4 sm:rounded-2xl sm:h-[calc(100vh-2rem)] sm:max-w-3xl sm:mx-auto overflow-hidden shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-navy-100 bg-white shrink-0">
                <div>
                  <h3 className="text-lg font-semibold text-navy-800">
                    {String(target.merged.client_name ?? 'Unnamed')}
                  </h3>
                  <p className="text-xs text-navy-400 mt-0.5">Changes save automatically as you type</p>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  {savedField && (
                    <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded animate-pulse">
                      Saved
                    </span>
                  )}
                  <button
                    onClick={() => setEditing(null)}
                    className="btn btn-ghost"
                    aria-label="Close"
                  >
                    Close ✕
                  </button>
                </div>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {target.archived && target.archive_reason && (
                  <div className="p-3 bg-amber-50 text-amber-900 text-sm rounded">
                    <strong>Archived:</strong> {target.archive_reason}
                  </div>
                )}

                {/* Quick-edit: Entity & Roles */}
                <div className="p-4 bg-navy-50 rounded-lg border border-navy-100">
                  <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">
                    Quick Edit — Entity &amp; Roles
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {['entity_type', 'status', 'partner', 'manager', 'accountant', 'accounting_role', 'cipc_role', 'tax_role'].map((key) => {
                      const f = DATAGROWS_FIELDS.find((x) => x.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key}>
                          <label className="block text-xs font-medium text-navy-600 mb-1">{f.header}</label>
                          <FieldInput
                            field={f}
                            value={(target.merged as Record<string, unknown>)[f.key]}
                            onChange={(val) => updateField(target.id, f.key, val)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Validation issues */}
                {v.issues.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-navy-700 mb-2">Issues</h4>
                    <ul className="text-sm space-y-1.5">
                      {v.issues.map((i, idx) => (
                        <li key={idx} className="flex gap-2 items-start">
                          <span className={`badge mt-0.5 shrink-0 ${i.severity === 'error' ? 'badge-error' : 'badge-warn'}`}>
                            {i.severity}
                          </span>
                          <span>{humanizeIssue(i)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {target.merged._invalid_enums && Object.keys(target.merged._invalid_enums as object).length > 0 && (
                  <div className="p-3 bg-purple-50 text-purple-900 text-sm rounded">
                    <strong>AI-flagged values (may need correction):</strong>
                    <ul className="mt-1 space-y-0.5">
                      {Object.entries(target.merged._invalid_enums as Record<string, string>).map(([field, val]) => (
                        <li key={field}>
                          <span className="font-mono">{field}</span>: &quot;{val}&quot; is not in the DataGrows allowed list
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* All fields grouped */}
                <div className="space-y-6">
                  {FIELD_GROUPS.map((group) => {
                    const fields = group.cols
                      .map((col) => FIELD_BY_COL[col])
                      .filter(Boolean) as FieldDef[];
                    return (
                      <div key={group.label}>
                        <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3 pb-1 border-b border-gray-100">
                          {group.label}
                        </h4>
                        <div className="grid grid-cols-2 gap-3">
                          {fields.map((f) => {
                            const isRequired = REQUIRED_FIELDS.some((r) => r.key === f.key);
                            const isLong = f.type === 'longtext';
                            return (
                              <div key={f.key} className={isLong ? 'col-span-2' : ''}>
                                <label className="block text-xs font-medium text-navy-600 mb-1">
                                  {f.header}{isRequired ? ' *' : ''}
                                </label>
                                <FieldInput
                                  field={f}
                                  value={(target.merged as Record<string, unknown>)[f.key]}
                                  onChange={(val) => updateField(target.id, f.key, val)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
