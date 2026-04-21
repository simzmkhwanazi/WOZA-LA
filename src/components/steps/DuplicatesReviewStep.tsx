'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { distance as levenshtein } from 'fastest-levenshtein';
import type { ClientRecord } from '@/lib/schema/datagrows';

// ── Local helpers ─────────────────────────────────────────────────────────────

function stripSuffix(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(pty\)\s*ltd\.?/gi, '')
    .replace(/\bpty\s*ltd\.?/gi, '')
    .replace(/\bltd\.?\b/gi, '')
    .replace(/\bcc\b/gi, '')
    .replace(/\bnpc\b/gi, '')
    .replace(/\bnpo\b/gi, '')
    .replace(/\btrust\b/gi, '')
    .replace(/\bestate\b/gi, '')
    .replace(/\bsole\s*prop\.?\b/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function strSim(a: string, b: string): number {
  const na = a.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nb = b.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!na || !nb) return 0;
  // Require minimum length to avoid short-string false positives
  if (na.length < 4 || nb.length < 4) return 0;
  if (na === nb) return 1;
  const d = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const levSim = 1 - d / maxLen;
  const tokA = na.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const tokB = nb.split(/[^A-Z0-9]+/).filter(Boolean).sort().join('');
  const td2 = levenshtein(tokA, tokB);
  const tokMax = Math.max(tokA.length, tokB.length);
  const tokSim = tokMax > 0 ? 1 - td2 / tokMax : 0;
  return Math.max(levSim, tokSim);
}

/** Compare ONLY client_name to client_name (raw + suffix-stripped). */
function clientNameSimilarity(a: ClientRecord, b: ClientRecord): number {
  const aN = String(a.client_name ?? '').trim();
  const bN = String(b.client_name ?? '').trim();
  if (!aN || !bN) return 0;
  const raw = strSim(aN, bN);
  const stripped = strSim(stripSuffix(aN), stripSuffix(bN));
  return Math.max(raw, stripped);
}

/** Broad entity category — used to skip cross-type comparisons. */
function entityCat(et: unknown): string {
  const t = String(et ?? '').toLowerCase().trim();
  if (!t) return '';
  if (/\btrust\b/.test(t)) return 'trust';
  if (/individual|natural\s*person|sole\s*prop/.test(t)) return 'individual';
  if (/pty|ltd|cc\b|npc|npo/.test(t)) return 'company';
  return 'other';
}

interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
}

interface DupPair {
  key: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  score: number;
}

type Decision = 'merge' | 'keep_separate' | null;

