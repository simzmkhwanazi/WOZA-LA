'use client';

/**
 * MappingStep — automated mapping + pre-import client review.
 *
 * 1. On mount: calls /api/map-columns for each upload that lacks a saved mapping.
 * 2. Shows per-file confidence summary (heuristic vs AI vs none).
 * 3. Pauses at 'pre-import' phase: lists all mapped clients for inline editing.
 * 4. On "Run Import →": applies edits, runs the full pipeline, calls onComplete().
 *
 * Manual column overrides are hidden by default but can be expanded per file.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS, type FieldDef } from '@/lib/schema/datagrows';
import { suggestFieldKey } from '@/lib/parsers/mapping-heuristics';
import { normalizeRecord } from '@/lib/normalizer';
import { correctFieldLeakage } from '@/lib/normalizer/field-leakage';
import { applyRules } from '@/lib/rules/engine';
import { matchRecords, type MappedRecord } from '@/lib/matcher';
import { mergeAllClusters } from '@/lib/merger';
import type { SourceType } from '@/lib/schema/sources';

// Key fields shown in the pre-import table columns
const TABLE_COLS = ['client_name', 'entity_type', 'tax_nr', 'registration_nr', 'contact_email'];

// Fields in the quick-edit section of the slide-over panel
const QUICK_FIELDS = [
  'client_name', 'trading_name', 'entity_type', 'status', 'year_end',
  'accountant', 'primary_contact', 'contact_nr', 'contact_email',
  'tax_nr', 'registration_nr', 'vat_nr',
];

// ── Per-field input rendered according to type ────────────────────────────────
function FieldInput({
  field, value, onChange,
}: { field: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
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

interface UploadRow {
  id: string;
  file_name: string;
  source_type: SourceType;
  detected_columns: string[] | null;
  column_mapping: Record<string, string> | null;
}

type Phase = 'idle' | 'mapping' | 'pre-import' | 'pipeline' | 'done' | 'already_done' | 'error';

interface FileMappingState {
  uploadId: string;
  fileName: string;
  mapping: Record<string, string>;
  confidence: Record<string, 'heuristic' | 'ai' | 'none'>;
  expanded: boolean;
}

interface PreImportClient {
  rawId: string;
  uploadId: string;
  fileName: string;
  mapped: Record<string, unknown>;
}

interface DuplicateGroup {
  id: string;
  matchType: 'tax_nr' | 'registration_nr' | 'name';
  rawIds: string[];
  merged: Record<string, unknown>;
  conflicts: Record<string, unknown[]>;
  status: 'confirmed' | 'rejected';
}

// ── Duplicate detection helpers ───────────────────────────────────────────────

function normTax(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s === '—') return '';
  return s.replace(/\s/g, '').toUpperCase();
}

function normReg(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s === '—') return '';
  return s.replace(/[-\s/]/g, '').toUpperCase();
}

function normName(v: unknown): string {
  return String(v ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(pty|ltd|cc|inc|npc|rf|soc|ta|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeMapped(clients: PreImportClient[]): { merged: Record<string, unknown>; conflicts: Record<string, unknown[]> } {
  const merged: Record<string, unknown> = {};
  const conflicts: Record<string, unknown[]> = {};
  const allKeys = new Set<string>();
  for (const c of clients) Object.keys(c.mapped).forEach((k) => allKeys.add(k));

  for (const key of allKeys) {
    const vals = clients
      .map((c) => c.mapped[key])
      .filter((v) => v !== undefined && v !== null && v !== '' && v !== '—');
    if (vals.length === 0) continue;
    const unique = [...new Set(vals.map((v) => String(v).toLowerCase().trim()))];
    if (unique.length === 1) {
      merged[key] = vals[0];
    } else {
      merged[key] = vals[0];
      conflicts[key] = vals;
    }
  }
  return { merged, conflicts };
}

function computeDuplicateGroups(clients: PreImportClient[]): DuplicateGroup[] {
  const parent: Record<string, string> = {};
  const find = (x: string): string => {
    if (parent[x] === x) return x;
    parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const c of clients) parent[c.rawId] = c.rawId;

  const matchTypes: Record<string, 'tax_nr' | 'registration_nr' | 'name'> = {};

  const byTax: Record<string, string[]> = {};
  for (const c of clients) {
    const k = normTax(c.mapped.tax_nr);
    if (k.length < 4) continue;
    (byTax[k] ??= []).push(c.rawId);
  }
  for (const ids of Object.values(byTax)) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) { matchTypes[find(ids[i])] = 'tax_nr'; union(ids[0], ids[i]); }
  }

  const byReg: Record<string, string[]> = {};
  for (const c of clients) {
    const k = normReg(c.mapped.registration_nr);
    if (k.length < 4) continue;
    (byReg[k] ??= []).push(c.rawId);
  }
  for (const ids of Object.values(byReg)) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      const root = find(ids[i]);
      if (!matchTypes[root]) matchTypes[root] = 'registration_nr';
      union(ids[0], ids[i]);
    }
  }

  const byName: Record<string, string[]> = {};
  for (const c of clients) {
    const k = normName(c.mapped.client_name);
    if (k.length < 3) continue;
    (byName[k] ??= []).push(c.rawId);
  }
  for (const ids of Object.values(byName)) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      const root = find(ids[i]);
      if (!matchTypes[root]) matchTypes[root] = 'name';
      union(ids[0], ids[i]);
    }
  }

  const buckets: Record<string, string[]> = {};
  for (const c of clients) {
    const root = find(c.rawId);
    (buckets[root] ??= []).push(c.rawId);
  }

  return Object.entries(buckets)
    .filter(([, ids]) => ids.length >= 2)
    .map(([root, rawIds]) => {
      const groupClients = rawIds.map((id) => clients.find((c) => c.rawId === id)!).filter(Boolean);
      const { merged, conflicts } = mergeMapped(groupClients);
      return {
        id: root,
        matchType: matchTypes[root] ?? 'name',
        rawIds,
        merged,
        conflicts,
        status: 'confirmed' as const,
      };
    });
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
  const [editingCell, setEditingCell] = useState<{ uploadId: string; header: string } | null>(null);
  const hasRun = useRef(false);

  // Pre-import review state
  const [preImportClients, setPreImportClients] = useState<PreImportClient[]>([]);
  const [preImportEdits, setPreImportEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [preImportEditingId, setPreImportEditingId] = useState<string | null>(null);
  const [preImportSearch, setPreImportSearch] = useState('');
  const [preImportTab, setPreImportTab] = useState<'clients' | 'duplicates'>('clients');

  // Duplicate groups state
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [expandedDupGroupId, setExpandedDupGroupId] = useState<string | null>(null);
  const [recentlyActed, setRecentlyActed] = useState<Map<string, 'confirmed' | 'rejected'>>(new Map());

  // Year-end auto-fill tracking
  const [yearEndDefaultedCount, setYearEndDefaultedCount] = useState(0);

  // Refs to pass uploads/states into runPipeline without triggering re-renders
  const uploadsRef = useRef<UploadRow[]>([]);
  const statesRef = useRef<FileMappingState[]>([]);
  const duplicateGroupsRef = useRef<DuplicateGroup[]>([]);

  const appendLog = (s: string) => setPipelineLog((l) => [...l, s]);

  // ── Phase 1: fetch uploads, map columns, build pre-import list ────────────
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

      // Map columns for each upload
      const states: FileMappingState[] = [];
      const perStep = 40 / uploads.length;

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        setStatusText(`Mapping columns: ${u.file_name}…`);
        setProgress(5 + Math.round(i * perStep));

        let mapping: Record<string, string> = {};
        let confidence: Record<string, 'heuristic' | 'ai' | 'none'> = {};

        if (u.column_mapping && Object.keys(u.column_mapping).length > 0) {
          mapping = u.column_mapping;
          const cols = u.detected_columns ?? Object.keys(mapping);
          for (const h of cols) { confidence[h] = mapping[h] ? 'heuristic' : 'none'; }
        } else if (u.detected_columns && u.detected_columns.length > 0) {
          try {
            const res = await fetch('/api/map-columns', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId, uploadId: u.id, headers: u.detected_columns }),
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
              await supabase.from('uploads').update({ column_mapping: mapping }).eq('id', u.id);
            }
          } catch { /* fallthrough */ }
        }

        // Gap-fill: re-run heuristics for any column that has no mapping yet.
        // Also save back to DB so stale saved mappings are corrected.
        let gapFillChanged = false;
        for (const col of u.detected_columns ?? Object.keys(mapping)) {
          if (!mapping[col]) {
            const suggested = suggestFieldKey(col);
            if (suggested) {
              mapping[col] = suggested;
              confidence[col] = 'heuristic';
              gapFillChanged = true;
            }
          }
        }
        if (gapFillChanged) {
          await supabase.from('uploads').update({ column_mapping: mapping }).eq('id', u.id);
        }

        states.push({ uploadId: u.id, fileName: u.file_name, mapping, confidence, expanded: false });
      }

      setFileMappings(states);
      uploadsRef.current = uploads;
      statesRef.current = states;
      setProgress(45);

      // Build pre-import client list for review
      setStatusText('Loading client preview…');
      const preImportList: PreImportClient[] = [];

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const state = states[i];
        const { data: raws } = await supabase
          .from('raw_records')
          .select('id, data')
          .eq('upload_id', u.id);
        if (!raws) continue;

        for (const raw of raws as { id: string; data: Record<string, unknown> }[]) {
          const mapped: Record<string, unknown> = {};
          for (const [header, fieldKey] of Object.entries(state.mapping)) {
            if (!fieldKey) continue;
            mapped[fieldKey] = raw.data[header];
          }
          preImportList.push({ rawId: raw.id, uploadId: u.id, fileName: u.file_name, mapped });
        }
      }

      // Apply year-end defaults: Sole Props / Individuals always February;
      // any other entity missing a year end also defaults to February.
      let yeDefaulted = 0;
      for (const client of preImportList) {
        const hasYearEnd = client.mapped.year_end !== undefined
          && client.mapped.year_end !== null
          && String(client.mapped.year_end).trim() !== '';
        const entityType = String(client.mapped.entity_type ?? '').toLowerCase();
        const isSolePropOrIndividual =
          /sole\s*prop|sole\s*proprietor/i.test(entityType) ||
          /\bindividual\b|natural\s*person/i.test(entityType);

        if (!hasYearEnd || isSolePropOrIndividual) {
          client.mapped.year_end = 'February';
          yeDefaulted++;
        }
      }
      setYearEndDefaultedCount(yeDefaulted);

      const dupGroups = computeDuplicateGroups(preImportList);
      setDuplicateGroups(dupGroups);
      duplicateGroupsRef.current = dupGroups;

      setPreImportClients(preImportList);
      setProgress(50);
      setStatusText(`${preImportList.length} client${preImportList.length !== 1 ? 's' : ''} mapped — review before import.`);
      setPhase('pre-import');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  // onComplete intentionally excluded — see comment in runPipeline
  }, [sessionId, supabase]);

  // ── Phase 2: run the full pipeline (called by the user) ───────────────────
  const runPipeline = useCallback(async () => {
    const uploads = uploadsRef.current;
    const states = statesRef.current;

    setPhase('pipeline');
    setStatusText('Building client records…');
    setProgress(55);

    // Build a map: rawId → confirmed merged data (from duplicate groups)
    const confirmedMergeMap: Record<string, Record<string, unknown>> = {};
    for (const group of duplicateGroupsRef.current) {
      if (group.status !== 'confirmed') continue;
      for (const rawId of group.rawIds) {
        confirmedMergeMap[rawId] = group.merged;
      }
    }

    try {
      const allMapped: MappedRecord[] = [];

      for (let i = 0; i < uploads.length; i++) {
        const u = uploads[i];
        const state = states[i];
        setProgress(55 + Math.round((i / uploads.length) * 20));

        const { data: raws } = await supabase
          .from('raw_records')
          .select('id, data')
          .eq('upload_id', u.id);
        if (!raws) continue;

        appendLog(`${u.file_name}: ${raws.length} rows`);

        for (const raw of raws as { id: string; data: Record<string, unknown> }[]) {
          const canonical: Record<string, unknown> = {};
          for (const [header, fieldKey] of Object.entries(state.mapping)) {
            if (!fieldKey) continue;
            canonical[fieldKey] = raw.data[header];
          }
          // Apply confirmed duplicate-group merged data (fills gaps across sources)
          const mergedFromGroup = confirmedMergeMap[raw.id];
          if (mergedFromGroup) {
            for (const [k, v] of Object.entries(mergedFromGroup)) {
              if (!canonical[k] || canonical[k] === '' || canonical[k] === '—') canonical[k] = v;
            }
          }
          // Apply pre-import edits (highest priority)
          const edits = preImportEdits[raw.id];
          if (edits) Object.assign(canonical, edits);

          const leaked = correctFieldLeakage(canonical);
          const normalized = normalizeRecord(leaked);
          const ruled = applyRules(normalized);
          allMapped.push({ id: raw.id, source: u.source_type, data: ruled });
        }
      }

      appendLog(`Total records: ${allMapped.length}`);
      setProgress(75);
      setStatusText('Matching and deduplicating…');

      const { clusters, pendingNameMatches, stats } = matchRecords(allMapped);
      appendLog(`${stats.clusters} clusters · ${stats.pendingNameMatches} pending dedup · ${stats.archived} archived`);
      setProgress(82);

      setStatusText('Merging with source-of-truth hierarchy…');
      const merged = mergeAllClusters(clusters);
      appendLog(`${merged.length} final client records`);
      setProgress(88);

      // ── Staff auto-fill from employee list ──────────────────────────────────
      const ROLE_PATTERNS: Array<[RegExp, string]> = [
        [/managing\s*partner|senior\s*partner/i,                                      'partner'],
        [/tax\s*(manager|consultant|partner|specialist|advisor|officer|practitioner)/i, 'tax_role'],
        [/accounting\s*(manager|specialist|officer)\b|bookkeep(ing\s*(manager|role))?/i, 'accounting_role'],
        [/audit\s*(manager|partner|director|senior)\b/i,                              'financials_role'],
        [/payroll\s*(manager|administrator|officer|specialist)\b/i,                   'hr_role'],
        [/hr\s*(manager|officer|specialist|director)\b|human\s*resourc.*manager/i,    'hr_role'],
        [/cipc\s*(manager|officer)\b|secretarial\s*(manager|officer)\b/i,             'cipc_role'],
        [/\bpartner\b|\bdirector\b|\bowner\b|\bprincipal\b/i,                         'partner'],
        [/\bcipc\b|\bsecretarial\b|\bcompany\s*secret/i,                              'cipc_role'],
        [/\bhr\b|\bhuman\s*resourc|\bpayroll\b/i,                                     'hr_role'],
        [/\btax\b|\bsars\b|\btaxation\b/i,                                            'tax_role'],
        [/\baccounting\b|\bbookkeep|\baccounts?\s*role\b/i,                           'accounting_role'],
        [/\baudit\b|\bfinancials?\b|\bfinancial\s*statement/i,                        'financials_role'],
        [/\baccountant\b|\bclerk\b|\bbookkeeper\b/i,                                  'accountant'],
        [/\bmanager\b|\bsenior\s*manager\b|\bteam\s*lead\b/i,                         'manager'],
      ];

      function detectRole(data: Record<string, unknown>): string {
        const TITLE_KEYS = new Set(['accountant', 'job_title', 'role', 'position', 'designation', 'department']);
        const nameFields = new Set(['client_name', 'primary_contact']);
        const titleText = Object.entries(data)
          .filter(([k]) => TITLE_KEYS.has(k))
          .map(([, v]) => String(v ?? ''))
          .join(' ');
        for (const [pattern, field] of ROLE_PATTERNS) {
          if (titleText && pattern.test(titleText)) return field;
        }
        const fullText = Object.entries(data)
          .filter(([k]) => !nameFields.has(k))
          .map(([, v]) => String(v ?? ''))
          .join(' ');
        for (const [pattern, field] of ROLE_PATTERNS) {
          if (pattern.test(fullText)) return field;
        }
        return 'accountant';
      }

      const employeeRecords = allMapped.filter((r) => r.source === 'employees');
      const employeeEntries = employeeRecords
        .map((r) => {
          const d = r.data as Record<string, unknown>;
          const name = String(d.client_name ?? d.primary_contact ?? '').trim();
          return name ? { name, role: detectRole(d) } : null;
        })
        .filter((e): e is { name: string; role: string } => e !== null);

      const uniqueNames = [...new Set(employeeEntries.map((e) => e.name))];

      if (uniqueNames.length === 1) {
        const soloName = uniqueNames[0];
        appendLog(`One-man band — assigning "${soloName}" as accountant`);
        for (const rec of merged) {
          const m = rec as Record<string, unknown>;
          if (!m.accountant) m.accountant = soloName;
        }
      } else if (uniqueNames.length > 1) {
        const roleMap: Record<string, string> = {};
        for (const { name, role } of employeeEntries) {
          if (!roleMap[role]) roleMap[role] = name;
        }
        const roles = Object.keys(roleMap).join(', ');
        appendLog(`${uniqueNames.length} employees detected — assigning by role (${roles})`);
        for (const rec of merged) {
          const m = rec as Record<string, unknown>;
          for (const [field, name] of Object.entries(roleMap)) {
            if (!m[field]) m[field] = name;
          }
        }
        const fallbackAccountant = roleMap['accountant'] ?? employeeEntries[0]?.name;
        if (fallbackAccountant) {
          let filled = 0;
          for (const rec of merged) {
            const m = rec as Record<string, unknown>;
            if (!m._archived && !m.accountant) { m.accountant = fallbackAccountant; filled++; }
          }
          if (filled > 0) appendLog(`Filled accountant fallback ("${fallbackAccountant}") on ${filled} record(s)`);
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
        const { error: insErr } = await supabase.from('clusters').insert(toInsert.slice(i, i + 200));
        if (insErr) throw insErr;
      }

      await supabase.from('sessions').update({
        status: pendingNameMatches.length > 0 ? 'mapping' : 'reviewing',
        pending_name_matches: pendingNameMatches,
        dedup_confirmed: pendingNameMatches.length === 0,
      }).eq('id', sessionId);

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
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  // onComplete is intentionally excluded from deps — it's an inline arrow
  // function whose reference changes every parent render, which would cause
  // runPipeline to be re-created unnecessarily. It's only called via button clicks.
  }, [sessionId, supabase, preImportEdits]);

  useEffect(() => { run(); }, [run]);

  // Lock body scroll when pre-import edit modal is open
  useEffect(() => {
    document.body.style.overflow = preImportEditingId ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [preImportEditingId]);

  // ── Manual column override toggle ─────────────────────────────────────────
  function toggleExpanded(uploadId: string) {
    setFileMappings((prev) =>
      prev.map((f) => f.uploadId === uploadId ? { ...f, expanded: !f.expanded } : f),
    );
  }

  function setManualMapping(uploadId: string, header: string, fieldKey: string) {
    setFileMappings((prev) =>
      prev.map((f) => {
        if (f.uploadId !== uploadId) return f;
        const updated = { ...f.mapping, [header]: fieldKey };
        void supabase.from('uploads').update({ column_mapping: updated }).eq('id', uploadId);
        return { ...f, mapping: updated };
      }),
    );
    setEditingCell(null);
  }

  function counts(state: FileMappingState) {
    const vals = Object.values(state.confidence);
    return {
      heuristic: vals.filter((v) => v === 'heuristic').length,
      ai: vals.filter((v) => v === 'ai').length,
      none: vals.filter((v) => v === 'none').length,
      total: vals.length,
    };
  }

  // ── Duplicate group helpers ───────────────────────────────────────────────
  function toggleDupGroupStatus(groupId: string) {
    setDuplicateGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, status: g.status === 'confirmed' ? 'rejected' : 'confirmed' } as DuplicateGroup : g,
      );
      duplicateGroupsRef.current = updated;
      return updated;
    });
  }

  function setDupGroupStatus(groupId: string, status: 'confirmed' | 'rejected') {
    setDuplicateGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, status } as DuplicateGroup : g,
      );
      duplicateGroupsRef.current = updated;
      return updated;
    });
    setRecentlyActed((prev) => {
      const next = new Map(prev);
      next.set(groupId, status);
      return next;
    });
    setTimeout(() => {
      setRecentlyActed((prev) => {
        const next = new Map(prev);
        next.delete(groupId);
        return next;
      });
    }, 2000);
  }

  // ── Pre-import edit helpers ───────────────────────────────────────────────
  function updatePreImportField(rawId: string, fieldKey: string, value: unknown) {
    setPreImportEdits((prev) => ({
      ...prev,
      [rawId]: { ...(prev[rawId] ?? {}), [fieldKey]: value },
    }));
    setPreImportClients((prev) =>
      prev.map((c) => c.rawId === rawId ? { ...c, mapped: { ...c.mapped, [fieldKey]: value } } : c),
    );
  }

  // rawIds that belong to a confirmed (merged) group — hidden from All Clients individually
  const confirmedRawIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of duplicateGroups) {
      if (g.status === 'confirmed') g.rawIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [duplicateGroups]);

  // One synthetic merged representative per confirmed group
  const mergedRepresentatives = useMemo<PreImportClient[]>(() => {
    return duplicateGroups
      .filter((g) => g.status === 'confirmed')
      .map((g) => ({
        rawId: `__merged__${g.id}`,
        uploadId: '',
        fileName: `${g.rawIds.length} sources merged`,
        mapped: g.merged,
      }));
  }, [duplicateGroups]);

  const filteredPreImportClients = useMemo(() => {
    const base = [
      ...preImportClients.filter((c) => !confirmedRawIds.has(c.rawId)),
      ...mergedRepresentatives,
    ];
    if (!preImportSearch.trim()) return base;
    const q = preImportSearch.toLowerCase();
    return base.filter((c) =>
      String(c.mapped.client_name ?? '').toLowerCase().includes(q) ||
      String(c.mapped.trading_name ?? '').toLowerCase().includes(q) ||
      String(c.mapped.tax_nr ?? '').toLowerCase().includes(q),
    );
  }, [preImportClients, confirmedRawIds, mergedRepresentatives, preImportSearch]);

  const editCount = Object.keys(preImportEdits).length;

  const missingRegNrCount = useMemo(
    () => preImportClients.filter((c) => !c.mapped.registration_nr || c.mapped.registration_nr === '').length,
    [preImportClients],
  );
  const missingRegNrNote = preImportClients.length > 0 && missingRegNrCount / preImportClients.length > 0.7;

  // ── Render ────────────────────────────────────────────────────────────────
  const progressBarColor =
    phase === 'error'                             ? 'bg-red-500' :
    phase === 'done' || phase === 'already_done'  ? 'bg-green-500' :
    'bg-brand';

  return (
    <div className="space-y-5">

      {/* Header card with progress */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-navy-800">Automated mapping &amp; pipeline</h3>
            <p className="text-sm text-navy-500 mt-0.5">
              Upload your files and Woza La handles the rest — columns are detected,
              matched, and processed end-to-end without any manual input.
            </p>
          </div>
          {(phase === 'done' || phase === 'already_done') && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
              ✓ Complete
            </span>
          )}
          {phase === 'pre-import' && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 bg-teal-50 px-3 py-1 rounded-full">
              👁 Review ready
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
            style={{ width: `${phase === 'already_done' ? 100 : progress}%` }}
          />
        </div>
        <p className={`text-xs ${
          phase === 'already_done' || phase === 'done' ? 'text-green-600 font-medium' :
          phase === 'pre-import' ? 'text-teal-600 font-medium' :
          'text-navy-500'
        }`}>
          {statusText}
        </p>

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
              <button className="btn btn-primary" onClick={() => onComplete?.()}>Go to Review →</button>
              <button className="btn btn-secondary" onClick={() => { hasRun.current = false; setPhase('idle'); run(); }}>Re-run pipeline</button>
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="mt-4 flex gap-2 flex-wrap">
            {hasPendingDedup ? (
              <button className="btn btn-primary" onClick={() => onDedupRequired?.()}>
                Review Possible Duplicates →
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => onComplete?.()}>
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
                  {c.total} columns · {c.heuristic} rule-matched
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
                      const currentKey = state.mapping[header] ?? '';
                      const currentField = DATAGROWS_FIELDS.find((f) => f.key === currentKey);
                      const isEditing = editingCell?.uploadId === state.uploadId && editingCell?.header === header;
                      return (
                        <tr
                          key={header}
                          className={`group cursor-pointer transition-colors ${how === 'none' ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-navy-50'}`}
                          onClick={() => !isEditing && setEditingCell({ uploadId: state.uploadId, header })}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-navy-600">{header}</td>
                          <td className="px-4 py-2.5">
                            {isEditing ? (
                              <select
                                autoFocus
                                value={currentKey}
                                onChange={(e) => setManualMapping(state.uploadId, header, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                                onClick={(e) => e.stopPropagation()}
                                className="input text-sm w-full"
                              >
                                <option value="">— skip —</option>
                                {DATAGROWS_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.col}. {f.header}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className={`text-sm ${currentKey ? 'text-navy-800 font-medium' : 'text-navy-300 italic'}`}>
                                  {currentField ? `${currentField.col}. ${currentField.header}` : '— skip —'}
                                </span>
                                <span className="text-navy-300 opacity-0 group-hover:opacity-100 text-xs transition-opacity">✎</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
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

      {/* ── Pre-import client review ──────────────────────────────────────────── */}
      {phase === 'pre-import' && preImportClients.length > 0 && (
        <div className="card overflow-hidden">
          {/* Section header */}
          <div className="px-6 pt-4 pb-0 border-b border-navy-100 bg-white">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
              <div>
                <h3 className="text-base font-semibold text-navy-800">
                  Review {preImportClients.length} client{preImportClients.length !== 1 ? 's' : ''} before import
                </h3>
                <p className="text-xs text-navy-400 mt-0.5">
                  Click any row to edit details inline — changes are applied before the pipeline runs.
                  {editCount > 0 && (
                    <span className="text-teal-600 font-medium ml-2">
                      · {editCount} record{editCount !== 1 ? 's' : ''} edited
                    </span>
                  )}
                </p>
              </div>
              <button className="btn btn-primary shrink-0" onClick={() => void runPipeline()}>
                Run Import →
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 -mb-px">
              <button
                onClick={() => setPreImportTab('clients')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  preImportTab === 'clients'
                    ? 'border-teal-500 text-teal-700'
                    : 'border-transparent text-navy-500 hover:text-navy-700'
                }`}
              >
                All Clients
                <span className="ml-1.5 text-xs text-navy-400">({preImportClients.length})</span>
              </button>
              <button
                onClick={() => setPreImportTab('duplicates')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  preImportTab === 'duplicates'
                    ? 'border-teal-500 text-teal-700'
                    : 'border-transparent text-navy-500 hover:text-navy-700'
                }`}
              >
                Duplicates
                {(() => {
                  const pending = duplicateGroups.filter((g) => g.status !== 'confirmed').length;
                  if (duplicateGroups.length === 0) return null;
                  return (
                    <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'
                    }`}>
                      {pending > 0 ? pending : '✓'}
                    </span>
                  );
                })()}
              </button>
            </div>
          </div>

          {/* ── All Clients tab ── */}
          {preImportTab === 'clients' && (
            <>
              {yearEndDefaultedCount > 0 && (
                <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
                  <span className="text-blue-400 shrink-0 mt-0.5">ℹ</span>
                  <p className="text-xs text-blue-700">
                    <span className="font-semibold">{yearEndDefaultedCount} record{yearEndDefaultedCount !== 1 ? 's' : ''} </span>
                    had no year end — defaulted to <span className="font-semibold">February</span>.
                    Sole proprietors and individuals are always set to February. You can override any row by clicking it.
                  </p>
                </div>
              )}
              {missingRegNrNote && (
                <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
                  <span className="text-amber-400 shrink-0 mt-0.5">⚠</span>
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">Registration numbers are missing</span> for {missingRegNrCount} of {preImportClients.length} clients.
                    {' '}Sage and Xero exports do not include CIPC registration numbers — upload a CIPC extract to populate this field automatically, or enter values per client by clicking any row.
                  </p>
                </div>
              )}
              <div className="px-6 py-3 border-b border-navy-100 bg-white">
                <input
                  type="text"
                  className="input text-sm h-9 w-full max-w-sm"
                  placeholder="Search by name or tax number…"
                  value={preImportSearch}
                  onChange={(e) => setPreImportSearch(e.target.value)}
                />
              </div>
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead className="bg-navy-50 text-left text-navy-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5 font-medium text-xs w-8">#</th>
                      <th className="px-3 py-2.5 font-medium text-xs">Client Name</th>
                      <th className="px-3 py-2.5 font-medium text-xs">Entity Type</th>
                      <th className="px-3 py-2.5 font-medium text-xs">Tax Nr</th>
                      <th className="px-3 py-2.5 font-medium text-xs">Reg Nr</th>
                      <th className="px-3 py-2.5 font-medium text-xs">Year End</th>
                      <th className="px-3 py-2.5 font-medium text-xs hidden sm:table-cell">Email</th>
                      <th className="px-3 py-2.5 font-medium text-xs hidden md:table-cell">Source</th>
                      <th className="px-3 py-2.5 w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {filteredPreImportClients.map((c, idx) => {
                      const isMergedRep = c.rawId.startsWith('__merged__');
                      const isEdited = !isMergedRep && !!preImportEdits[c.rawId];
                      return (
                        <tr
                          key={c.rawId}
                          role={isMergedRep ? undefined : 'button'}
                          tabIndex={isMergedRep ? undefined : 0}
                          className={`select-none transition-colors ${
                            isMergedRep
                              ? 'bg-teal-50/40 cursor-default'
                              : isEdited
                                ? 'bg-teal-50/70 hover:bg-teal-50 cursor-pointer'
                                : 'hover:bg-navy-50 cursor-pointer'
                          }`}
                          onClick={() => { if (!isMergedRep) setPreImportEditingId(c.rawId); }}
                          onKeyDown={(e) => {
                            if (!isMergedRep && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPreImportEditingId(c.rawId); }
                          }}
                        >
                          <td className="px-3 py-2.5 text-xs text-navy-400">{idx + 1}</td>
                          <td className="px-3 py-2.5 text-navy-800 font-medium max-w-[180px] truncate">
                            <span>{String(c.mapped.client_name ?? '—')}</span>
                            {isMergedRep && (
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-teal-100 text-teal-700 align-middle">⊕ merged</span>
                            )}
                            {isEdited && (
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-teal-100 text-teal-700 align-middle">edited</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-navy-600 text-xs">{String(c.mapped.entity_type ?? '—')}</td>
                          <td className="px-3 py-2.5 text-navy-500 text-xs font-mono">{String(c.mapped.tax_nr ?? '—')}</td>
                          <td className="px-3 py-2.5 text-navy-500 text-xs font-mono">{String(c.mapped.registration_nr ?? '—')}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {String(c.mapped.year_end ?? '—') === 'February'
                              ? <span className="text-blue-600 font-medium">February</span>
                              : <span className="text-navy-600">{String(c.mapped.year_end ?? '—')}</span>
                            }
                          </td>
                          <td className="px-3 py-2.5 text-navy-500 text-xs hidden sm:table-cell truncate max-w-[160px]">{String(c.mapped.contact_email ?? '—')}</td>
                          <td className="px-3 py-2.5 text-xs hidden md:table-cell truncate max-w-[120px]">
                            {isMergedRep
                              ? <span className="text-teal-600 font-medium">{c.fileName}</span>
                              : <span className="text-navy-400">{c.fileName}</span>
                            }
                          </td>
                          <td className="px-3 py-2.5 text-navy-300 text-xs">{isMergedRep ? '' : '✎'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredPreImportClients.length === 0 && (
                  <p className="px-6 py-8 text-sm text-navy-400 text-center">No clients match your search.</p>
                )}
              </div>
              <div className="px-6 py-3 border-t border-navy-100 bg-navy-50 flex items-center justify-between">
                <p className="text-xs text-navy-400">
                  {filteredPreImportClients.length} of {preImportClients.length - confirmedRawIds.size + mergedRepresentatives.length} shown
                  {editCount > 0 && <span className="text-teal-600 font-medium ml-2">· {editCount} edited</span>}
                </p>
                <button className="btn btn-primary text-sm" onClick={() => void runPipeline()}>Run Import →</button>
              </div>
            </>
          )}

          {/* ── Duplicates tab ── */}
          {preImportTab === 'duplicates' && (
            <>
              {duplicateGroups.filter((g) => g.status !== 'confirmed').length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="text-3xl mb-2">✓</div>
                  <p className="text-sm font-medium text-navy-700">
                    {duplicateGroups.length > 0 ? 'All duplicates resolved' : 'No duplicates detected'}
                  </p>
                  <p className="text-xs text-navy-400 mt-1">
                    {duplicateGroups.length > 0
                      ? `${duplicateGroups.filter((g) => g.status === 'confirmed').length} groups merged · ${duplicateGroups.filter((g) => g.status === 'rejected').length} kept separate`
                      : 'All clients appear to be unique across uploaded files.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="px-6 py-3 border-b border-navy-100 bg-amber-50 flex items-center gap-3 flex-wrap">
                    <p className="text-xs text-amber-800 font-medium">
                      {duplicateGroups.filter((g) => g.status !== 'confirmed').length} group{duplicateGroups.filter((g) => g.status !== 'confirmed').length !== 1 ? 's' : ''} need a decision
                    </p>
                    <span className="text-amber-300">·</span>
                    <p className="text-xs text-amber-700">
                      {duplicateGroups.filter((g) => g.status === 'confirmed').length} merged
                      · {duplicateGroups.filter((g) => g.status === 'rejected').length} kept separate
                    </p>
                    <span className="text-xs text-amber-600">
                      Merged groups are consolidated — missing fields filled from other sources.
                    </span>
                  </div>
                  <div className="divide-y divide-navy-100 max-h-[580px] overflow-y-auto">
                    {duplicateGroups.filter((g) => g.status !== 'confirmed').map((group) => {
                      const groupClients = group.rawIds
                        .map((id) => preImportClients.find((c) => c.rawId === id))
                        .filter((c): c is PreImportClient => !!c);
                      const isExpanded = expandedDupGroupId === group.id;
                      const conflictCount = Object.keys(group.conflicts).length;
                      const matchLabel = group.matchType === 'tax_nr' ? 'Tax Nr' : group.matchType === 'registration_nr' ? 'Reg Nr' : 'Name';

                      return (
                        <div key={group.id} className={`${group.status === 'rejected' ? 'bg-navy-50/50 opacity-60' : 'bg-white'}`}>
                          {/* Group header */}
                          <div
                            className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-navy-50 transition-colors"
                            onClick={() => setExpandedDupGroupId(isExpanded ? null : group.id)}
                          >
                            <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              group.status === 'confirmed' ? 'bg-amber-100 text-amber-700' : 'bg-navy-100 text-navy-500'
                            }`}>
                              {group.status === 'confirmed' ? '⊕ Merge' : '— Split'}
                            </span>

                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-navy-800 truncate">
                                {String(group.merged.client_name ?? groupClients[0]?.mapped.client_name ?? 'Unknown')}
                              </p>
                              <p className="text-xs text-navy-400 mt-0.5">
                                {groupClients.length} records · matched on <span className="font-medium">{matchLabel}</span>
                                {conflictCount > 0 && (
                                  <span className="ml-2 text-orange-600 font-medium">· {conflictCount} field conflict{conflictCount !== 1 ? 's' : ''}</span>
                                )}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {recentlyActed.has(group.id) && (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full animate-pulse ${
                                  recentlyActed.get(group.id) === 'confirmed'
                                    ? 'bg-teal-100 text-teal-700'
                                    : 'bg-red-100 text-red-700'
                                }`}>
                                  {recentlyActed.get(group.id) === 'confirmed' ? '✓ Merged' : '✓ Kept separate'}
                                </span>
                              )}
                              <button
                                className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                                  group.status === 'confirmed'
                                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                                    : 'border-teal-200 text-teal-600 hover:bg-teal-50'
                                }`}
                                onClick={(e) => { e.stopPropagation(); setDupGroupStatus(group.id, 'confirmed'); }}
                              >
                                ⊕ Merge
                              </button>
                              <button
                                className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                                  group.status !== 'confirmed'
                                    ? 'border-red-500 bg-red-50 text-red-700'
                                    : 'border-red-200 text-red-600 hover:bg-red-50'
                                }`}
                                onClick={(e) => { e.stopPropagation(); setDupGroupStatus(group.id, 'rejected'); }}
                              >
                                Keep separate
                              </button>
                              <span className="text-navy-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="px-5 pb-4 space-y-3">
                              {/* Source records */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {groupClients.map((c) => (
                                  <div key={c.rawId} className="rounded-lg border border-navy-100 bg-navy-50 p-3">
                                    <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wider mb-2 truncate">
                                      {c.fileName}
                                    </p>
                                    {(['client_name', 'entity_type', 'tax_nr', 'registration_nr', 'contact_email', 'vat_nr'] as const).map((key) => {
                                      const val = c.mapped[key];
                                      const hasConflict = key in group.conflicts;
                                      if (!val && !hasConflict) return null;
                                      const label = DATAGROWS_FIELDS.find((f) => f.key === key)?.header ?? key;
                                      return (
                                        <div key={key} className="flex items-baseline gap-2 py-0.5">
                                          <span className="text-[10px] text-navy-400 w-20 shrink-0">{label}</span>
                                          <span className={`text-xs font-mono ${val ? 'text-navy-700' : 'text-navy-300'}`}>
                                            {String(val ?? '—')}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>

                              {/* Merged preview */}
                              <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
                                <p className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-2">
                                  Merged result {group.status === 'rejected' ? '(not applied — kept separate)' : ''}
                                </p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                                  {(['client_name', 'entity_type', 'tax_nr', 'registration_nr', 'contact_email', 'vat_nr'] as const).map((key) => {
                                    const val = group.merged[key];
                                    const hasConflict = key in group.conflicts;
                                    if (!val && !hasConflict) return null;
                                    const label = DATAGROWS_FIELDS.find((f) => f.key === key)?.header ?? key;
                                    return (
                                      <div key={key} className="flex items-baseline gap-2 py-0.5">
                                        <span className="text-[10px] text-teal-500 w-20 shrink-0">{label}</span>
                                        <span className={`text-xs font-mono ${hasConflict ? 'text-orange-700 font-semibold' : 'text-teal-800'}`}>
                                          {String(val ?? '—')}
                                          {hasConflict && <span className="ml-1 text-[9px] text-orange-500 font-normal">conflict</span>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-6 py-3 border-t border-navy-100 bg-navy-50 flex items-center justify-between">
                    <p className="text-xs text-navy-400">
                      {duplicateGroups.filter((g) => g.status === 'confirmed').length} group{duplicateGroups.filter((g) => g.status === 'confirmed').length !== 1 ? 's' : ''} will be merged
                    </p>
                    <button className="btn btn-primary text-sm" onClick={() => void runPipeline()}>Run Import →</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Pre-import inline edit modal ─────────────────────────────────────── */}
      {preImportEditingId && (() => {
        const target = preImportClients.find((c) => c.rawId === preImportEditingId);
        if (!target) return null;
        const quickSet = new Set(QUICK_FIELDS);
        const otherFields = DATAGROWS_FIELDS.filter(
          (f) => !quickSet.has(f.key)
            && target.mapped[f.key] !== undefined
            && target.mapped[f.key] !== null
            && target.mapped[f.key] !== '',
        );
        const idx = filteredPreImportClients.findIndex((c) => c.rawId === preImportEditingId);
        const prev = filteredPreImportClients[idx - 1];
        const next = filteredPreImportClients[idx + 1];
        return (
          <div className="fixed inset-0 z-50 flex flex-col" role="dialog" aria-modal="true">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setPreImportEditingId(null)}
            />

            {/* Panel */}
            <div className="relative z-10 flex flex-col bg-white w-full h-full sm:m-4 sm:rounded-2xl sm:h-[calc(100vh-2rem)] sm:max-w-3xl sm:mx-auto overflow-hidden shadow-2xl">
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-navy-100 bg-white shrink-0">
                <div>
                  <h3 className="text-lg font-semibold text-navy-800">
                    {String(target.mapped.client_name ?? 'Unnamed client')}
                  </h3>
                  <p className="text-xs text-navy-400 mt-0.5">
                    Pre-import edit — from <span className="font-medium text-navy-600">{target.fileName}</span>
                    {preImportEdits[target.rawId] && (
                      <span className="ml-2 text-teal-600 font-medium">· edited</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setPreImportEditingId(null)}
                  className="btn btn-ghost"
                  aria-label="Close"
                >
                  Close ✕
                </button>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {/* Quick-edit: key fields */}
                <div className="p-4 bg-navy-50 rounded-lg border border-navy-100">
                  <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">
                    Key Details
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {QUICK_FIELDS.map((key) => {
                      const f = DATAGROWS_FIELDS.find((x) => x.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key}>
                          <label className="block text-xs font-medium text-navy-600 mb-1">{f.header}</label>
                          <FieldInput
                            field={f}
                            value={target.mapped[f.key]}
                            onChange={(val) => updatePreImportField(target.rawId, f.key, val)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Other mapped fields (non-empty, non-quick) */}
                {otherFields.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">
                      Other Mapped Fields
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {otherFields.map((f) => (
                        <div key={f.key} className={f.type === 'longtext' ? 'col-span-2' : ''}>
                          <label className="block text-xs font-medium text-navy-600 mb-1">{f.header}</label>
                          <FieldInput
                            field={f}
                            value={target.mapped[f.key]}
                            onChange={(val) => updatePreImportField(target.rawId, f.key, val)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer — prev/next nav + done */}
              <div className="px-6 py-4 border-t border-navy-100 bg-navy-50 flex items-center justify-between shrink-0">
                <div className="flex gap-2">
                  <button
                    disabled={!prev}
                    onClick={() => prev && setPreImportEditingId(prev.rawId)}
                    className="btn btn-ghost text-sm disabled:opacity-30"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={!next}
                    onClick={() => next && setPreImportEditingId(next.rawId)}
                    className="btn btn-ghost text-sm disabled:opacity-30"
                  >
                    Next →
                  </button>
                  <span className="text-xs text-navy-400 self-center ml-1">
                    {idx + 1} / {filteredPreImportClients.length}
                  </span>
                </div>
                <button
                  onClick={() => setPreImportEditingId(null)}
                  className="btn btn-primary text-sm"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
