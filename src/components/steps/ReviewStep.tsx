'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DATAGROWS_FIELDS, FIELD_BY_COL, REQUIRED_FIELDS, type FieldDef, type ClientRecord } from '@/lib/schema/datagrows';
import { SOURCE_LABELS, type SourceType } from '@/lib/schema/sources';
import { validateRecord } from '@/lib/validator';
import { humanizeIssue } from '@/lib/validator/humanize';
import type { PendingNameMatch } from '@/lib/matcher';

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

// ── Per-field error badge with distinct colour per field ─────────────────────

const FIELD_BADGE_COLORS: Record<string, string> = {
  client_name:  'bg-red-100 text-red-700 border-red-300',
  status:       'bg-orange-100 text-orange-700 border-orange-300',
  entity_type:  'bg-purple-100 text-purple-700 border-purple-300',
  year_end:     'bg-blue-100 text-blue-700 border-blue-300',
  accountant:   'bg-pink-100 text-pink-700 border-pink-300',
};

const FIELD_SHORT: Record<string, string> = {
  client_name: 'Name',
  status:      'Status',
  entity_type: 'Entity',
  year_end:    'Year End',
  accountant:  'Accountant',
};

function ErrorBadge({ field }: { field: string }) {
  const color = FIELD_BADGE_COLORS[field] ?? 'bg-rose-100 text-rose-700 border-rose-300';
  const label = FIELD_SHORT[field] ?? field.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${color}`}>
      {label}
    </span>
  );
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

interface StaffMember { id: string; name: string; roles: string[] }

const STAFF_ROLE_FIELDS = new Set([
  'partner', 'manager', 'accountant',
  'accounting_role', 'cipc_role', 'tax_role', 'financials_role', 'hr_role',
]);

export function ReviewStep({
  sessionId,
  firmId,
  operatorName,
  initialFilter,
  onOpenFirmSlideOver,
  onGoToImport,
  onProceedToExport,
}: {
  sessionId: string;
  firmId?: string;
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
  const [savedField, setSavedField] = useState<string | null>(null);
  const [lastExportedAt, setLastExportedAt] = useState<Date | null>(null);
  const [postExportEdits, setPostExportEdits] = useState<EditRecord[]>([]);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending dedup suggestions
  const [pendingMatches, setPendingMatches] = useState<PendingNameMatch[]>([]);
  const [dedupSaving, setDedupSaving] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null); // cluster DB id with open match card

  // Column header filters
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSources, setFilterSources] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState('accountant');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkPaused, setBulkPaused] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkCancelledRef = useRef(false);
  const bulkPausedRef = useRef(false);
  const [bulkUseText, setBulkUseText] = useState(false);
  const [accountantPanelOpen, setAccountantPanelOpen] = useState(true);

  // Firm staff for bulk staff picker
  const [firmStaff, setFirmStaff] = useState<StaffMember[]>([]);
  const [uploadedEmployees, setUploadedEmployees] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);

    // Load clusters
    const { data: clusterData } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived, archive_reason, primary_key_value')
      .eq('session_id', sessionId);

    // Backfill: any cluster with no status / year_end / accountant gets defaults applied and saved
    const rows = (clusterData as ClusterRow[]) ?? [];

    // Fetch first accountant from firm_employees for this session (fallback for missing accountant)
    let fallbackAccountant: string | null = null;
    const { data: empData } = await supabase
      .from('firm_employees')
      .select('name, dg_roles, job_title')
      .eq('session_id', sessionId)
      .limit(50);
    if (empData && empData.length > 0) {
      type EmpRow = { name: string; dg_roles: string[] | null; job_title: string | null };
      const emps = empData as EmpRow[];
      // Prefer someone with 'accountant' in dg_roles, else first employee
      const acctEmp = emps.find((e) => e.dg_roles?.includes('accountant')) ?? emps[0];
      fallbackAccountant = acctEmp?.name ?? null;
    }

    const needsBackfill = rows.filter((r) => {
      const m = r.merged as Record<string, unknown>;
      return (!m.status || !m.year_end || (!r.archived && !m.accountant && fallbackAccountant));
    });
    if (needsBackfill.length > 0) {
      await Promise.all(needsBackfill.map((r) => {
        const m = { ...(r.merged as Record<string, unknown>) };
        if (!m.status) m.status = 'Active';
        if (!m.year_end) m.year_end = 'February';
        if (!r.archived && !m.accountant && fallbackAccountant) m.accountant = fallbackAccountant;
        r.merged = m as ClusterRow['merged'];
        return supabase.from('clusters').update({ merged: m }).eq('id', r.id);
      }));
    }

    setClusters(rows);

    // Load session data — last_exported_at + pending dedup suggestions
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('last_exported_at, pending_name_matches')
      .eq('id', sessionId)
      .single();
    setPendingMatches((sessionData?.pending_name_matches as PendingNameMatch[] | null) ?? []);
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

  // Load firm staff for the bulk staff picker
  useEffect(() => {
    if (!firmId) return;
    supabase.from('firm_staff').select('id, name, roles').eq('firm_id', firmId).order('name')
      .then(({ data }) => { if (data) setFirmStaff(data as StaffMember[]); });
  }, [firmId, supabase]);

  // Load uploaded employees for the bulk dropdown
  useEffect(() => {
    supabase.from('firm_employees').select('name').eq('session_id', sessionId).order('name')
      .then(({ data }) => {
        if (data) {
          const names = [...new Set((data as { name: string }[]).map((e) => e.name).filter(Boolean))].sort();
          setUploadedEmployees(names);
        }
      });
  }, [sessionId, supabase]);

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
    let base: typeof decorated;
    switch (filter) {
      case 'ready':    base = decorated.filter((c) => !c.archived && c.validation.ok); break;
      case 'errors':   base = decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'error')); break;
      case 'warnings': base = decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'warning')); break;
      case 'archived': base = decorated.filter((c) => c.archived); break;
      case 'dormant':  base = decorated.filter((c) => c.merged.status === 'Dormant'); break;
      default:         base = decorated; break;
    }
    if (filterEntityType) {
      base = base.filter((c) => String(c.merged.entity_type ?? '') === filterEntityType);
    }
    if (filterStatus) {
      base = base.filter((c) => String(c.merged.status ?? '') === filterStatus);
    }
    if (filterSources) {
      base = base.filter((c) => (c.sources ?? []).includes(filterSources));
    }
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      base = base.filter((c) =>
        String(c.merged.client_name ?? '').toLowerCase().includes(q) ||
        String(c.merged.trading_name ?? '').toLowerCase().includes(q),
      );
    }
    return base;
  }, [decorated, filter, filterEntityType, filterStatus, filterSources, filterSearch]);

  // Unique values for column header filter dropdowns
  const entityTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of decorated) { const et = String(c.merged.entity_type ?? ''); if (et) seen.add(et); }
    return Array.from(seen).sort();
  }, [decorated]);

  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of decorated) { const s = String(c.merged.status ?? ''); if (s) seen.add(s); }
    return Array.from(seen).sort();
  }, [decorated]);

  const sourcesOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const c of decorated) { for (const s of (c.sources ?? [])) seen.add(s); }
    return Array.from(seen).sort();
  }, [decorated]);

  const hasColumnFilters = !!(filterEntityType || filterStatus || filterSources || filterSearch);

  // Quick lookup: cluster local id → pending match
  const pendingMatchByLocalId = useMemo(() => {
    const map = new Map<string, PendingNameMatch>();
    for (const m of pendingMatches) map.set(m.orphanClusterId, m);
    return map;
  }, [pendingMatches]);

  const counts = useMemo(() => ({
    all: decorated.length,
    ready: decorated.filter((c) => !c.archived && c.validation.ok).length,
    errors: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'error')).length,
    warnings: decorated.filter((c) => !c.archived && c.validation.issues.some((i) => i.severity === 'warning')).length,
    archived: decorated.filter((c) => c.archived).length,
    dormant: decorated.filter((c) => c.merged.status === 'Dormant').length,
  }), [decorated]);

  // Group error clusters by field for the quick-fix bar
  const errorsByField = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of decorated) {
      if (c.archived) continue;
      for (const issue of c.validation.issues) {
        if (issue.severity === 'error') {
          if (!map[issue.field]) map[issue.field] = [];
          map[issue.field].push(c.id);
        }
      }
    }
    return map;
  }, [decorated]);

  function dobFromSAId(idNumber: string): string | null {
    const clean = idNumber.replace(/\D/g, '');
    if (clean.length !== 13) return null;
    const yy = parseInt(clean.slice(0, 2), 10);
    const mm = clean.slice(2, 4);
    const dd = clean.slice(4, 6);
    const mmN = parseInt(mm, 10);
    const ddN = parseInt(dd, 10);
    if (mmN < 1 || mmN > 12 || ddN < 1 || ddN > 31) return null;
    const currentYY = new Date().getFullYear() % 100;
    const year = yy <= currentYY ? 2000 + yy : 1900 + yy;
    return `${dd}/${mm}/${year}`;
  }

  async function updateField(clusterId: string, fieldKey: string, value: unknown) {
    const target = clusters.find((c) => c.id === clusterId);
    if (!target) return;
    const oldValue = (target.merged as Record<string, unknown>)[fieldKey] ?? null;
    let newMerged = { ...target.merged, [fieldKey]: value };

    // Auto-fill Date of Birth from SA ID number (column F → G)
    if (fieldKey === 'id_number') {
      const dob = dobFromSAId(String(value ?? ''));
      const existingDob = (target.merged as Record<string, unknown>).date_of_birth;
      if (dob && !existingDob) {
        newMerged = { ...newMerged, date_of_birth: dob };
      }
    }

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

  async function bulkUpdateField(fieldKey: string, value: unknown, toFiltered = false) {
    setBulkApplying(true);
    setBulkPaused(false);
    bulkCancelledRef.current = false;
    bulkPausedRef.current = false;
    const ids = toFiltered ? filtered.map((c) => c.id) : Array.from(selectedIds);
    setBulkProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      if (bulkCancelledRef.current) break;
      // Pause: spin-wait until resumed or cancelled
      while (bulkPausedRef.current && !bulkCancelledRef.current) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (bulkCancelledRef.current) break;
      await updateField(ids[i], fieldKey, value);
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    if (!toFiltered && !bulkCancelledRef.current) setSelectedIds(new Set());
    setBulkValue('');
    setBulkApplying(false);
    setBulkPaused(false);
    setBulkProgress(null);
    bulkPausedRef.current = false;
    bulkCancelledRef.current = false;
  }

  async function bulkMergeMatches(ids: Set<string>) {
    setBulkApplying(true);
    for (const dbId of ids) {
      const cluster = clusters.find((c) => c.id === dbId);
      if (!cluster) continue;
      const localId = (cluster.merged as Record<string, unknown>)._cluster_id as string | undefined;
      if (!localId) continue;
      const match = pendingMatchByLocalId.get(localId);
      if (!match) continue;
      await acceptDedupMatch(match);
    }
    setSelectedIds(new Set());
    setBulkApplying(false);
  }

  async function acceptDedupMatch(match: PendingNameMatch) {
    setDedupSaving(true);
    // Build local-id → supabase-id map
    const idMap = new Map<string, string>();
    for (const c of clusters) {
      const localId = (c.merged as Record<string, unknown>)._cluster_id as string | undefined;
      if (localId) idMap.set(localId, c.id);
    }
    const orphanDbId = idMap.get(match.orphanClusterId);
    const candidateDbId = idMap.get(match.candidateClusterId);
    if (orphanDbId && candidateDbId) {
      const orphanRow = clusters.find((c) => c.id === orphanDbId);
      const candidateRow = clusters.find((c) => c.id === candidateDbId);
      if (orphanRow && candidateRow) {
        // Merge: candidate fields win, orphan fills blanks
        const mergedRecord: Record<string, unknown> = { ...(orphanRow.merged as Record<string, unknown>) };
        for (const [k, v] of Object.entries(candidateRow.merged as Record<string, unknown>)) {
          if (v !== null && v !== undefined && v !== '') mergedRecord[k] = v;
        }
        const mergedSources = Array.from(new Set([...(candidateRow.sources ?? []), ...(orphanRow.sources ?? [])]));
        await supabase.from('clusters').update({ merged: mergedRecord, sources: mergedSources }).eq('id', candidateDbId);
        await supabase.from('clusters').delete().eq('id', orphanDbId);
        setPendingMatches((prev) => prev.filter((m) => m.orphanClusterId !== match.orphanClusterId));
        setEditing(candidateDbId);
      }
    }
    setDedupSaving(false);
    await load();
  }

  async function rejectDedupMatch(match: PendingNameMatch) {
    setDedupSaving(true);
    const idMap = new Map<string, string>();
    for (const c of clusters) {
      const localId = (c.merged as Record<string, unknown>)._cluster_id as string | undefined;
      if (localId) idMap.set(localId, c.id);
    }
    const orphanDbId = idMap.get(match.orphanClusterId);
    if (orphanDbId) {
      await supabase.from('clusters').update({
        archived: true,
        archive_reason: `Kept separate from "${match.candidateName}" — confirmed not a duplicate.`,
      }).eq('id', orphanDbId);
      setPendingMatches((prev) => prev.filter((m) => m.orphanClusterId !== match.orphanClusterId));
    }
    setDedupSaving(false);
    await load();
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

  return (
    <div className="space-y-4">

      {/* ── Page heading ─────────────────────────────────────────────────────── */}
      <div className="pb-1 border-b border-navy-100">
        <h2 className="text-xl font-semibold text-navy-800">Review Clients</h2>
        <p className="text-sm text-navy-400 mt-0.5">
          Check every record before export. Fix errors (red), resolve warnings (amber), and archive clients that should be excluded. Click any row to open the full edit panel.
        </p>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="-mx-4 sm:mx-0">
        <div className="flex overflow-x-auto gap-2 px-4 sm:px-0 pb-1 scrollbar-none items-center">
          {([
            ['all',      `All (${counts.all})`,           'bg-teal-600 text-white border-teal-600',         'border border-gray-200 text-navy-600 hover:border-teal-400'],
            ['ready',    `Ready (${counts.ready})`,       'bg-emerald-600 text-white border-emerald-600',   'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'],
            ['errors',   `Errors (${counts.errors})`,     'bg-rose-600 text-white border-rose-600',         'border border-rose-200 text-rose-600 hover:bg-rose-50'],
            ['warnings', `Warnings (${counts.warnings})`, 'bg-amber-500 text-white border-amber-500',       'border border-amber-200 text-amber-600 hover:bg-amber-50'],
            ['dormant',  `Dormant (${counts.dormant})`,   'bg-slate-500 text-white border-slate-500',       'border border-slate-200 text-slate-500 hover:bg-slate-50'],
            ['archived', `Archived (${counts.archived})`, 'bg-gray-500 text-white border-gray-500',         'border border-gray-200 text-gray-500 hover:bg-gray-50'],
          ] as [Filter, string, string, string][]).map(([k, label, activeClass, inactiveClass]) => (
            <button
              key={k}
              onClick={() => { setFilter(k); setSelectedIds(new Set()); }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-colors ${filter === k ? activeClass : inactiveClass}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Name search + clear ──────────────────────────────────────────────── */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          className="input text-sm h-9 flex-1"
          placeholder="Search by client or trading name…"
          value={filterSearch}
          onChange={(e) => { setFilterSearch(e.target.value); setSelectedIds(new Set()); }}
        />
        {hasColumnFilters && (
          <button
            className="text-xs text-navy-400 underline hover:text-navy-600 shrink-0"
            onClick={() => { setFilterEntityType(''); setFilterStatus(''); setFilterSources(''); setFilterSearch(''); setSelectedIds(new Set()); }}
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* ── Quick-fix bar ────────────────────────────────────────────────────── */}
      {Object.keys(errorsByField).length > 0 && selectedIds.size === 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-sm">
          <span className="text-rose-700 font-semibold shrink-0">Quick fix:</span>
          {Object.entries(errorsByField).map(([field, ids]) => {
            const label = FIELD_SHORT[field] ?? field.replace(/_/g, ' ');
            return (
              <button
                key={field}
                onClick={() => {
                  setSelectedIds(new Set(ids));
                  setBulkField(field);
                  setBulkValue('');
                  setFilter('all');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 font-medium hover:bg-rose-100 transition-colors"
              >
                <span className="text-rose-400 font-bold">{ids.length}×</span>
                {label} missing
              </button>
            );
          })}
        </div>
      )}

      {/* ── Continue bar (top) ───────────────────────────────────────────────── */}
      {onProceedToExport && clusters.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-navy-500">
            <span className="font-medium text-navy-800">{counts.ready}</span> record{counts.ready !== 1 ? 's' : ''} ready
            {counts.errors > 0 && <span className="text-rose-500 ml-2">· {counts.errors} with errors</span>}
          </p>
          <button onClick={onProceedToExport} className="btn btn-primary text-sm">
            Continue to Export →
          </button>
        </div>
      )}

      {/* ── Assign Accountant panel ─────────────────────────────────────────── */}
      {selectedIds.size === 0 && (() => {
        const allStaffNames = [...new Set([
          ...firmStaff.map((s) => s.name),
          ...uploadedEmployees,
        ])].sort();
        return (
          <div className="border border-navy-200 rounded-xl overflow-hidden">
            {/* Collapse toggle header */}
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-navy-50 hover:bg-navy-100 transition-colors"
              onClick={() => setAccountantPanelOpen((o) => !o)}
            >
              <span className="text-sm font-semibold text-navy-700">Assign Accountant</span>
              <span className="text-navy-400 text-xs">{accountantPanelOpen ? '▲ Collapse' : '▼ Expand'}</span>
            </button>

            {accountantPanelOpen && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-white text-sm">
                {allStaffNames.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-2 flex-1 items-center">
                      {allStaffNames.map((name) => (
                        <button
                          key={name}
                          disabled={bulkApplying}
                          onClick={() => { setBulkField('accountant'); setBulkValue(name); }}
                          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 ${
                            bulkValue === name && bulkField === 'accountant'
                              ? 'bg-teal text-white border-teal shadow-sm'
                              : 'bg-white text-navy-700 border-navy-200 hover:border-teal hover:bg-teal-50'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    {bulkValue && bulkField === 'accountant' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          disabled={bulkApplying}
                          className="btn btn-primary text-sm disabled:opacity-40"
                          onClick={() => void bulkUpdateField('accountant', bulkValue, true)}
                        >
                          {bulkApplying ? `Applying… ${bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : ''}` : `Apply to all ${filtered.length} visible`}
                        </button>
                        <button
                          disabled={bulkApplying}
                          className="text-xs text-navy-400 underline hover:text-navy-600"
                          onClick={() => setBulkValue('')}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-navy-400 text-sm">No staff registered yet.</span>
                )}
                {onOpenFirmSlideOver && (
                  <button
                    className="ml-auto text-xs text-teal-600 hover:text-teal-800 font-medium underline shrink-0"
                    onClick={() => onOpenFirmSlideOver('employees')}
                  >
                    Manage Staff →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Bulk-edit bar ────────────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (() => {
        const field = DATAGROWS_FIELDS.find((f) => f.key === bulkField);
        // Count selected rows that have a pending match suggestion
        const bulkMatchCount = Array.from(selectedIds).filter((dbId) => {
          const cluster = clusters.find((c) => c.id === dbId);
          if (!cluster) return false;
          const localId = (cluster.merged as Record<string, unknown>)._cluster_id as string | undefined;
          return localId ? pendingMatchByLocalId.has(localId) : false;
        }).length;
        const isStaffField = STAFF_ROLE_FIELDS.has(bulkField);
        const roleLabel = DATAGROWS_FIELDS.find((f) => f.key === bulkField)?.header ?? '';
        const staffForField = isStaffField
          ? firmStaff.filter((s) => {
              if (s.roles.length === 0) return true;
              return s.roles.some((r) => r.toLowerCase().includes(roleLabel.toLowerCase().split(' ')[0]));
            })
          : [];
        // Combined dropdown options: firm_staff names + uploaded employee names (deduped)
        const staffNames = [...new Set([
          ...staffForField.map((s) => s.name),
          ...uploadedEmployees,
        ])].sort();
        const showStaffPicker = isStaffField && firmStaff.length > 0;

        return (
          <div className="flex flex-col gap-3 px-4 py-3 bg-teal-50 border border-teal-200 rounded-xl text-sm">
            {/* Row 1: selection count + field + value + primary action */}
            <div className="flex flex-wrap items-center gap-3">

              {/* Selected count badge */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal text-white text-xs font-bold">
                  {selectedIds.size}
                </span>
                <span className="font-semibold text-teal-800 text-sm">
                  client{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
              </div>

              {/* Merge suggestion shortcut */}
              {bulkMatchCount > 0 && (
                <button
                  className="btn text-sm shrink-0 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                  disabled={bulkApplying}
                  onClick={() => void bulkMergeMatches(selectedIds)}
                >
                  {bulkApplying ? 'Merging…' : `↔ Merge ${bulkMatchCount} match${bulkMatchCount !== 1 ? 'es' : ''}`}
                </button>
              )}

              {/* Field picker */}
              <select
                className="input flex-shrink-0 w-44"
                value={bulkField}
                onChange={(e) => { setBulkField(e.target.value); setBulkValue(''); setBulkUseText(false); }}
              >
                {[
                  'status', 'accountant', 'partner', 'manager',
                  'accounting_role', 'cipc_role', 'tax_role', 'financials_role', 'hr_role',
                  'entity_type', 'year_end',
                ].map((k) => {
                  const f = DATAGROWS_FIELDS.find((x) => x.key === k);
                  return f ? <option key={k} value={k}>{f.header}</option> : null;
                })}
              </select>

              {/* Value input — staff dropdown or text */}
              {field && (
                isStaffField && staffNames.length > 0 && !bulkUseText ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <select
                      className="input w-48"
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                    >
                      <option value="">— select {roleLabel} —</option>
                      {staffNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <button
                      className="text-xs text-teal-600 hover:text-teal-800 underline whitespace-nowrap"
                      onClick={() => { setBulkUseText(true); setBulkValue(''); }}
                    >
                      Type manually
                    </button>
                  </div>
                ) : field.type === 'enum' && field.enum ? (
                  <select className="input flex-shrink-0 w-44" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
                    <option value="">— choose —</option>
                    {field.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <input
                      type="text"
                      className="input w-44"
                      placeholder={`New value for ${field.header}`}
                      value={bulkValue}
                      onChange={(e) => setBulkValue(e.target.value)}
                    />
                    {isStaffField && staffNames.length > 0 && (
                      <button
                        className="text-xs text-teal-600 hover:text-teal-800 underline whitespace-nowrap"
                        onClick={() => { setBulkUseText(false); setBulkValue(''); }}
                      >
                        Pick from list
                      </button>
                    )}
                  </div>
                )
              )}

              {/* ── Primary action / progress controls ── */}
              {bulkApplying ? (
                <div className="flex items-center gap-2 shrink-0">
                  {bulkProgress && (
                    <span className="text-xs text-teal-700 font-medium whitespace-nowrap">
                      {bulkProgress.done}/{bulkProgress.total}
                    </span>
                  )}
                  <button
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                    onClick={() => { bulkPausedRef.current = !bulkPausedRef.current; setBulkPaused(bulkPausedRef.current); }}
                  >
                    {bulkPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                    onClick={() => { bulkCancelledRef.current = true; bulkPausedRef.current = false; setBulkPaused(false); }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                (!showStaffPicker || bulkValue) && (
                  <button
                    className="btn btn-primary text-sm shrink-0"
                    disabled={!bulkValue || selectedIds.size === 0}
                    onClick={() => void bulkUpdateField(bulkField, bulkValue, false)}
                  >
                    {`Apply to ${selectedIds.size} selected`}
                  </button>
                )
              )}

              <button
                className="btn btn-ghost text-sm shrink-0 text-navy-500"
                disabled={bulkApplying}
                onClick={() => { setSelectedIds(new Set()); setBulkValue(''); }}
              >
                Clear
              </button>
            </div>

            {/* Row 2: staff quick-pick buttons */}
            {showStaffPicker && (
              <div className="border-t border-teal-200 pt-3">
                <p className="text-xs text-teal-700 font-medium mb-2">
                  Pick a staff member to assign as <strong>{field?.header}</strong> for the {selectedIds.size} selected client{selectedIds.size !== 1 ? 's' : ''}:
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  {(staffForField.length > 0 ? staffForField : firmStaff).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setBulkValue(s.name)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        bulkValue === s.name
                          ? 'bg-teal text-white border-teal shadow-sm'
                          : 'bg-white text-navy-700 border-navy-200 hover:border-teal hover:bg-teal-50'
                      }`}
                    >
                      {s.name}
                      {s.roles.length > 0 && (
                        <span className={`text-xs ${bulkValue === s.name ? 'text-teal-100' : 'text-navy-400'}`}>
                          · {s.roles.join(', ')}
                        </span>
                      )}
                    </button>
                  ))}
                  {bulkValue && !bulkApplying && (
                    <button
                      className="btn btn-primary text-sm shrink-0 ml-1"
                      disabled={selectedIds.size === 0}
                      onClick={() => void bulkUpdateField(bulkField, bulkValue, false)}
                    >
                      {`✓ Apply to ${selectedIds.size} selected`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Row 3: secondary — apply to all filtered (less prominent) */}
            {bulkValue && (
              <div className="flex items-center gap-2 border-t border-teal-100 pt-2">
                <span className="text-xs text-teal-600">Apply to everyone in the current view instead?</span>
                <button
                  className="text-xs text-teal-700 font-semibold underline hover:text-teal-900 disabled:opacity-50"
                  disabled={bulkApplying}
                  onClick={() => void bulkUpdateField(bulkField, bulkValue, true)}
                >
                  {`Apply to all ${filtered.length} filtered clients`}
                </button>
              </div>
            )}
          </div>
        );
      })()}

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
              <th className="pl-3 pr-1 py-3 w-8">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(filtered.map((c) => c.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  title="Select all visible"
                  onClick={(e) => e.stopPropagation()}
                />
              </th>
              {/* Client Name */}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Client Name</th>
              {/* Entity Type — filterable */}
              <th className="px-3 py-2 font-medium whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col gap-0.5">
                  <span className={filterEntityType ? 'text-teal-700' : ''}>Entity Type</span>
                  <select
                    className="text-xs font-normal border border-navy-200 rounded px-1 py-0.5 bg-white text-navy-700 focus:outline-none focus:border-teal-400 cursor-pointer"
                    value={filterEntityType}
                    onChange={(e) => { setFilterEntityType(e.target.value); setSelectedIds(new Set()); }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    {entityTypeOptions.map((et) => <option key={et} value={et}>{et}</option>)}
                  </select>
                </div>
              </th>
              {/* Registration Nr */}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Registration Nr</th>
              {/* Tax Nr */}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Tax Nr</th>
              {/* Sources — filterable */}
              <th className="px-3 py-2 font-medium hidden sm:table-cell whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col gap-0.5">
                  <span className={filterSources ? 'text-teal-700' : ''}>Sources</span>
                  <select
                    className="text-xs font-normal border border-navy-200 rounded px-1 py-0.5 bg-white text-navy-700 focus:outline-none focus:border-teal-400 cursor-pointer"
                    value={filterSources}
                    onChange={(e) => { setFilterSources(e.target.value); setSelectedIds(new Set()); }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    {sourcesOptions.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s as SourceType] ?? s}</option>)}
                  </select>
                </div>
              </th>
              {/* Merged status — filterable */}
              <th className="px-3 py-2 font-medium whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col gap-0.5">
                  <span className={filterStatus ? 'text-teal-700' : ''}>Status</span>
                  <select
                    className="text-xs font-normal border border-navy-200 rounded px-1 py-0.5 bg-white text-navy-700 focus:outline-none focus:border-teal-400 cursor-pointer"
                    value={filterStatus}
                    onChange={(e) => { setFilterStatus(e.target.value); setSelectedIds(new Set()); }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">All</option>
                    {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </th>
              {/* Accountant */}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Accountant</th>
              {/* Validation status */}
              <th className="px-3 py-2 font-medium whitespace-nowrap">Valid.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {filtered.map((c) => {
              const errorIssues = c.validation.issues.filter((i) => i.severity === 'error');
              const warnIssues  = c.validation.issues.filter((i) => i.severity === 'warning');
              const isOpen = editing === c.id;
              const clusterEdits = editsByCluster[c.id] ?? [];
              const isModified = clusterEdits.length > 0;
              const localId = (c.merged as Record<string, unknown>)._cluster_id as string | undefined;
              const rowMatch = localId ? pendingMatchByLocalId.get(localId) : undefined;
              const matchExpanded = expandedMatchId === c.id;
              return (
                <tr
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  className={`cursor-pointer select-none transition-colors ${c.archived ? 'opacity-60' : ''} ${selectedIds.has(c.id) ? 'bg-teal-50' : isOpen ? 'bg-teal-50 hover:bg-teal-50' : 'hover:bg-navy-50'}`}
                  onClick={() => setEditing(isOpen ? null : c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(isOpen ? null : c.id); } }}
                >
                  <td className="pl-3 pr-1 py-2.5 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedIds.has(c.id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.id); else next.delete(c.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  {/* Client Name */}
                  <td className="px-3 py-2.5 max-w-[180px] truncate text-navy-800 font-medium">
                    {String(c.merged.client_name ?? '—')}
                  </td>
                  {/* Entity Type */}
                  <td className="px-3 py-2.5 text-navy-700">
                    {String(c.merged.entity_type ?? '—')}
                  </td>
                  {/* Registration Nr */}
                  <td className="px-3 py-2.5 text-navy-600 text-xs">
                    {String(c.merged.registration_nr ?? '—')}
                  </td>
                  {/* Tax Nr */}
                  <td className="px-3 py-2.5 text-navy-600 text-xs">
                    {String(c.merged.tax_nr ?? '—')}
                  </td>
                  {/* Sources */}
                  <td className="px-3 py-2.5 text-xs text-navy-500 hidden sm:table-cell">
                    {c.sources.map((s) => SOURCE_LABELS[s as SourceType] ?? s).join(', ')}
                  </td>
                  {/* Merged status */}
                  <td className="px-3 py-2.5 text-xs text-navy-600">
                    {String(c.merged.status ?? '—')}
                  </td>
                  {/* Accountant */}
                  <td className="px-3 py-2.5 text-xs text-navy-600 max-w-[140px] truncate">
                    {String((c.merged as Record<string, unknown>).accountant ?? '—')}
                  </td>
                  {/* Validation status */}
                  <td className="px-3 py-2.5" onClick={(e) => { if (rowMatch) e.stopPropagation(); }}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {errorIssues.map((issue, i) => (
                        <ErrorBadge key={i} field={issue.field} />
                      ))}
                      {warnIssues.length > 0 && errorIssues.length === 0 && (
                        <span className="badge badge-warn text-[10px]">{warnIssues.length} warn</span>
                      )}
                      {errorIssues.length === 0 && warnIssues.length === 0 && !c.archived && (
                        <span className="badge badge-ok">OK</span>
                      )}
                      {c.archived && <span className="badge badge-muted">Archived</span>}
                      {isModified && <ModifiedMarker edits={clusterEdits} />}
                      {rowMatch && (
                        <button
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors"
                          onClick={(e) => { e.stopPropagation(); setExpandedMatchId(matchExpanded ? null : c.id); }}
                          title={`Possible match with "${rowMatch.candidateName}"`}
                        >
                          ↔ Match
                        </button>
                      )}
                      <span className="text-navy-300 text-xs ml-0.5" title="Click row to edit">✎</span>
                    </div>
                    {/* Inline match card */}
                    {rowMatch && matchExpanded && (
                      <div
                        className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-amber-800 font-medium">
                          Possible duplicate of <span className="italic">&ldquo;{rowMatch.candidateName}&rdquo;</span>
                          <span className="ml-1 text-amber-600">({Math.round(rowMatch.score * 100)}% match)</span>
                        </p>
                        {rowMatch.signals.length > 0 && (
                          <p className="text-amber-600">Signals: {rowMatch.signals.join(', ')}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            disabled={dedupSaving}
                            onClick={() => { void acceptDedupMatch(rowMatch); setExpandedMatchId(null); }}
                            className="flex-1 btn bg-teal text-white text-xs py-1 disabled:opacity-50"
                          >
                            {dedupSaving ? '…' : '✓ Merge'}
                          </button>
                          <button
                            disabled={dedupSaving}
                            onClick={() => { void rejectDedupMatch(rowMatch); setExpandedMatchId(null); }}
                            className="flex-1 btn border border-amber-300 bg-white text-amber-900 text-xs py-1 disabled:opacity-50"
                          >
                            ✕ Keep separate
                          </button>
                        </div>
                      </div>
                    )}
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
                {target.archived && target.archive_reason && (() => {
                  const localId = (target.merged as Record<string, unknown>)._cluster_id as string | undefined;
                  const dedupMatch = localId
                    ? pendingMatches.find((m) => m.orphanClusterId === localId)
                    : undefined;
                  return (
                    <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl space-y-3">
                      <p><strong>Archived:</strong> {target.archive_reason}</p>
                      {dedupMatch && (
                        <div className="flex gap-2 pt-1">
                          <button
                            disabled={dedupSaving}
                            onClick={() => void acceptDedupMatch(dedupMatch)}
                            className="flex-1 btn bg-teal text-white hover:bg-teal-700 text-sm py-1.5 disabled:opacity-50"
                          >
                            {dedupSaving ? 'Saving…' : `✓ Yes, merge with "${dedupMatch.candidateName}"`}
                          </button>
                          <button
                            disabled={dedupSaving}
                            onClick={() => void rejectDedupMatch(dedupMatch)}
                            className="flex-1 btn border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 text-sm py-1.5 disabled:opacity-50"
                          >
                            ✕ Keep separate
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

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
