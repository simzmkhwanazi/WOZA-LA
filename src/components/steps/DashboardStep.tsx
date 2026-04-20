'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { validateRecord } from '@/lib/validator';
import type { ClientRecord } from '@/lib/schema/datagrows';
import { DATAGROWS_FIELDS } from '@/lib/schema/datagrows';
import type { FirmTab } from '@/components/FirmDataSlideOver';

// ── Colour palettes ───────────────────────────────────────────────────────────
const TEAL_PALETTE = ['#0d9488','#14b8a6','#2dd4bf','#5eead4','#99f6e4','#0f766e','#0e7490','#155e75'];
const STATUS_COLOURS: Record<string, string> = {
  'Active': '#10b981',
  'Inactive': '#94a3b8',
  'Dormant': '#f59e0b',
  'Pending': '#3b82f6',
  'Part of Ownership Structure': '#8b5cf6',
};

const SERVICE_KEYS = [
  { key: 'financials',       label: 'Financials' },
  { key: 'audit',            label: 'Audit' },
  { key: 'income_tax',       label: 'Income Tax' },
  { key: 'provisional_tax',  label: 'Provisional Tax' },
  { key: 'turnover_tax',     label: 'Turnover Tax' },
  { key: 'vat',              label: 'VAT' },
  { key: 'payroll',          label: 'Payroll' },
  { key: 'uif',              label: 'UIF' },
  { key: 'workmans',         label: "Workman's" },
  { key: 'cipc_annual_return', label: 'CIPC Annual Return' },
  { key: 'documents_folder', label: 'Documents Folder' },
];

const MONTHS_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[];
  archived: boolean;
  archive_reason: string | null;
  primary_key_value: string;
}

interface FirmProfile {
  id?: string;
  company_name: string;
  registration_nr: string;
  vat_nr: string;
  bbbee_level: string;
  industry_sector: string;
  auditor_name: string;
  contact_nr: string;
  email: string;
}

interface Employee {
  id: string;
  name: string;
  email: string;
  job_title: string;
  department: string;
  dg_roles: Record<string, number> | null;
  source: string;
}

interface Contact {
  id: string;
  name: string;
  organisation: string;
  email: string;
  phone: string;
  relationship: string;
}

// ── Client profile card (sticky freeze-pane panel) ───────────────────────────

