'use client';

/**
 * MappingStep — fully automated.
 *
 * 1. On mount: calls /api/map-columns for each upload that lacks a saved mapping.
 * 2. Shows per-file confidence summary (heuristic vs AI vs none).
 * 3. After all files are mapped, auto-runs the full pipeline.
 * 4. Calls onComplete() to navigate to the Review tab.
 *
 * Manual overrides are hidden by default but can be expanded per file.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS } from '@/lib/schema/datagrows';
import { normalizeRecord } from '@/lib/normalizer';
import { correctFieldLeakage } from '@/lib/normalizer/field-leakage';
import { applyRules } from '@/lib/rules/engine';
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

type Phase =
  | 'idle'
  | 'mapping'
  | 'pipeline'
  | 'done'
  | 'already_done'
  | 'error';

interface FileMappingState {
  uploadId: string;
  fileName: string;
  mapping: Record<string, string>;
  confidence: Record<string, 'heuristic' | 'ai' | 'none'>;
  expanded: boolean;
}

export function MappingStep({
  sessionId,
  onComplete,
  onDedupRequired,
}: {
  sessionId: string;
  onComplete?: () => void;
  onDedupRequired?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Initialising…');
  const [fileMappings, setFileMappings] = useState<FileMappingState[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [pipelineLog, setPipelineLog] = useState<string[]>([]);
  const [hasPendingDedup, setHasPendingDedup] = useState(false);
  const hasRun = useRef(false);

  const appendLog = (s: string) => setPipelineLog((l) => [...l, s]);

  // ── Fetch uploads and auto-map ────────────────────────────────────────────

  const run = useCallback(async () => {
    if (hasRun.current) return;
    hasRun.current = true;

    setPhase('mapping');
    setProgress(5);
    setStatusText('Loading uploaded files…');

    try {
      // Check if pipeline was already run for this session
      const { data: existingClusters } = await supabase
        .from('clusters')
        .select('id')
        .eq('session_id', sessionId)
        .limit(1);

      if (existingClusters && existingClusters.length > 0) {
        setPhase('already_done');
        setProgress(100);
        setStatusText('Pipeline already complete.');
        return;
      }

      const { data } = await supabase
        .from('uploads')
        .select('id, file_name, source_type, detected_columns, column_mapping')
        .eq('session_id', sessionId);

      const uploads = (data as UploadRow[]) ?? [];

      if (uploads.length === 0) {
        setErrorMsg('No uploaded files found. Please upload files first.');
        setPhase('error');
        return;
      }

      // Phase 1 — Map columns
      const states: FileMappingState[] = [];
      const perStep = 40 / uploads.length;

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        setStatusText(`Mapping columns: ${u.file_name}…`);
        setProgress(5 + Math.round(i * perStep));

        let mapping: Record<string, string> = {};
        let confidence: Record<string, 'heuristic' | 'ai' | 'none'> = {};

        if (u.column_mapping && Object.keys(u.column_mapping).length > 0) {
          // Already saved — use it
          mapping = u.column_mapping;
          const cols = u.detected_columns ?? Object.keys(mapping);
          for (const h of cols) {
            confidence[h] = mapping[h] ? 'heuristic' : 'none';
          }
        } else if (u.detected_columns && u.detected_columns.length > 0) {
          // Call AI mapping endpoint
          try {
            const res = await fetch('/api/map-columns', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                uploadId: u.id,
                headers: u.detected_columns,
              }),
            });
            if (res.ok) {
              const result = await res.json() as {
                mapping: Record<string, string | null>;
                confidence: Record<string, 'heuristic' | 'ai' | 'none'>;
              };
              mapping = Object.fromEntries(
                Object.entries(result.mapping).map(([k, v]) => [k, v ?? '']),
              );
              confidence = result.confidence;

              // Persist to Supabase
              await supabase
                .from('uploads')
                .update({ column_mapping: mapping })
                .eq('id', u.id);
            }
          } catch {
            // Silently fall through — pipeline will still run
          }
        }

        states.push({
          uploadId: u.id,
          fileName: u.file_name,
          mapping,
          confidence,
          expanded: false,
        });
      }

      setFileMappings(states);
      setProgress(45);

      // Phase 2 — Run pipeline
      setPhase('pipeline');
      setStatusText('Building client records…');

      const allMapped: MappedRecord[] = [];

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const state = states[i];
        setProgress(45 + Math.round((i / uploads.length) * 25));

        const { data: raws } = await supabase
          .from('raw_records')
          .select('id, data')
          .eq('upload_id', u.id);
        if (!raws) continue;

        appendLog(`${u.file_name}: ${raws.length} rows`);

        for (const raw of raws) {
          const canonical: Record<string, unknown> = {};
          for (const [header, fieldKey] of Object.entries(state.mapping)) {
            if (!fieldKey) continue;
            canonical[fieldKey] = (raw.data as Record<string, unknown>)[header];
          }
          const leaked = correctFieldLeakage(canonical);
          const normalized = normalizeRecord(leaked);
          const ruled = applyRules(normalized);
          allMapped.push({
            id: raw.id,
            source: u.source_type,
            data: ruled,
          });
        }
      }

      appendLog(`Total records: ${allMapped.length}`);
      setProgress(70);
      setStatusText('Matching and deduplicating…');

      const { clusters, pendingNameMatches, stats } = matchRecords(allMapped);
      appendLog(`${stats.clusters} clusters · ${stats.pendingNameMatches} pending dedup · ${stats.archived} archived`);
      setProgress(80);

      setStatusText('Merging with source-of-truth hierarchy…');
      const merged = mergeAllClusters(clusters);
      appendLog(`${merged.length} final client records`);
      setProgress(88);

      // ── One-man-band auto-fill ───────────────────────────────────────────────
      // If the firm uploaded an employee list with exactly 1 person, auto-assign
      // that person to all staff role fields that are still blank.
      const staffFields = ['partner', 'manager', 'accountant', 'accounting_role', 'cipc_role', 'tax_role'];
      const employeeRecords = allMapped.filter((r) => r.source === 'employees');
      const uniqueNames = [
        ...new Set(
          employeeRecords
            .map((r) => String((r.data as Record<string, unknown>).client_name ?? (r.data as Record<string, unknown>).primary_contact ?? '').trim())
            .filter(Boolean),
        ),
      ];
      if (uniqueNames.length === 1) {
        const soloName = uniqueNames[0];
        appendLog(`One-man band detected — auto-assigning "${soloName}" to all staff roles`);
        for (const rec of merged) {
          const m = rec as Record<string, unknown>;
          for (const f of staffFields) {
            if (!m[f]) m[f] = soloName;
          }
        }
      }

      setStatusText('Saving to database…');
      await supabase.from('clusters').delete().eq('session_id', sessionId);

      const toInsert = merged.map((rec) => ({
        session_id: sessionId,
        primary_key_type: clusters.find((c) => c.id === rec._cluster_id)?.primaryKeyType ?? 'none',
        primary_key_value: clusters.find((c) => c.id === rec._cluster_id)?.primaryKeyValue ?? '',
        merged: rec,
        flags: rec._flags ?? {},
        conflicts: rec._conflicts ?? {},
        sources: rec._sources ?? [],
        archived: !!rec._archived,
        archive_reason: rec._archive_reason ?? null,
      }));

      for (let i = 0; i < toInsert.length; i += 200) {
        const { error: insErr } = await supabase
          .from('clusters')
          .insert(toInsert.slice(i, i + 200));
        if (insErr) throw insErr;
      }

      // Save pending name matches + reset dedup_confirmed flag
      await supabase
        .from('sessions')
        .update({
          status: pendingNameMatches.length > 0 ? 'mapping' : 'reviewing',
          pending_name_matches: pendingNameMatches,
          dedup_confirmed: pendingNameMatches.length === 0,
        })
        .eq('id', sessionId);

      setProgress(100);
      const hasPending = pendingNameMatches.length > 0;
      setHasPendingDedup(hasPending);
      setStatusText(
        hasPending
          ? `Done — ${pendingNameMatches.length} possible duplicate${pendingNameMatches.length === 1 ? '' : 's'} need review.`
          : 'Done — pipeline complete.',
      );
      setPhase('done');
      appendLog(hasPending ? `${pendingNameMatches.length} name-bridge pairs need operator review.` : 'Pipeline complete.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
    }
  // onComplete is intentionally excluded from deps — it's an inline arrow
  // function whose reference changes every parent render, which would cause
  // run() to be re-created and the effect to fire unnecessarily.
  // It is only called by the explicit "Go to Review →" buttons, never inside run().
  }, [sessionId, supabase]);

  useEffect(() => { run(); }, [run]);

  // ── Manual override toggle ────────────────────────────────────────────────

  function toggleExpanded(uploadId: string) {
    setFileMappings((prev) =>
      prev.map((f) => f.uploadId === uploadId ? { ...f, expanded: !f.expanded } : f),
    );
  }

  function setManualMapping(uploadId: string, header: string, fieldKey: string) {
    setFileMappings((prev) =>
      prev.map((f) =>
        f.uploadId === uploadId
          ? { ...f, mapping: { ...f.mapping, [header]: fieldKey } }
          : f,
      ),
    );
  }

  // ── Confidence counts ─────────────────────────────────────────────────────

  function counts(state: FileMappingState) {
    const vals = Object.values(state.confidence);
    return {
      heuristic: vals.filter((v) => v === 'heuristic').length,
      ai: vals.filter((v) => v === 'ai').length,
      none: vals.filter((v) => v === 'none').length,
      total: vals.length,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const progressBarColor =
    phase === 'error' ? 'bg-red-500' :
    phase === 'done'  ? 'bg-green-500' :
    'bg-brand';

  return (
    <div className="space-y-5">

      {/* Header card with progress */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">Automated mapping &amp; pipeline</h3>
            <p className="text-sm text-navy-500 mt-0.5">
              Woza La maps columns automatically using AI, then runs the full pipeline.
              No manual input needed.
            </p>
          </div>
          {(phase === 'done' || phase === 'already_done') && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
              ✓ Complete
            </span>
          )}
          {phase === 'error' && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-red-700 bg-red-50 px-3 py-1 rounded-full">
              ✗ Error
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-navy-100 rounded-full h-2 mb-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${progressBarColor}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-navy-500">{statusText}</p>

        {phase === 'error' && errorMsg && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {errorMsg}
            <button
              className="ml-3 underline text-red-700 hover:text-red-900"
              onClick={() => { hasRun.current = false; run(); }}
            >
              Retry
            </button>
          </div>
        )}

        {phase === 'already_done' && (
          <div className="mt-4 p-3 bg-teal-50 border border-teal-200 rounded text-sm text-teal-800">
            This session has already been processed. You can review the results or re-run the pipeline to reprocess all records.
            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-primary"
                onClick={() => onComplete?.()}
              >
                Go to Review →
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => { hasRun.current = false; setPhase('idle'); run(); }}
              >
                Re-run pipeline
              </button>
            </div>
          </div>
        )}

        {(phase === 'done') && (
          <div className="mt-4 flex gap-2 flex-wrap">
            {hasPendingDedup ? (
              <button
                className="btn btn-primary"
                onClick={() => onDedupRequired?.()}
              >
                Review Possible Duplicates →
              </button>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => onComplete?.()}
              >
                Go to Review →
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => { hasRun.current = false; setPhase('idle'); setHasPendingDedup(false); run(); }}
            >
              Re-run pipeline
            </button>
          </div>
        )}
      </div>

      {/* Per-file mapping summaries */}
      {fileMappings.map((state) => {
        const c = counts(state);
        return (
          <div key={state.uploadId} className="card overflow-hidden">
            <div
              className="px-6 py-3 border-b border-navy-100 flex items-center justify-between cursor-pointer hover:bg-navy-50"
              onClick={() => toggleExpanded(state.uploadId)}
            >
              <div>
                <h4 className="font-semibold text-navy-800 text-sm">{state.fileName}</h4>
                <p className="text-xs text-navy-500 mt-0.5">
                  {c.total} columns · {c.heuristic} rule-matched · {c.ai} AI-matched
                  {c.none > 0 && ` · ${c.none} skipped`}
                </p>
              </div>
              <span className="text-xs text-navy-400">{state.expanded ? '▲ hide' : '▼ review'}</span>
            </div>

            {state.expanded && (
              <div className="max-h-[360px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-navy-50 text-left text-navy-600 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 font-medium">Source column</th>
                      <th className="px-4 py-2 font-medium">Mapped to</th>
                      <th className="px-4 py-2 font-medium w-24">How</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {Object.entries(state.mapping).map(([header]) => {
                      const how = state.confidence[header] ?? 'none';
                      return (
                        <tr key={header} className={how === 'none' ? 'bg-amber-50' : ''}>
                          <td className="px-4 py-2 font-mono text-xs text-navy-600">{header}</td>
                          <td className="px-4 py-2">
                            <select
                              value={state.mapping[header] ?? ''}
                              onChange={(e) => setManualMapping(state.uploadId, header, e.target.value)}
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
                          <td className="px-4 py-2">
                            {how === 'heuristic' && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">rule</span>
                            )}
                            {how === 'ai' && (
                              <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">AI</span>
                            )}
                            {how === 'none' && (
                              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">skipped</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Pipeline log (collapsible) */}
      {pipelineLog.length > 0 && (
        <details className="card p-4">
          <summary className="text-xs font-medium text-navy-500 cursor-pointer select-none">
            Pipeline log ({pipelineLog.length} lines)
          </summary>
          <div className="mt-2 font-mono text-xs text-navy-700 space-y-0.5">
            {pipelineLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
