'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  const [downloading, setDownloading] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);

  async function downloadPDF() {
    setDownloading(true);
    try {
      // Fetch firm profile for the cover section
      const { data: profileData } = await supabase
        .from('firm_profile')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      const fp = profileData as FirmProfile | null;

      const active = clusters.filter((c) => !c.archived);

      // Build chart data inline (same logic as ClientsTab)
      const entityCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      const yearEndCounts: Record<string, number> = {};
      for (const c of active) {
        const m = c.merged as Record<string, unknown>;
        const et = String(m.entity_type ?? 'Unknown');
        entityCounts[et] = (entityCounts[et] ?? 0) + 1;
        const st = String(m.status ?? 'Unknown');
        statusCounts[st] = (statusCounts[st] ?? 0) + 1;
        const ye = String(m.year_end ?? '');
        if (ye) yearEndCounts[ye] = (yearEndCounts[ye] ?? 0) + 1;
      }
      const entityRows = Object.entries(entityCounts).sort((a, b) => b[1] - a[1]);
      const statusRows = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
      const svcRows = SERVICE_KEYS.map((s) => ({
        label: s.label,
        count: active.filter((c) => {
          const v = (c.merged as Record<string, unknown>)[s.key];
          return v === true || v === 'TRUE';
        }).length,
      })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);

      const dateStr = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

      // ── Build off-screen report div ──────────────────────────────────────────
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;left:-9999px;top:0;width:1100px;background:#fff;font-family:system-ui,sans-serif;padding:48px;box-sizing:border-box;';

      const BAR_MAX = Math.max(...entityRows.map((r) => r[1]), 1);
      const SVC_MAX = Math.max(...svcRows.map((r) => r.count), 1);
      const STATUS_MAX = Math.max(...statusRows.map((r) => r[1]), 1);
      const YE_MAX = Math.max(...MONTHS_ORDER.map((m) => yearEndCounts[m] ?? 0), 1);

      el.innerHTML = `
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0d9488;padding-bottom:20px;margin-bottom:28px;">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:3px;color:#0d9488;text-transform:uppercase;margin-bottom:4px;">Woza La · Client Intelligence Report</div>
            <div style="font-size:28px;font-weight:700;color:#1e3a5f;">${firmName}</div>
            ${fp?.company_name && fp.company_name !== firmName ? `<div style="font-size:13px;color:#64748b;margin-top:2px;">${fp.company_name}</div>` : ''}
          </div>
          <div style="text-align:right;font-size:11px;color:#94a3b8;">
            <div>Generated ${dateStr} by DataGrows</div>
            <div style="margin-top:2px;">DataGrows Internal Use Only</div>
          </div>
        </div>

        <!-- Firm details -->
        ${fp ? `
        <div style="background:#f8fafc;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#0d9488;text-transform:uppercase;margin-bottom:14px;">Firm Details</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;">
            ${[
              ['Registration Nr', fp.registration_nr],
              ['VAT Nr', fp.vat_nr],
              ['Industry', fp.industry_sector],
              ['B-BBEE Level', fp.bbbee_level],
              ['Auditor', fp.auditor_name],
              ['Contact Nr', fp.contact_nr],
              ['Email', fp.email],
            ].map(([label, val]) => val ? `
              <div>
                <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">${label}</div>
                <div style="font-size:12px;font-weight:600;color:#1e3a5f;">${val}</div>
              </div>` : '').join('')}
          </div>
        </div>` : ''}

        <!-- Stat cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:32px;">
          ${[
            ['Total Clients', stats.total, '#1e3a5f'],
            ['Ready to Export', stats.ready, '#059669'],
            ['With Errors', stats.errors, stats.errors > 0 ? '#dc2626' : '#94a3b8'],
            ['Warnings', stats.warnings, stats.warnings > 0 ? '#d97706' : '#94a3b8'],
          ].map(([label, val, color]) => `
            <div style="background:#f8fafc;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:32px;font-weight:800;color:${color};">${val}</div>
              <div style="font-size:10px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${label}</div>
            </div>`).join('')}
        </div>

        <!-- Charts row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px;">

          <!-- Entity Types -->
          <div style="background:#f8fafc;border-radius:10px;padding:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#0d9488;text-transform:uppercase;margin-bottom:14px;">Entity Types</div>
            ${entityRows.slice(0, 8).map(([name, count]) => `
              <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#334155;margin-bottom:3px;">
                  <span>${name}</span><span style="font-weight:600;">${count}</span>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                  <div style="height:100%;background:#0d9488;border-radius:3px;width:${Math.round((count / BAR_MAX) * 100)}%;"></div>
                </div>
              </div>`).join('')}
          </div>

          <!-- Client Status -->
          <div style="background:#f8fafc;border-radius:10px;padding:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#0d9488;text-transform:uppercase;margin-bottom:14px;">Client Status</div>
            ${statusRows.map(([name, count]) => {
              const c = name === 'Active' ? '#059669' : name === 'Dormant' ? '#f59e0b' : name === 'Inactive' ? '#94a3b8' : '#3b82f6';
              return `<div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#334155;margin-bottom:3px;">
                  <span>${name}</span><span style="font-weight:600;">${count}</span>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                  <div style="height:100%;background:${c};border-radius:3px;width:${Math.round((count / STATUS_MAX) * 100)}%;"></div>
                </div>
              </div>`;
            }).join('')}
          </div>

          <!-- Year-End Distribution -->
          <div style="background:#f8fafc;border-radius:10px;padding:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#0d9488;text-transform:uppercase;margin-bottom:14px;">Year-End Distribution</div>
            <div style="display:flex;align-items:flex-end;gap:5px;height:80px;">
              ${MONTHS_ORDER.map((m) => {
                const v = yearEndCounts[m] ?? 0;
                const pct = YE_MAX > 0 ? Math.round((v / YE_MAX) * 100) : 0;
                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
                  <div style="width:100%;background:#0d9488;border-radius:2px 2px 0 0;height:${pct}%;min-height:${v > 0 ? 2 : 0}px;"></div>
                  <div style="font-size:8px;color:#94a3b8;">${m.slice(0,3)}</div>
                </div>`;
              }).join('')}
            </div>
          </div>

          <!-- Services Overview -->
          <div style="background:#f8fafc;border-radius:10px;padding:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#0d9488;text-transform:uppercase;margin-bottom:14px;">Services Overview</div>
            ${svcRows.slice(0, 8).map(({ label, count }) => `
              <div style="margin-bottom:8px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#334155;margin-bottom:3px;">
                  <span>${label}</span><span style="font-weight:600;">${count}</span>
                </div>
                <div style="height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
                  <div style="height:100%;background:#14b8a6;border-radius:3px;width:${Math.round((count / SVC_MAX) * 100)}%;"></div>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Footer -->
        <div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:9px;color:#94a3b8;display:flex;justify-content:space-between;">
          <span>Woza La — DataGrows Client Onboarding Tool</span>
          <span>Confidential — Internal Use Only</span>
        </div>
      `;

      document.body.appendChild(el);

      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      document.body.removeChild(el);

      const imgData = canvas.toDataURL('image/png');
      const W = canvas.width / 2;
      const H = canvas.height / 2;
      const pdf = new jsPDF({ orientation: W > H ? 'landscape' : 'portrait', unit: 'px', format: [W, H] });
      pdf.addImage(imgData, 'PNG', 0, 0, W, H);
      pdf.save(`${firmName.replace(/[^a-z0-9_-]/gi, '_')}_report.pdf`);
    } finally {
      setDownloading(false);
    }
  }

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
        <button
          onClick={() => void downloadPDF()}
          disabled={downloading}
          className="btn btn-secondary text-xs"
        >
          {downloading ? 'Generating…' : 'Download PDF'}
        </button>
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
