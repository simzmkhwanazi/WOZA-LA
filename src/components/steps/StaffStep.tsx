'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as XLSX from 'xlsx';

const STAFF_ROLES = [
  'Partner',
  'Manager',
  'Accountant',
  'Accounting Role',
  'CIPC Role',
  'Financials Role',
  'HR Role',
  'Tax Role',
] as const;

type StaffRole = typeof STAFF_ROLES[number];

interface StaffMember {
  id: string;
  name: string;
  roles: string[];
  created_at: string;
}

type UploadSource = 'emp' | 'roles';

interface ParsedEmployee {
  name: string;
  roles: StaffRole[];
  source?: UploadSource;
}

const ROLE_MAP: Record<string, StaffRole> = {
  partner:           'Partner',
  manager:           'Manager',
  accountant:        'Accountant',
  'accounting role': 'Accounting Role',
  accounting:        'Accounting Role',
  cipc:              'CIPC Role',
  financials:        'Financials Role',
  financial:         'Financials Role',
  hr:                'HR Role',
  payroll:           'HR Role',
  tax:               'Tax Role',
};

function detectRole(raw: string): StaffRole | null {
  const lower = raw.toLowerCase().trim();
  for (const [key, role] of Object.entries(ROLE_MAP)) {
    if (lower.includes(key)) return role;
  }
  return null;
}

