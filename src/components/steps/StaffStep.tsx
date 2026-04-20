'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

// The eight staff-assignment columns in the DataGrows template (AA–AH).
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

interface StaffMember {
  id: string;
  name: string;
  roles: string[];
  created_at: string;
}

export function StaffStep({ firmId, onContinue }: { firmId: string; onContinue?: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-form state
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRoles, setEditRoles] = useState<string[]>([]);

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

  useEffect(() => { load(); }, [load]);

  function toggleRole(role: string) {
    setNewRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleAdd(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('firm_staff').insert({
      firm_id: firmId,
      name: newName.trim(),
      roles: newRoles,
    });
    if (err) {
      setError(err.message);
    } else {
      setNewName('');
      setNewRoles([]);
      await load();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await supabase.from('firm_staff').delete().eq('id', id);
    setStaff((prev) => prev.filter((s) => s.id !== id));
  }

  function startEdit(s: StaffMember) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditRoles([...s.roles]);
  }

  function toggleEditRole(role: string) {
    setEditRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    await supabase.from('firm_staff').update({ name: editName.trim(), roles: editRoles }).eq('id', editingId);
    setStaff((prev) => prev.map((s) => s.id === editingId ? { ...s, name: editName.trim(), roles: editRoles } : s));
    setEditingId(null);
    setSaving(false);
  }

  if (loading) return <p className="text-navy-500">Loading staff…</p>;

  return (
    <div className="space-y-6">
      {/* ── Page heading ── */}
      <div className="pb-1 border-b border-navy-100">
        <h2 className="text-xl font-semibold text-navy-800">Firm Staff</h2>
        <p className="text-sm text-navy-400 mt-0.5">
          Add every person who will be assigned to clients. Their names appear in the
          Partner / Manager / Accountant / Role dropdowns during Review and in the DataGrows export.
        </p>
      </div>

      {/* ── Staff list ── */}
      {staff.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">DataGrows Roles</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {staff.map((s) => (
                editingId === s.id ? (
                  <tr key={s.id} className="bg-teal-50">
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        className="input text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {STAFF_ROLES.map((role) => (
                          <label key={role} className="flex items-center gap-1.5 text-xs text-navy-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editRoles.includes(role)}
                              onChange={() => toggleEditRole(role)}
                              className="accent-teal"
                            />
                            {role}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button onClick={saveEdit} disabled={saving} className="btn btn-primary text-xs py-1 px-3">
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn btn-ghost text-xs py-1 px-3">
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="hover:bg-navy-50">
                    <td className="px-4 py-3 font-medium text-navy-800">{s.name}</td>
                    <td className="px-4 py-3">
                      {s.roles.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {s.roles.map((r) => (
                            <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 border border-teal-200">{r}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs italic">No roles assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => startEdit(s)} className="text-xs text-teal hover:text-teal-700 transition-colors font-medium">Edit</button>
                        <button onClick={() => handleDelete(s.id)} className="text-xs text-rose-500 hover:text-rose-700 transition-colors">Remove</button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-8 text-center space-y-2">
          <p className="text-navy-400 text-sm font-medium">No staff added yet</p>
          <p className="text-navy-300 text-xs">Use the form below to add your first staff member.</p>
        </div>
      )}

      {/* ── Add form ── */}
      <form onSubmit={handleAdd} className="card p-5 space-y-4">
        <h4 className="text-sm font-semibold text-navy-700">Add Staff Member</h4>

        <div>
          <label className="block text-xs font-medium text-navy-600 mb-1">Name *</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Jane Smith"
            className="input"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-navy-600 mb-2">DataGrows Roles <span className="text-navy-300 font-normal">(can be assigned to any client)</span></label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAFF_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer px-3 py-2 rounded-lg border border-navy-100 hover:border-teal hover:bg-teal-50 transition-colors">
                <input
                  type="checkbox"
                  checked={newRoles.includes(role)}
                  onChange={() => toggleRole(role)}
                  className="accent-teal"
                />
                {role}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="btn btn-primary"
          >
            {saving ? 'Adding…' : 'Add Staff Member'}
          </button>
        </div>
      </form>

      {/* ── Continue ── */}
      {onContinue && (
        <div className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-navy-500">
            {staff.length > 0
              ? <><span className="font-medium text-navy-800">{staff.length}</span> staff member{staff.length !== 1 ? 's' : ''} added — ready to review clients.</>
              : <span className="text-amber-600">Add at least one staff member before reviewing clients.</span>
            }
          </p>
          <button onClick={onContinue} className="btn btn-primary text-sm">
            Continue to Review →
          </button>
        </div>
      )}
    </div>
  );
}
