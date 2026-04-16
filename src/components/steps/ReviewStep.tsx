'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { DATAGROWS_FIELDS, FIELD_BY_COL, REQUIRED_FIELDS, type FieldDef, type ClientRecord } from '@/lib/schema/datagrows';
import { validateRecord } from '@/lib/validator';
import { getClusters, updateClusterMerged, insertEdit, type ClusterRow } from '@/lib/actions/db';

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

type Filter = 'all' | 'errors' | 'warnings' | 'archived' | 'dormant';

export function ReviewStep({
  sessionId,
  operatorName,
}: {
  sessionId: string;
  operatorName?: string | null;
}) {
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setClusters(await getClusters(sessionId));
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const decorated = useMemo(() => {
    return clusters.map((c) => {
      const validation = validateRecord(c.merged);
      return { ...c, validation };
    });
  }, [clusters]);

  const filtered = useMemo(() => {
    switch (filter) {
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
    errors: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'error')).length,
    warnings: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'warning')).length,
    archived: decorated.filter((c) => c.archived).length,
    dormant: decorated.filter((c) => c.merged.status === 'Dormant').length,
  }), [decorated]);

  async function updateField(clusterId: string, fieldKey: string, value: unknown) {
    const target = clusters.find((c) => c.id === clusterId);
    if (!target) return;
    const oldValue = (target.merged as Record<string, unknown>)[fieldKey] ?? null;
    const newMerged = { ...target.merged, [fieldKey]: value } as ClientRecord;
    await updateClusterMerged(clusterId, newMerged);
    await insertEdit({ clusterId, fieldKey, oldValue, newValue: value, operator: operatorName ?? null });
    setClusters((prev) => prev.map((c) => (c.id === clusterId ? { ...c, merged: newMerged } : c)));
  }

  if (loading) return <p className="text-navy-500">Loading review data…</p>;

  if (clusters.length === 0) {
    return (
      <div className="card p-8 text-center text-navy-500">
        <p>No clusters yet. Run the mapping pipeline first.</p>
      </div>
    );
  }

  const preview = DATAGROWS_FIELDS.filter((f) =>
    ['client_name', 'entity_type', 'registration_nr', 'tax_nr', 'status'].includes(f.key),
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {([
          ['all', `All (${counts.all})`],
          ['errors', `Errors (${counts.errors})`],
          ['warnings', `Warnings (${counts.warnings})`],
          ['dormant', `Dormant (${counts.dormant})`],
          ['archived', `Archived (${counts.archived})`],
        ] as [Filter, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`btn ${filter === k ? 'btn-primary' : 'btn-secondary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-left text-navy-700">
            <tr>
              {preview.map((f) => (
                <th key={f.key} className="px-4 py-3 font-medium">{f.header}</th>
              ))}
              <th className="px-4 py-3 font-medium">Sources</th>
              <th className="px-4 py-3 font-medium">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {filtered.map((c) => {
              const errors = c.validation.issues.filter((i) => i.severity === 'error').length;
              const warns = c.validation.issues.filter((i) => i.severity === 'warning').length;
              return (
                <tr
                  key={c.id}
                  className={`hover:bg-navy-50 cursor-pointer ${c.archived ? 'opacity-60' : ''}`}
                  onClick={() => setEditing(editing === c.id ? null : c.id)}
                >
                  {preview.map((f) => (
                    <td key={f.key} className="px-4 py-2">
                      {String((c.merged as Record<string, unknown>)[f.key] ?? '—')}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-xs text-navy-500">{c.sources.join(', ')}</td>
                  <td className="px-4 py-2">
                    {errors > 0 && <span className="badge badge-error mr-1">{errors} err</span>}
                    {warns > 0 && <span className="badge badge-warn">{warns} warn</span>}
                    {errors === 0 && warns === 0 && !c.archived && <span className="badge badge-ok">OK</span>}
                    {c.archived && <span className="badge badge-muted">Archived</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (() => {
        const target = clusters.find((c) => c.id === editing);
        if (!target) return null;
        const v = validateRecord(target.merged);
        return (
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-navy-800">
                {String(target.merged.client_name ?? 'Unnamed')}
              </h3>
              <button onClick={() => setEditing(null)} className="btn btn-ghost">Close</button>
            </div>
            {target.archived && target.archive_reason && (
              <div className="mb-4 p-3 bg-amber-50 text-amber-900 text-sm rounded">
                <strong>Archived:</strong> {target.archive_reason}
              </div>
            )}
            {v.issues.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-navy-700 mb-2">Issues</h4>
                <ul className="text-sm space-y-1">
                  {v.issues.map((i, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className={`badge ${i.severity === 'error' ? 'badge-error' : 'badge-warn'}`}>
                        {i.severity}
                      </span>
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="max-h-[600px] overflow-y-auto space-y-6 pr-1">
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
                              onChange={(v) => updateField(target.id, f.key, v)}
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
        );
      })()}
    </div>
  );
}
