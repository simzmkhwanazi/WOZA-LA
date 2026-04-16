'use client';

import { useState, useEffect, useCallback } from 'react';
import { getEdits, type EditRow } from '@/lib/actions/db';
import { FIELD_BY_KEY } from '@/lib/schema/datagrows';

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function AuditStep({ sessionId }: { sessionId: string }) {
  const [edits, setEdits] = useState<EditRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setEdits(await getEdits(sessionId));
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-navy-500">Loading audit log…</p>;

  if (edits.length === 0) {
    return (
      <div className="card p-8 text-center text-navy-500">
        <p>No edits recorded yet. Changes made in the Review tab appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-navy-500">{edits.length} edit{edits.length !== 1 ? 's' : ''} recorded</p>
        <button onClick={load} className="btn btn-secondary text-xs">Refresh</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-navy-50 text-left text-navy-700">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Field</th>
              <th className="px-4 py-3 font-medium">Old</th>
              <th className="px-4 py-3 font-medium">New</th>
              <th className="px-4 py-3 font-medium">Operator</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {edits.map((e) => {
              const fieldLabel = FIELD_BY_KEY[e.field_key]?.header ?? e.field_key;
              const when = new Date(e.created_at).toLocaleString('en-ZA', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              });
              return (
                <tr key={e.id} className="hover:bg-navy-50">
                  <td className="px-4 py-2 text-xs text-navy-500 whitespace-nowrap">{when}</td>
                  <td className="px-4 py-2 font-medium text-navy-800">{e.client_name}</td>
                  <td className="px-4 py-2 text-navy-700">{fieldLabel}</td>
                  <td className="px-4 py-2 text-rose-600 max-w-[160px] truncate" title={displayValue(e.old_value)}>
                    {displayValue(e.old_value)}
                  </td>
                  <td className="px-4 py-2 text-teal-700 max-w-[160px] truncate" title={displayValue(e.new_value)}>
                    {displayValue(e.new_value)}
                  </td>
                  <td className="px-4 py-2 text-navy-500">{e.operator ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