export function DuplicatesReviewStep({ sessionId }: { sessionId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [pairs, setPairs] = useState<DupPair[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [threshold, setThreshold] = useState(0.90);

  const load = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    const { data } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived')
      .eq('session_id', sessionId)
      .eq('archived', false);

    const rows = (data ?? []) as ClusterRow[];
    const found: DupPair[] = [];

    // Count how many records share each client_name — names appearing 3+ times
    // are placeholders/statuses, not real client identifiers, so skip them.
    const nameFreq = new Map<string, number>();
    for (const r of rows) {
      const n = String(r.merged.client_name ?? '').trim().toLowerCase();
      if (n) nameFreq.set(n, (nameFreq.get(n) ?? 0) + 1);
    }

    for (let i = 0; i < rows.length; i++) {
      const nI = String(rows[i].merged.client_name ?? '').trim().toLowerCase();
      if ((nameFreq.get(nI) ?? 0) > 2) continue; // skip placeholder names

      for (let j = i + 1; j < rows.length; j++) {
        const nJ = String(rows[j].merged.client_name ?? '').trim().toLowerCase();
        if ((nameFreq.get(nJ) ?? 0) > 2) continue;

        // Skip cross-entity-category pairs (Trust vs Individual, etc.)
        const catI = entityCat(rows[i].merged.entity_type);
        const catJ = entityCat(rows[j].merged.entity_type);
        if (catI && catJ && catI !== catJ && catI !== 'other' && catJ !== 'other') continue;

        const score = clientNameSimilarity(rows[i].merged, rows[j].merged);
        if (score >= threshold) {
          const key = `${rows[i].id}::${rows[j].id}`;
          found.push({
            key,
            aId: rows[i].id,
            bId: rows[j].id,
            aName: String(rows[i].merged.client_name ?? '—'),
            bName: String(rows[j].merged.client_name ?? '—'),
            score,
          });
        }
      }
    }
    found.sort((a, b) => b.score - a.score);

    setPairs(found);
    setDecisions(Object.fromEntries(found.map((p) => [p.key, null])));
    setLoading(false);
  }, [sessionId, supabase, threshold]);

  useEffect(() => { void load(); }, [load]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === pairs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pairs.map((p) => p.key)));
    }
  }

  function applyToSelected(decision: Decision) {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const key of selected) next[key] = decision;
      return next;
    });
    setSelected(new Set());
  }

  function setDecision(key: string, decision: Decision) {
    setDecisions((prev) => ({ ...prev, [key]: decision }));
  }

  // ── Confirm all decided pairs ─────────────────────────────────────────────
  async function confirm() {
    setApplying(true);
    setError('');
    try {
      const { data: clusterData } = await supabase
        .from('clusters')
        .select('id, merged, sources')
        .eq('session_id', sessionId);

      const clusterMap = new Map(
        (clusterData ?? []).map((r) => [r.id, r as { id: string; merged: ClientRecord; sources: string[] | null }]),
      );

      for (const [key, decision] of Object.entries(decisions)) {
        if (!decision) continue;
        const [aId, bId] = key.split('::');
        if (!aId || !bId) continue;

        if (decision === 'merge') {
          const a = clusterMap.get(aId);
          const b = clusterMap.get(bId);
          if (!a || !b) continue;

          // Merge: b fields win, a fills any gaps
          const merged: Record<string, unknown> = { ...(a.merged as Record<string, unknown>) };
          for (const [k, v] of Object.entries(b.merged as Record<string, unknown>)) {
            if (v !== null && v !== undefined && v !== '') merged[k] = v;
          }
          const sources = Array.from(new Set([...(b.sources ?? []), ...(a.sources ?? [])]));
          await supabase.from('clusters').update({ merged, sources }).eq('id', bId);
          await supabase.from('clusters').delete().eq('id', aId);
        }
        // keep_separate: no DB change — just dismiss
      }

      // Reload fresh pairs
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply decisions');
    } finally {
      setApplying(false);
    }
  }

  const decidedCount = Object.values(decisions).filter((v) => v !== null).length;
  const allDecided = pairs.length > 0 && decidedCount === pairs.length;

  if (loading) {
    return <div className="card p-6 text-sm text-navy-400">Scanning for duplicates…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-navy-500 whitespace-nowrap">Min similarity</label>
          <select
            className="input h-8 text-xs w-28"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          >
            <option value={0.95}>95% — Exact only</option>
            <option value={0.90}>90% — High (recommended)</option>
            <option value={0.85}>85% — Medium</option>
            <option value={0.80}>80% — Loose</option>
          </select>
        </div>
        <button className="btn btn-ghost text-xs h-8" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {pairs.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm font-medium text-navy-700">No duplicates found</p>
          <p className="text-xs text-navy-400 mt-1">
            No client pairs exceeded {Math.round(threshold * 100)}% name similarity.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {pairs.length} possible duplicate pair{pairs.length !== 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                {decidedCount} decided · {pairs.length - decidedCount} remaining
              </p>
            </div>
            <div className="flex gap-2 text-xs text-amber-800 flex-wrap">
              <button
                className="underline hover:text-amber-900"
                onClick={() => setDecisions(Object.fromEntries(pairs.map((p) => [p.key, 'keep_separate'])))}
              >
                Keep all separate
              </button>
              <span className="text-amber-300">|</span>
              <button
                className="underline hover:text-amber-900"
                onClick={() => setDecisions(Object.fromEntries(pairs.map((p) => [p.key, 'merge'])))}
              >
                Merge all
              </button>
            </div>
          </div>

          {/* Bulk-select action bar — shown when rows are checked */}
          {selected.size > 0 && (
            <div className="px-5 py-2.5 bg-teal-600 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-white font-medium">
                {selected.size} selected
              </span>
              <button
                className="text-xs px-3 py-1 bg-white text-teal-700 rounded font-semibold hover:bg-teal-50"
                onClick={() => applyToSelected('keep_separate')}
              >
                Keep separate
              </button>
              <button
                className="text-xs px-3 py-1 bg-teal-800 text-white rounded font-semibold hover:bg-teal-900"
                onClick={() => applyToSelected('merge')}
              >
                Merge
              </button>
              <button
                className="text-xs text-teal-200 underline hover:text-white ml-auto"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </div>
          )}

          {/* Table header */}
          <div className="px-5 py-2 bg-navy-50 border-b border-navy-100 grid grid-cols-[1.5rem_1fr_1.25rem_1fr_8rem] gap-3 items-center">
            <input
              type="checkbox"
              className="rounded"
              checked={selected.size === pairs.length && pairs.length > 0}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < pairs.length; }}
              onChange={toggleSelectAll}
            />
            <span className="text-xs font-medium text-navy-600">Client A</span>
            <span />
            <span className="text-xs font-medium text-navy-600">Client B</span>
            <span className="text-xs font-medium text-navy-600 text-right">Action</span>
          </div>

          {/* Pair rows */}
          <div className="divide-y divide-navy-50 max-h-[540px] overflow-y-auto">
            {pairs.map((p) => {
              const decision = decisions[p.key];
              const isSelected = selected.has(p.key);
              return (
                <div
                  key={p.key}
                  className={`px-5 py-3 grid grid-cols-[1.5rem_1fr_1.25rem_1fr_8rem] gap-3 items-center transition-colors ${
                    isSelected       ? 'bg-teal-50' :
                    decision === 'keep_separate' ? 'bg-navy-50/60' :
                    decision === 'merge'          ? 'bg-teal-50/40' :
                    'bg-white hover:bg-navy-50/40'
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={isSelected}
                    onChange={() => toggleSelect(p.key)}
                  />

                  {/* Name A */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-800 truncate">{p.aName}</p>
                  </div>

                  {/* Score + arrow */}
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-bold text-amber-600 leading-none">{Math.round(p.score * 100)}%</span>
                    <span className="text-amber-300 text-xs">↔</span>
                  </div>

                  {/* Name B */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-800 truncate">{p.bName}</p>
                  </div>

                  {/* Decision */}
                  <div className="flex justify-end">
                    {decision === null ? (
                      <div className="flex gap-1">
                        <button
                          className="text-xs px-2 py-1 rounded border border-teal-300 text-teal-700 hover:bg-teal-50 font-medium"
                          onClick={() => setDecision(p.key, 'merge')}
                        >
                          Merge
                        </button>
                        <button
                          className="text-xs px-2 py-1 rounded border border-navy-200 text-navy-600 hover:bg-navy-50 font-medium whitespace-nowrap"
                          onClick={() => setDecision(p.key, 'keep_separate')}
                        >
                          Split
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-medium ${decision === 'merge' ? 'text-teal-700' : 'text-navy-500'}`}>
                          {decision === 'merge' ? '⊕ Merge' : '— Split'}
                        </span>
                        <button
                          className="text-[10px] text-navy-300 underline hover:text-navy-500"
                          onClick={() => setDecision(p.key, null)}
                        >
                          Undo
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-navy-50 border-t border-navy-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-navy-500">
              {decidedCount} of {pairs.length} decided
              {selected.size > 0 && (
                <span className="ml-2 text-teal-600 font-medium">· {selected.size} selected</span>
              )}
            </p>
            <div className="flex items-center gap-3">
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                disabled={decidedCount === 0 || applying}
                className="btn btn-primary text-sm disabled:opacity-40"
                onClick={() => void confirm()}
              >
                {applying ? 'Applying…' : `Confirm ${decidedCount} decision${decidedCount !== 1 ? 's' : ''} →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