function ClientProfileCard({
  cluster,
  onClose,
}: {
  cluster: ClusterRow;
  onClose: () => void;
}) {
  const m = cluster.merged as Record<string, unknown>;
  const services = SERVICE_KEYS.filter((s) => m[s.key] === true || m[s.key] === 'TRUE');
  const staffFields = DATAGROWS_FIELDS.filter((f) => f.type === 'staff');

  return (
    <div className="bg-white border-2 border-teal-300 rounded-xl shadow-md p-4">
      {/* ── Header row ── */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-navy-800 leading-tight">
            {String(m.client_name ?? '—')}
          </h3>
          <p className="text-xs text-navy-400 mt-0.5">
            {String(m.entity_type ?? '—')}
            {m.status ? ` · ${String(m.status)}` : ''}
            {m.year_end ? ` · Year end: ${String(m.year_end)}` : ''}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-navy-300 hover:text-navy-600 text-xl leading-none ml-4 flex-shrink-0"
          aria-label="Close"
        >×</button>
      </div>

      {/* ── Detail grid — 4 columns on wide, 2 on narrow ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        {/* Registration */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wider">Registration</p>
          <p className="text-xs"><span className="text-navy-400">Reg:</span> {String(m.registration_nr ?? '—')}</p>
          <p className="text-xs"><span className="text-navy-400">Tax:</span> {String(m.tax_nr ?? '—')}</p>
          <p className="text-xs"><span className="text-navy-400">VAT:</span> {String(m.vat_nr ?? '—')}</p>
        </div>

        {/* Contact */}
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wider">Contact</p>
          <p className="text-xs truncate"><span className="text-navy-400">Name:</span> {String(m.primary_contact ?? '—')}</p>
          <p className="text-xs"><span className="text-navy-400">Phone:</span> {String(m.contact_nr ?? '—')}</p>
          <p className="text-xs truncate"><span className="text-navy-400">Email:</span> {String(m.contact_email ?? '—')}</p>
        </div>

        {/* Services */}
        <div>
          <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wider mb-1">Services</p>
          {services.length === 0
            ? <p className="text-xs text-navy-400">None ticked</p>
            : <div className="flex flex-wrap gap-1">
                {services.map((s) => (
                  <span key={s.key} className="badge badge-ok text-[10px] px-1.5 py-0.5">{s.label}</span>
                ))}
              </div>
          }
        </div>

        {/* Staff & Sources */}
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-navy-400 uppercase tracking-wider">Staff</p>
          <div className="space-y-0.5">
            {staffFields.filter((f) => m[f.key]).slice(0, 4).map((f) => (
              <p key={f.key} className="text-xs truncate">
                <span className="text-navy-400">{f.header}:</span> {String(m[f.key])}
              </p>
            ))}
            {staffFields.filter((f) => m[f.key]).length === 0 && (
              <p className="text-xs text-navy-400">—</p>
            )}
          </div>
          <p className="text-[10px] text-navy-400 mt-1">
            Sources: {cluster.sources.join(', ') || '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Clients sub-tab ───────────────────────────────────────────────────────────

function ClientsTab({ clusters }: { clusters: ClusterRow[] }) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const active = clusters.filter((c) => !c.archived);

  // Chart data
  const entityData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of active) {
      const et = String((c.merged as Record<string, unknown>).entity_type ?? 'Unknown');
      counts[et] = (counts[et] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [active]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of active) {
      const st = String((c.merged as Record<string, unknown>).status ?? 'Unknown');
      counts[st] = (counts[st] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [active]);

  const yearEndData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of active) {
      const ye = String((c.merged as Record<string, unknown>).year_end ?? '');
      if (ye) counts[ye] = (counts[ye] ?? 0) + 1;
    }
    return MONTHS_ORDER.map((m) => ({ name: m.slice(0, 3), value: counts[m] ?? 0 }));
  }, [active]);

  const servicesData = useMemo(() => {
    return SERVICE_KEYS.map((s) => ({
      name: s.label,
      value: active.filter((c) => {
        const v = (c.merged as Record<string, unknown>)[s.key];
        return v === true || v === 'TRUE';
      }).length,
    })).sort((a, b) => b.value - a.value);
  }, [active]);

  // Filtered table
  const filtered = useMemo(() => {
    if (!search.trim()) return clusters;
    const q = search.toLowerCase();
    return clusters.filter((c) => {
      const m = c.merged as Record<string, unknown>;
      return (
        String(m.client_name ?? '').toLowerCase().includes(q) ||
        String(m.entity_type ?? '').toLowerCase().includes(q) ||
        String(m.registration_nr ?? '').toLowerCase().includes(q)
      );
    });
  }, [clusters, search]);

  const selected = clusters.find((c) => c.id === selectedId);

  return (
    <div className="space-y-5">
      {/* ── Sticky client detail panel ── */}
      {selected && (
        <div className="sticky top-0 z-20">
          <ClientProfileCard cluster={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Entity type donut */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-navy-600 uppercase tracking-wider mb-3">Entity Types</h4>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={entityData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={2}>
                {entityData.map((_, i) => <Cell key={i} fill={TEAL_PALETTE[i % TEAL_PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [v, name]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {entityData.slice(0, 6).map((d, i) => (
              <span key={d.name} className="text-xs text-navy-600 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: TEAL_PALETTE[i % TEAL_PALETTE.length] }} />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </div>

        {/* Client status bar */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-navy-600 uppercase tracking-wider mb-3">Client Status</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {statusData.map((d) => (
                  <Cell key={d.name} fill={STATUS_COLOURS[d.name] ?? '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Year-end distribution */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-navy-600 uppercase tracking-wider mb-3">Year-End Distribution</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={yearEndData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Services bar */}
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-navy-600 uppercase tracking-wider mb-3">Services Overview</h4>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={servicesData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={110} />
              <Tooltip />
              <Bar dataKey="value" fill="#14b8a6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Search + table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-navy-100 flex items-center gap-3">
          <input
            type="text"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input text-sm flex-1"
          />
          <span className="text-xs text-navy-400 flex-shrink-0">{filtered.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                <th className="px-3 py-2.5 font-medium">Client Name</th>
                <th className="px-3 py-2.5 font-medium">Entity Type</th>
                <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Status</th>
                <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Sources</th>
                <th className="px-3 py-2.5 font-medium">Services</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {filtered.map((c) => {
                const m = c.merged as Record<string, unknown>;
                const svcCount = SERVICE_KEYS.filter((s) => m[s.key] === true || m[s.key] === 'TRUE').length;
                const isOpen = selectedId === c.id;
                return (
                  <tr
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer transition-colors ${isOpen ? 'bg-teal-50' : 'hover:bg-navy-50'} ${c.archived ? 'opacity-50' : ''}`}
                    onClick={() => setSelectedId(isOpen ? null : c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(isOpen ? null : c.id); }}
                  >
                    <td className="px-3 py-2.5 font-medium text-navy-800 max-w-[200px] truncate">
                      {String(m.client_name ?? '—')}
                    </td>
                    <td className="px-3 py-2.5 text-navy-600 text-xs">{String(m.entity_type ?? '—')}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="text-xs">{String(m.status ?? '—')}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-navy-400 hidden sm:table-cell">{c.sources.join(', ')}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${svcCount === 0 ? 'text-amber-500' : 'text-teal-600'}`}>
                        {svcCount} service{svcCount !== 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Contacts sub-tab ──────────────────────────────────────────────────────────

function ContactsTab({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('firm_contacts').select('*').eq('session_id', sessionId).order('name');
    setContacts((data as Contact[]) ?? []);
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function addContact() {
    const { data } = await supabase
      .from('firm_contacts')
      .insert({ session_id: sessionId, name: 'New Contact' })
      .select('*').single();
    if (data) setContacts((prev) => [...prev, data as Contact]);
  }

  async function update(id: string, field: keyof Contact, value: string) {
    await supabase.from('firm_contacts').update({ [field]: value }).eq('id', id);
    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c));
  }

  async function remove(id: string) {
    await supabase.from('firm_contacts').delete().eq('id', id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) return <p className="text-xs text-navy-400 py-8 text-center">Loading contacts…</p>;

  return (
    <div className="space-y-3">
      {contacts.length === 0 && (
        <p className="text-xs text-navy-400 py-4 text-center">No contacts yet. Upload a contacts file or add manually.</p>
      )}
      <div className="card overflow-x-auto">
        {contacts.length > 0 && (
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                {['Name', 'Organisation', 'Email', 'Phone', 'Relationship', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {contacts.map((c) => (
                <tr key={c.id}>
                  {(['name', 'organisation', 'email', 'phone', 'relationship'] as const).map((field) => (
                    <td key={field} className="px-2 py-1.5">
                      <input
                        type="text"
                        className="input text-sm py-1"
                        value={c[field] ?? ''}
                        onChange={(e) => update(c.id, field, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <button onClick={() => remove(c.id)} className="text-rose-400 hover:text-rose-600 text-xs">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <button onClick={addContact} className="btn btn-secondary text-sm">+ Add Contact</button>
    </div>
  );
}

// ── Employees sub-tab (dashboard view) ───────────────────────────────────────

function EmployeesDashTab({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('firm_employees').select('*').eq('session_id', sessionId).order('name');
    setEmployees((data as Employee[]) ?? []);
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function rebuild() {
    setRebuilding(true);
    await fetch(`/api/dashboard/${sessionId}/build`, { method: 'POST' });
    await load();
    setRebuilding(false);
  }

  if (loading) return <p className="text-xs text-navy-400 py-8 text-center">Loading employees…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-navy-600">{employees.length} staff member{employees.length !== 1 ? 's' : ''}</p>
        <button onClick={rebuild} disabled={rebuilding} className="btn btn-secondary text-sm">
          {rebuilding ? 'Rebuilding…' : '↻ Re-consolidate'}
        </button>
      </div>
      {employees.length === 0 ? (
        <div className="card p-8 text-center text-navy-400 text-sm">
          No employees consolidated yet. Upload an employee list and click Re-consolidate.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-navy-50 text-left text-navy-700">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Title / Dept</th>
                <th className="px-3 py-2.5 font-medium">DG Responsibilities</th>
                <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {employees.map((e) => {
                const dgSummary = e.dg_roles
                  ? Object.entries(e.dg_roles)
                      .filter(([, count]) => count > 0)
                      .map(([role, count]) => `${role.replace(/_/g, ' ')}: ${count}`)
                      .join(' · ')
                  : '—';
                return (
                  <tr key={e.id} className="hover:bg-navy-50">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-navy-800">{e.name}</p>
                      <p className="text-xs text-navy-400">{e.email ?? ''}</p>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell text-xs text-navy-600">
                      {e.job_title ? <p>{e.job_title}</p> : null}
                      {e.department ? <p className="text-navy-400">{e.department}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-teal-700">{dgSummary}</td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="badge badge-muted text-xs">{e.source ?? '—'}</span>
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
}

// ── Company info summary (read-only, edit via slide-over) ─────────────────────

function CompanyInfoTab({ sessionId, onOpenSlideOver }: { sessionId: string; onOpenSlideOver: () => void }) {
  const supabase = createClient();
  const [profile, setProfile] = useState<FirmProfile | null>(null);

  useEffect(() => {
    supabase.from('firm_profile').select('*').eq('session_id', sessionId).maybeSingle()
      .then(({ data }) => setProfile(data as FirmProfile | null));
  }, [sessionId, supabase]);

  const fields: [keyof FirmProfile, string][] = [
    ['company_name', 'Company Name'], ['registration_nr', 'Registration Nr'],
    ['vat_nr', 'VAT Nr'], ['bbbee_level', 'B-BBEE Level'],
    ['industry_sector', 'Industry Sector'], ['auditor_name', 'Auditor'],
    ['contact_nr', 'Contact Nr'], ['email', 'Email'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-navy-500">Firm company details extracted from uploaded sources.</p>
        <button onClick={onOpenSlideOver} className="btn btn-secondary text-sm">Edit Company Info ↗</button>
      </div>
      <div className="card p-5">
        {!profile ? (
          <p className="text-sm text-navy-400 text-center py-4">
            No company profile yet. Upload a company details file and visit this tab again,
            or click Edit to enter details manually.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {fields.map(([key, label]) => (
              <div key={key}>
                <p className="text-xs text-navy-400 mb-0.5">{label}</p>
                <p className="font-medium text-navy-800">{String(profile[key] ?? '—') || '—'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main DashboardStep ────────────────────────────────────────────────────────

type DashTab = 'clients' | 'company' | 'employees' | 'contacts' | 'suppliers';

export function DashboardStep({
  sessionId,
  firmName,
  onOpenFirmSlideOver,
  onProceedToExport,
}: {
  sessionId: string;
  firmName: string;
  operatorName?: string | null;
  onOpenFirmSlideOver?: (tab: FirmTab) => void;
  onProceedToExport?: () => void;
}) {
  const supabase = createClient();
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [activeTab, setActiveTab] = useState<DashTab>('clients');

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('clusters')
      .select('id, merged, sources, archived, archive_reason, primary_key_value')
      .eq('session_id', sessionId);
    setClusters((data as ClusterRow[]) ?? []);
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  // Auto-build dashboard data on first visit
  useEffect(() => {
    async function autoBuild() {
      setBuilding(true);
      try {
        await fetch(`/api/dashboard/${sessionId}/build`, { method: 'POST' });
      } catch { /* non-blocking */ }
      setBuilding(false);
    }
    void autoBuild();
  }, [sessionId]);

  const tabs: { key: DashTab; label: string }[] = [
    { key: 'clients',   label: `Clients (${clusters.filter((c) => !c.archived).length})` },
    { key: 'company',   label: 'Company Info' },
    { key: 'employees', label: 'Employees' },
    { key: 'contacts',  label: 'Contacts' },
    { key: 'suppliers', label: 'Suppliers' },
  ];

  // Validation stats for the export card
  const stats = useMemo(() => {
    const active = clusters.filter((c) => !c.archived);
    let errors = 0; let warnings = 0; let ready = 0;
    for (const c of active) {
      const v = validateRecord(c.merged);
      if (v.issues.some((i) => i.severity === 'error')) errors++;
      else if (v.issues.some((i) => i.severity === 'warning')) warnings++;
      else ready++;
    }
    return { total: active.length, errors, warnings, ready };
  }, [clusters]);

  if (loading) return <p className="text-navy-500 py-6 text-center">Loading dashboard…</p>;

  return (
    <div className="space-y-4">
      {building && (
        <div className="text-xs text-teal-700 bg-teal-50 px-3 py-2 rounded">
          ◷ Consolidating firm data from uploaded sources…
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Clients', value: stats.total, cls: 'text-navy-800' },
          { label: 'Ready to Export', value: stats.ready, cls: 'text-green-700' },
          { label: 'With Errors', value: stats.errors, cls: stats.errors > 0 ? 'text-rose-600' : 'text-navy-400' },
          { label: 'Warnings', value: stats.warnings, cls: stats.warnings > 0 ? 'text-amber-600' : 'text-navy-400' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="card p-4 text-center">
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-navy-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-navy-500">
          <strong className="text-navy-700">{firmName}</strong> · Client Intelligence Dashboard
        </p>
        <div className="flex gap-2">
          {onOpenFirmSlideOver && (
            <>
              <button
                onClick={() => onOpenFirmSlideOver('company')}
                className="btn btn-ghost text-xs border border-navy-200"
              >
                Company Info ↗
              </button>
              <button
                onClick={() => onOpenFirmSlideOver('employees')}
                className="btn btn-ghost text-xs border border-navy-200"
              >
                Employees ↗
              </button>
            </>
          )}
          <button
            onClick={() => window.print()}
            className="btn btn-secondary text-xs"
            title="Save dashboard as PDF via browser print"
          >
            🖨 Export PDF
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="-mx-4 sm:mx-0">
        <div className="flex overflow-x-auto border-b border-navy-100 px-4 sm:px-0 scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
                activeTab === t.key ? 'border-teal text-teal-700' : 'border-transparent text-navy-500 hover:text-navy-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tab content */}
      <div>
        {activeTab === 'clients'   && <ClientsTab clusters={clusters} />}
        {activeTab === 'company'   && (
          <CompanyInfoTab
            sessionId={sessionId}
            onOpenSlideOver={() => onOpenFirmSlideOver?.('company')}
          />
        )}
        {activeTab === 'employees' && <EmployeesDashTab sessionId={sessionId} />}
        {activeTab === 'contacts'  && <ContactsTab sessionId={sessionId} />}
        {activeTab === 'suppliers' && (
          <div className="text-sm text-navy-500 py-4 text-center card p-8">
            Suppliers are managed via <button
              className="text-teal-700 underline"
              onClick={() => onOpenFirmSlideOver?.('suppliers')}
            >the Suppliers panel ↗</button>
          </div>
        )}
      </div>

      {/* ── Proceed to Export ───────────────────────────────────────────── */}
      {onProceedToExport && (
        <div className="flex justify-end pt-2">
          <button onClick={onProceedToExport} className="btn btn-primary text-sm">
            Continue to Export →
          </button>
        </div>
      )}
    </div>
  );
}
