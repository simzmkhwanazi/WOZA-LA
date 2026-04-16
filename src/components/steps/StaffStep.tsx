'use client';

import { useState, useEffect, useCallback } from 'react';
import { getStaff, addStaff, deleteStaff, type StaffMember } from '@/lib/actions/db';

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

export function StaffStep({ firmId }: { firmId: string }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-form state
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setStaff(await getStaff(firmId));
    setLoading(false);
  }, [firmId]);

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
    const { error: err } = await addStaff({ firmId, name: newName.trim(), roles: newRoles });
    if (err) {
      setError(err);
    } else {
      setNewName('');
      setNewRoles([]);
      await load();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await deleteStaff(id);
    setStaff((prev) => prev.filter((s) => s.id !== id));
  }

  if (loading) return <p className="text-navy-500">Loading staff…</p>;

  return (
    <div className="space-y-6 max-w-2xl">
      <p className="text-sm text-navy-500">
        Staff listed here populate the Partner / Manager / Accountant / Role dropdowns in the
        DataGrows export template. Add everyone who will be assigned to end-clients for this firm.
      </p>

      {/* ── Current staff ── */}
      {staff.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Roles</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {staff.map((s) => (
                <tr key={s.id} className="hover:bg-navy-50">
                  <td className="px-4 py-2 font-medium text-navy-800">{s.name}</td>
                  <td className="px-4 py-2 text-navy-500">
                    {s.roles.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.roles.map((r) => (
                          <span key={r} className="badge badge-ok">{r}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">No roles</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-xs text-rose-500 hover:text-rose-700 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-6 text-center text-navy-400 text-sm">
          No staff added yet.
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
          <label className="block text-xs font-medium text-navy-600 mb-2">Roles</label>
          <div className="grid grid-cols-2 gap-2">
            {STAFF_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
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
    </div>
  );
}