function parseSheet(file: File): Promise<ParsedEmployee[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

        // Find header row: first row with >= 3 non-null cells (skips title/subtitle rows)
        let hdrIdx = -1;
        for (let i = 0; i < Math.min(raw.length, 15); i++) {
          const row = raw[i] as unknown[];
          if (row.filter((c) => c !== null && c !== '').length >= 3) { hdrIdx = i; break; }
        }
        if (hdrIdx === -1) { resolve([]); return; }

        const headers = (raw[hdrIdx] as unknown[]).map((h) => h ? String(h).trim() : '');
        const nameKeys = ['Name', 'Full Name', 'Employee Name', 'Staff Name', 'Display Name', 'Employee', 'Person', 'FirstName', 'First Name'];
        const roleTextKeys = ['Role', 'Position', 'Job Title', 'Title', 'DataGrows Role', 'DG Role'];

        // Find name column
        const nameIdx = nameKeys.map((k) => headers.indexOf(k)).find((i) => i >= 0)
          ?? headers.findIndex((h) => h.toLowerCase().includes('name'));

        // Detect columnar role format: headers that exactly match a known StaffRole
        const roleColIndices: { idx: number; role: StaffRole }[] = [];
        headers.forEach((h, i) => {
          if (i === nameIdx) return;
          const match = STAFF_ROLES.find((r) => r.toLowerCase() === h.toLowerCase());
          if (match) roleColIndices.push({ idx: i, role: match });
        });
        const isColumnar = roleColIndices.length > 0;

        // Find text role column (used when not columnar)
        const roleTextIdx = isColumnar ? -1
          : (roleTextKeys.map((k) => headers.indexOf(k)).find((i) => i >= 0) ?? -1);

        const results: ParsedEmployee[] = [];
        for (let i = hdrIdx + 1; i < raw.length; i++) {
          const row = raw[i] as unknown[];
          if (!row) continue;
          const name = nameIdx >= 0 && row[nameIdx] ? String(row[nameIdx]).trim() : '';
          if (!name || name.length < 2) continue;

          const roles: StaffRole[] = [];
          if (isColumnar) {
            for (const { idx, role } of roleColIndices) {
              if (row[idx] && String(row[idx]).trim().toLowerCase() === 'yes') roles.push(role);
            }
          } else if (roleTextIdx >= 0 && row[roleTextIdx]) {
            const r = detectRole(String(row[roleTextIdx]));
            if (r) roles.push(r);
          }

          results.push({ name, roles });
        }
        resolve(results);
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function StaffStep({ firmId, onContinue }: { firmId: string; onContinue?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Parsed-but-not-yet-saved employees from file uploads (feeds the dropdown)
  const [parsedPool, setParsedPool] = useState<ParsedEmployee[]>([]);
  const [loadedFiles, setLoadedFiles] = useState<Record<UploadSource, string | null>>({ emp: null, roles: null });
  const [loadedTimes, setLoadedTimes] = useState<Record<UploadSource, Date | null>>({ emp: null, roles: null });
  const [loadedCounts, setLoadedCounts] = useState<Record<UploadSource, number>>({ emp: 0, roles: 0 });
  const [uploadErrors, setUploadErrors] = useState<Record<UploadSource, string | null>>({ emp: null, roles: null });
  const [uploading, setUploading] = useState<UploadSource | null>(null);
  const [viewingSource, setViewingSource] = useState<UploadSource | null>(null);
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set());
  const empInputRef   = useRef<HTMLInputElement>(null);
  const rolesInputRef = useRef<HTMLInputElement>(null);

  // Add-form state
  const [newName, setNewName]   = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName]   = useState('');
  const [editRoles, setEditRoles] = useState<string[]>([]);

  // Staff table bulk selection
  const [staffSelected, setStaffSelected] = useState<Set<string>>(new Set());

  // Staff list collapse
  const [staffListOpen, setStaffListOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('firm_staff')
      .select('id, name, roles, created_at')
      .eq('firm_id', firmId)
      .order('name');
    setStaff((data as StaffMember[]) ?? []);
    setLoading(false);
  }, [firmId, supabase]);

  useEffect(() => { void load(); }, [load]);

  // ── File upload — replace source's entries in pool ───────────────────────
  async function handleFileUpload(file: File, source: UploadSource) {
    setUploading(source);
    setUploadErrors((prev) => ({ ...prev, [source]: null }));
    try {
      const parsed = await parseSheet(file);
      if (!parsed.length) {
        setUploadErrors((prev) => ({ ...prev, [source]: 'No names found in file.' }));
        return;
      }
      // Replace this source's entries (so re-upload reflects the new file)
      setParsedPool((prev) => [
        ...prev.filter((p) => p.source !== source),
        ...parsed.map((p) => ({ ...p, source })),
      ]);
      setLoadedFiles((prev) => ({ ...prev, [source]: file.name }));
      setLoadedTimes((prev) => ({ ...prev, [source]: new Date() }));
      setLoadedCounts((prev) => ({ ...prev, [source]: parsed.length }));
    } catch (err) {
      setUploadErrors((prev) => ({ ...prev, [source]: `Error: ${err instanceof Error ? err.message : 'Unknown'}` }));
    } finally {
      setUploading(null);
    }
  }

  function clearSource(source: UploadSource) {
    setParsedPool((prev) => prev.filter((p) => p.source !== source));
    setLoadedFiles((prev) => ({ ...prev, [source]: null }));
    setLoadedTimes((prev) => ({ ...prev, [source]: null }));
    setLoadedCounts((prev) => ({ ...prev, [source]: 0 }));
    setUploadErrors((prev) => ({ ...prev, [source]: null }));
  }

  const savedNames = useMemo(() => new Set(staff.map((s) => s.name.toLowerCase())), [staff]);
  // Show full pool always — duplicate check happens on add
  const dropdownOptions = parsedPool;

  // When user picks from dropdown — pre-fill name + roles (editable before saving)
  function handleDropdownPick(name: string) {
    if (!name) { setNewName(''); setNewRoles([]); return; }
    const emp = parsedPool.find((p) => p.name === name);
    setNewName(name);
    setNewRoles(emp?.roles ?? []);
  }

  // ── Add (manual or from dropdown) ─────────────────────────────────────────
  async function handleAdd(e: { preventDefault(): void }) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (savedNames.has(name.toLowerCase())) {
      setFormError(`${name} is already in the staff list.`);
      return;
    }
    setSaving(true);
    setFormError(null);
    const { error: err } = await supabase.from('firm_staff').insert({ firm_id: firmId, name, roles: newRoles });
    if (err) { setFormError(err.message); }
    else { setNewName(''); setNewRoles([]); await load(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await supabase.from('firm_staff').delete().eq('id', id);
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setStaffSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function handleDeleteSelected() {
    setSaving(true);
    await Promise.all(Array.from(staffSelected).map((id) => supabase.from('firm_staff').delete().eq('id', id)));
    setStaff((prev) => prev.filter((s) => !staffSelected.has(s.id)));
    setStaffSelected(new Set());
    setSaving(false);
  }

  function startEdit(s: StaffMember) { setEditingId(s.id); setEditName(s.name); setEditRoles([...s.roles]); }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    await supabase.from('firm_staff').update({ name: editName.trim(), roles: editRoles }).eq('id', editingId);
    setStaff((prev) => prev.map((s) => s.id === editingId ? { ...s, name: editName.trim(), roles: editRoles } : s));
    setEditingId(null);
    setSaving(false);
  }

  if (loading) return <p className="text-navy-500 text-sm">Loading staff…</p>;

  return (
    <div className="space-y-6">
      {/* ── Heading ── */}
      <div className="pb-3 border-b border-navy-100">
        <h2 className="text-xl font-semibold text-navy-800">Firm Staff</h2>
        <p className="text-sm text-navy-400 mt-0.5">
          Add every person who will be assigned to clients. Their names appear in the
          Partner / Manager / Accountant / Role dropdowns during Review and in the DataGrows export.
        </p>
      </div>

      {/* Hidden file inputs — triggered from the Uploaded Documents section */}
      <input ref={empInputRef}   type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f, 'emp');   e.target.value = ''; }} />
      <input ref={rolesInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f, 'roles'); e.target.value = ''; }} />

      {/* ── Uploaded documents — always visible ── */}
      {(() => {
        const SOURCE_META: Record<UploadSource, { icon: string; label: string; ref: React.RefObject<HTMLInputElement | null> }> = {
          emp:   { icon: '🧑‍💼', label: 'Employee List',  ref: empInputRef },
          roles: { icon: '📋',   label: 'Employee Roles', ref: rolesInputRef },
        };
        return (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-navy-500 uppercase tracking-wider">Uploaded Documents</h4>
            <div className="border border-navy-100 rounded-xl overflow-hidden divide-y divide-navy-100">
              {(['emp', 'roles'] as UploadSource[]).map((src) => {
                const { icon, label, ref } = SOURCE_META[src];
                const loaded = !!loadedFiles[src];
                const time = loadedTimes[src];
                return (
                  <div key={src} className={`flex items-center gap-3 px-4 py-3 transition-colors ${loaded ? 'bg-white hover:bg-navy-50' : 'bg-navy-50'}`}>
                    <span className={`text-xl shrink-0 ${loaded ? '' : 'opacity-40'}`}>{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${loaded ? 'text-navy-700' : 'text-navy-400'}`}>{label}</p>
                      {loaded ? (
                        <>
                          <p className="text-xs text-navy-400 truncate">{loadedFiles[src]}</p>
                          {time && (
                            <p className="text-xs text-navy-300 mt-0.5">
                              Loaded {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {loadedCounts[src]} entries
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-navy-300">No file uploaded yet</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {loaded && (
                        <>
                          <button
                            type="button"
                            className="text-xs font-medium text-navy-500 border border-navy-200 bg-white hover:bg-navy-50 px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => { setModalSelected(new Set()); setViewingSource(src); }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-teal-700 border border-teal-300 bg-white hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => setViewingSource(src)}
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-teal-700 border border-teal-300 bg-white hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => {
                              const addable = parsedPool.filter((p) => p.source === src && !savedNames.has(p.name.toLowerCase()));
                              setModalSelected(new Set(addable.map((p) => p.name)));
                              setViewingSource(src);
                            }}
                          >
                            Add All
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-rose-600 border border-rose-200 bg-white hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => clearSource(src)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-teal-700 border border-teal-300 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors"
                            onClick={() => ref.current?.click()}
                          >
                            Replace
                          </button>
                        </>
                      )}
                      {!loaded && (
                        <button
                          type="button"
                          className="text-xs font-medium text-navy-400 border border-navy-200 bg-white hover:bg-navy-50 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => ref.current?.click()}
                        >
                          Upload
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Empty state — no files and no saved staff ── */}
      {!loadedFiles.emp && !loadedFiles.roles && staff.length === 0 && (
        <div className="card p-10 text-center space-y-2">
          <div className="text-3xl">🧑‍💼</div>
          <p className="text-navy-600 font-medium text-sm">No staff yet</p>
          <p className="text-navy-300 text-xs max-w-xs mx-auto">
            Upload an Employee List or Employee Roles file above to get started, or add staff manually below.
          </p>
        </div>
      )}

      {/* ── Staff list ── */}
      {(loadedFiles.emp || loadedFiles.roles || staff.length > 0) && staff.length > 0 ? (
        <div className="card overflow-hidden">
          {/* Collapse header */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 bg-navy-50 border-b border-navy-100 hover:bg-navy-100 transition-colors"
            onClick={() => setStaffListOpen((o) => !o)}
          >
            <span className="text-sm font-semibold text-navy-700">
              Staff List ({staff.length})
            </span>
            <span className="text-navy-400 text-xs">{staffListOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>

          {staffListOpen && <>
          {/* Bulk action bar */}
          {staffSelected.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-rose-50 border-b border-rose-200">
              <span className="text-sm text-rose-700 font-medium">
                {staffSelected.size} staff member{staffSelected.size !== 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-navy-500 hover:text-navy-700 underline"
                  onClick={() => setStaffSelected(new Set())}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  onClick={() => void handleDeleteSelected()}
                >
                  {saving ? 'Deleting…' : `Delete ${staffSelected.size} selected`}
                </button>
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                <th className="pl-3 pr-1 py-3 w-8">
                  <input
                    type="checkbox"
                    className="rounded accent-teal"
                    checked={staff.length > 0 && staff.every((s) => staffSelected.has(s.id))}
                    onChange={(e) => setStaffSelected(e.target.checked ? new Set(staff.map((s) => s.id)) : new Set())}
                    title="Select all"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">DataGrows Roles</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {staff.map((s) =>
                editingId === s.id ? (
                  <tr key={s.id} className="bg-teal-50">
                    <td className="pl-3 pr-1 py-3" />
                    <td className="px-4 py-3">
                      <input
                        autoFocus
                        type="text"
                        className="input text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {STAFF_ROLES.map((role) => (
                          <label key={role} className="flex items-center gap-1.5 text-xs text-navy-700 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={editRoles.includes(role)}
                              onChange={() =>
                                setEditRoles((prev) =>
                                  prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
                                )
                              }
                              className="accent-teal"
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => void saveEdit()} disabled={saving} className="btn btn-primary text-xs py-1 px-3">
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn btn-ghost text-xs py-1 px-3">Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className={`group transition-colors ${staffSelected.has(s.id) ? 'bg-rose-50' : 'hover:bg-navy-50'}`}>
                    <td className="pl-3 pr-1 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded accent-teal"
                        checked={staffSelected.has(s.id)}
                        onChange={(e) => setStaffSelected((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(s.id) : next.delete(s.id);
                          return next;
                        })}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-navy-800">{s.name}</td>
                    <td className="px-4 py-3">
                      {s.roles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {s.roles.map((r) => (
                            <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 border border-teal-200">
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-navy-300 text-xs italic">No roles — click Edit</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-3 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEdit(s)} className="text-xs text-teal hover:text-teal-700 font-medium">Edit</button>
                        <button onClick={() => void handleDelete(s.id)} className="text-xs text-rose-500 hover:text-rose-700">Remove</button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          </>}
        </div>
      ) : (loadedFiles.emp || loadedFiles.roles || staff.length > 0) ? (
        <div className="card p-8 text-center space-y-1">
          <p className="text-navy-500 text-sm font-medium">No staff added yet</p>
          <p className="text-navy-300 text-xs">Pick from the uploaded list below or add manually.</p>
        </div>
      ) : null}

      {/* ── Add Staff Member form ── */}
      <form onSubmit={(e) => void handleAdd(e)} className="card p-5 space-y-5">
        <h4 className="text-sm font-semibold text-navy-700">Add Staff Member</h4>

        {/* Name — dropdown always visible + manual text */}
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Pick from uploaded list</label>
            <select
              className="input"
              value={dropdownOptions.find((o) => o.name === newName) ? newName : ''}
              onChange={(e) => handleDropdownPick(e.target.value)}
              disabled={dropdownOptions.length === 0}
            >
              <option value="">
                {dropdownOptions.length === 0 ? '— upload a file above to populate —' : '— select a name —'}
              </option>
              {dropdownOptions.map((emp) => (
                <option key={emp.name} value={emp.name}>
                  {emp.name}{emp.roles.length > 0 ? ` · ${emp.roles.join(', ')}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-navy-600 mb-1">Or type a name manually</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Jane Smith"
              className="input"
              required
            />
          </div>
        </div>

        {/* Roles — editable regardless of source */}
        <div>
          <label className="block text-xs font-medium text-navy-600 mb-1">
            DataGrows Roles{' '}
            <span className="text-navy-300 font-normal">(can be assigned to any client)</span>
            {newName && newRoles.length === 0 && (
              <span className="text-amber-500 ml-1">— no role detected, select below</span>
            )}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAFF_ROLES.map((role) => (
              <label
                key={role}
                className={`flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg border transition-colors select-none ${
                  newRoles.includes(role)
                    ? 'border-teal bg-teal-50 text-teal-800 font-medium'
                    : 'border-navy-100 text-navy-700 hover:border-teal hover:bg-teal-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={newRoles.includes(role)}
                  onChange={() =>
                    setNewRoles((prev) =>
                      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
                    )
                  }
                  className="accent-teal"
                />
                {role}
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="text-sm text-rose-600">{formError}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving || !newName.trim()} className="btn btn-primary">
            {saving ? 'Adding…' : 'Add Staff Member'}
          </button>
        </div>
      </form>

      {/* ── View document modal ── */}
      {viewingSource && (() => {
        const entries = parsedPool.filter((p) => p.source === viewingSource);
        const labels: Record<UploadSource, string> = { emp: 'Employee List', roles: 'Employee Roles' };
        const addable = entries.filter((e) => !savedNames.has(e.name.toLowerCase()));
        const addedCount = entries.length - addable.length;
        const allAddableSelected = addable.length > 0 && addable.every((e) => modalSelected.has(e.name));
        const selectedAddable = addable.filter((e) => modalSelected.has(e.name));

        function toggleAll() {
          if (allAddableSelected) {
            setModalSelected(new Set());
          } else {
            setModalSelected(new Set(addable.map((e) => e.name)));
          }
        }

        function toggleOne(name: string) {
          setModalSelected((prev) => {
            const next = new Set(prev);
            next.has(name) ? next.delete(name) : next.add(name);
            return next;
          });
        }

        async function addSelected() {
          setSaving(true);
          await Promise.all(
            selectedAddable.map((e) =>
              supabase.from('firm_staff').insert({ firm_id: firmId, name: e.name, roles: e.roles })
            )
          );
          setModalSelected(new Set());
          await load();
          setSaving(false);
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setViewingSource(null); setModalSelected(new Set()); }} />
            <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-navy-100">
                <div>
                  <h3 className="text-base font-semibold text-navy-800">{labels[viewingSource]}</h3>
                  <p className="text-xs text-navy-400 mt-0.5">
                    {loadedFiles[viewingSource]} · {entries.length} entries · {addedCount} already added
                  </p>
                </div>
                <button onClick={() => { setViewingSource(null); setModalSelected(new Set()); }} className="btn btn-ghost text-sm">Close ✕</button>
              </div>

              {/* Table */}
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-sm">
                  <thead className="bg-navy-50 sticky top-0 z-10">
                    <tr>
                      <th className="pl-4 pr-2 py-2.5 w-8">
                        <input
                          type="checkbox"
                          className="rounded accent-teal"
                          checked={allAddableSelected}
                          disabled={addable.length === 0}
                          onChange={toggleAll}
                          title="Select all not yet added"
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium text-navy-600">Name</th>
                      <th className="px-3 py-2.5 text-left font-medium text-navy-600">Detected Roles</th>
                      <th className="px-3 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {entries.map((e) => {
                      const isAdded = savedNames.has(e.name.toLowerCase());
                      const isSelected = modalSelected.has(e.name);
                      return (
                        <tr
                          key={e.name}
                          className={`transition-colors ${isAdded ? 'opacity-50' : isSelected ? 'bg-teal-50' : 'hover:bg-navy-50'}`}
                          onClick={() => { if (!isAdded) toggleOne(e.name); }}
                          style={{ cursor: isAdded ? 'default' : 'pointer' }}
                        >
                          <td className="pl-4 pr-2 py-2.5" onClick={(ev) => ev.stopPropagation()}>
                            {isAdded ? (
                              <span className="text-teal-500 text-base">✓</span>
                            ) : (
                              <input
                                type="checkbox"
                                className="rounded accent-teal"
                                checked={isSelected}
                                onChange={() => toggleOne(e.name)}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-navy-800">{e.name}</td>
                          <td className="px-3 py-2.5">
                            {e.roles.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {e.roles.map((r) => (
                                  <span key={r} className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 border border-teal-200">{r}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-navy-300 text-xs italic">No role detected</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {isAdded && <span className="text-xs text-teal-600 font-medium">Added</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer action bar */}
              <div className="px-5 py-3 border-t border-navy-100 bg-navy-50 flex items-center justify-between gap-3">
                <p className="text-xs text-navy-500">
                  {selectedAddable.length > 0
                    ? <><span className="font-semibold text-teal-700">{selectedAddable.length}</span> selected</>
                    : 'Click rows to select staff to add'}
                </p>
                <div className="flex gap-2">
                  {addable.length > 0 && (
                    <button
                      type="button"
                      disabled={saving}
                      className="btn btn-ghost text-xs border border-navy-200"
                      onClick={async () => {
                        setSaving(true);
                        await Promise.all(addable.map((e) =>
                          supabase.from('firm_staff').insert({ firm_id: firmId, name: e.name, roles: e.roles })
                        ));
                        setModalSelected(new Set());
                        await load();
                        setSaving(false);
                      }}
                    >
                      {saving ? 'Adding…' : `Add all ${addable.length}`}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving || selectedAddable.length === 0}
                    className="btn btn-primary text-sm disabled:opacity-40"
                    onClick={() => void addSelected()}
                  >
                    {saving ? 'Adding…' : `Add ${selectedAddable.length > 0 ? selectedAddable.length : ''} selected`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Continue ── */}
      {onContinue && (
        <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-navy-500">
            {staff.length > 0 ? (
              <><span className="font-medium text-navy-800">{staff.length}</span> staff member{staff.length !== 1 ? 's' : ''} added — ready to review clients.</>
            ) : (
              <span className="text-amber-600">Add at least one staff member before reviewing clients.</span>
            )}
          </p>
          <button onClick={onContinue} className="btn btn-primary text-sm">Continue to Review →</button>
        </div>
      )}
    </div>
  );
}
