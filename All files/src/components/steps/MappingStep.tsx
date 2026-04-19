'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS } from '@/lib/schema/datagrows';
import { initialMapping } from '@/lib/parsers/mapping-heuristics';
import { normalizeRecord } from '@/lib/normalizer';
import { applyRules, type Rule } from '@/lib/rules/engine';
import rulesData from '@/lib/rules/rules.json';
import { matchRecords, type MappedRecord } from '@/lib/matcher';
import { mergeAllClusters } from '@/lib/merger';
import type { SourceType } from '@/lib/schema/sources';

interface UploadRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  detected_columns: string[] | null;
  column_mapping: Record<string, string> | null;
}

export function MappingStep({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>({});
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const loadUploads = useCallback(async () => {
    const { data } = await supabase
      .from('uploads')
      .select('id, file_name, source_type, detected_columns, column_mapping')
      .eq('session_id', sessionId);
    const list = (data as UploadRow[]) ?? [];
    setUploads(list);

    const initial: Record<string, Record<string, string>> = {};
    for (const u of list) {
      if (u.column_mapping) {
        initial[u.id] = u.column_mapping;
      } else if (u.detected_columns) {
        const suggested = initialMapping(u.detected_columns);
        initial[u.id] = Object.fromEntries(
          Object.entries(suggested).map(([k, v]) => [k, v ?? '']),
        );
      }
    }
    setMappings(initial);
  }, [sessionId, supabase]);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  function setMapping(uploadId: string, header: string, fieldKey: string) {
    setMappings((prev) => ({
      ...prev,
      [uploadId]: { ...(prev[uploadId] ?? {}), [header]: fieldKey },
    }));
  }

  async function runPipeline() {
    setRunning(true);
    setLog([]);
    const append = (s: string) => setLog((l) => [...l, s]);

    try {
      append('Saving column mappings…');
      for (const u of uploads) {
        await supabase
          .from('uploads')
          .update({ column_mapping: mappings[u.id] ?? {} })
          .eq('id', u.id);
      }

      append('Fetching raw records…');
      const allMapped: MappedRecord[] = [];
      for (const u of uploads) {
        const { data: raws } = await supabase
          .from('raw_records')
          .select('id, data')
          .eq('upload_id', u.id);
        if (!raws) continue;
        const mapping = mappings[u.id] ?? {};
        append(`  ${u.file_name}: ${raws.length} raw rows`);

        for (const raw of raws) {
          const canonical: Record<string, unknown> = {};
          for (const [header, fieldKey] of Object.entries(mapping)) {
            if (!fieldKey) continue;
            canonical[fieldKey] = (raw.data as Record<string, unknown>)[header];
          }
          const normalized = normalizeRecord(canonical);
          const { record: ruled } = applyRules(normalized, rulesData.rules as Rule[]);
          allMapped.push({
            id: raw.id,
            source: u.source_type,
            data: ruled,
          });
        }
      }

      append(`Total mapped records: ${allMapped.length}`);
      append('Matching (two-pass)…');
      const { clusters, stats } = matchRecords(allMapped);
      append(`  ${stats.clusters} clusters, ${stats.nameBridged} name-bridged, ${stats.archived} archived`);

      append('Merging clusters with source-of-truth hierarchy…');
      const merged = mergeAllClusters(clusters);
      append(`  ${merged.length} final client records`);

      append('Persisting clusters to Supabase…');
      // Clear existing clusters for this session (idempotent re-run)
      await supabase.from('clusters').delete().eq('session_id', sessionId);
      const toInsert = merged.map((rec) => ({
        session_id: sessionId,
        primary_key_type: clusters.find((c) => c.id === rec._cluster_id)?.primaryKeyType ?? 'none',
        primary_key_value: clusters.find((c) => c.id === rec._cluster_id)?.primaryKeyValue ?? '',
        merged: rec,
        flags: rec._flags ?? [],
        conflicts: rec._conflicts ?? {},
        sources: rec._sources ?? [],
        archived: !!rec._archived,
        archive_reason: rec._archive_reason ?? null,
      }));
      for (let i = 0; i < toInsert.length; i += 200) {
        const { error: insErr } = await supabase.from('clusters').insert(toInsert.slice(i, i + 200));
        if (insErr) throw insErr;
      }

      await supabase.from('sessions').update({ status: 'reviewing' }).eq('id', sessionId);
      append('Done. Switch to the Review tab.');
    } catch (err) {
      append(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-1">Map columns</h3>
        <p className="text-sm text-navy-500 mb-4">
          Map each source file&apos;s columns onto the 86 DataGrows canonical fields.
          Woza La has pre-suggested obvious matches. Review and fix, then run the pipeline.
        </p>
      </div>

      {uploads.map((u) => (
        <div key={u.id} className="card overflow-hidden">
          <div className="px-6 py-3 border-b border-navy-100 flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-navy-800">{u.file_name}</h4>
              <p className="text-xs text-navy-500">
                {u.source_type} · {u.detected_columns?.length ?? 0} columns detected
              </p>
            </div>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-left text-navy-600 sticky top-0">
                <tr>
                  <th className="px-4 py-2 font-medium">Source column</th>
                  <th className="px-4 py-2 font-medium">→ DataGrows field</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {(u.detected_columns ?? []).map((header) => (
                  <tr key={header}>
                    <td className="px-4 py-2 font-mono text-xs">{header}</td>
                    <td className="px-4 py-2">
                      <select
                        value={mappings[u.id]?.[header] ?? ''}
                        onChange={(e) => setMapping(u.id, header, e.target.value)}
                        className="input text-sm"
                      >
                        <option value="">— skip —</option>
                        {DATAGROWS_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.col}. {f.header}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button onClick={runPipeline} disabled={running || uploads.length === 0} className="btn btn-primary">
          {running ? 'Running pipeline…' : 'Run: Normalize → Match → Merge'}
        </button>
      </div>

      {log.length > 0 && (
        <div className="card p-4 font-mono text-xs text-navy-700 bg-navy-50 whitespace-pre-wrap">
          {log.join('\n')}
        </div>
      )}
    </div>
  );
}
