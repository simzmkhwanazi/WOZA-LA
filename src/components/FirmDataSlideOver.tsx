'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

export type FirmTab = 'company' | 'employees' | 'suppliers';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  physical_address: { line1: string; line2: string; city: string; province: string; postal: string; country: string };
  banking_details: { bank: string; branch_code: string; account_nr: string; account_type: string };
}

interface Employee {
  id: string;
  name: string;
  email: string;
  id_number: string;
  job_title: string;
  department: string;
  phone: string;
  dg_roles: Record<string, number> | null;
  source: string;
}

interface Supplier {
  id: string;
  supplier_name: string;
  contact_person: string;
  email: string;
  phone: string;
  service_provided: string;
  payment_terms: string;
  contract_value: string;
}

const EMPTY_PROFILE: FirmProfile = {
  company_name: '', registration_nr: '', vat_nr: '', bbbee_level: '',
  industry_sector: '', auditor_name: '', contact_nr: '', email: '',
  physical_address: { line1: '', line2: '', city: '', province: '', postal: '', country: 'South Africa' },
  banking_details: { bank: '', branch_code: '', account_nr: '', account_type: '' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function InputRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-600 mb-1">{label}</label>
      <input type="text" className="input text-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CompanyTab({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [profile, setProfile] = useState<FirmProfile>(EMPTY_PROFILE);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from('firm_profile').select('*').eq('session_id', sessionId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfileId(data.id);
          setProfile({
            company_name: data.company_name ?? '',
            registration_nr: data.registration_nr ?? '',
            vat_nr: data.vat_nr ?? '',
            bbbee_level: data.bbbee_level ?? '',
            industry_sector: data.industry_sector ?? '',
            auditor_name: data.auditor_name ?? '',
            contact_nr: data.contact_nr ?? '',
            email: data.email ?? '',
            physical_address: data.physical_address ?? EMPTY_PROFILE.physical_address,
            banking_details: data.banking_details ?? EMPTY_PROFILE.banking_details,
          });
        }
      });
  }, [sessionId, supabase]);

  async function save() {
    setSaving(true);
    const payload = { ...profile, session_id: sessionId };
    if (profileId) {
      await supabase.from('firm_profile').update(payload).eq('id', profileId);
    } else {
      const { data } = await supabase.from('firm_profile').insert(payload).select('id').single();
      if (data) setProfileId(data.id);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function setField(key: keyof FirmProfile, value: string) {
    setProfile((p) => ({ ...p, [key]: value }));
  }
  function setAddr(key: keyof FirmProfile['physical_address'], value: string) {
    setProfile((p) => ({ ...p, physical_address: { ...p.physical_address, [key]: value } }));
  }
  function setBank(key: keyof FirmProfile['banking_details'], value: string) {
    setProfile((p) => ({ ...p, banking_details: { ...p.banking_details, [key]: value } }));
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><InputRow label="Company Name" value={profile.company_name} onChange={(v) => setField('company_name', v)} /></div>
        <InputRow label="Registration Nr" value={profile.registration_nr} onChange={(v) => setField('registration_nr', v)} />
        <InputRow label="VAT Nr" value={profile.vat_nr} onChange={(v) => setField('vat_nr', v)} />
        <InputRow label="B-BBEE Level" value={profile.bbbee_level} onChange={(v) => setField('bbbee_level', v)} />
        <InputRow label="Industry Sector" value={profile.industry_sector} onChange={(v) => setField('industry_sector', v)} />
        <div className="col-span-2"><InputRow label="Auditor / Accountable Executive" value={profile.auditor_name} onChange={(v) => setField('auditor_name', v)} /></div>
        <InputRow label="Contact Nr" value={profile.contact_nr} onChange={(v) => setField('contact_nr', v)} />
        <InputRow label="Email" value={profile.email} onChange={(v) => setField('email', v)} />
      </div>

      <div>
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-2">Physical Address</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><InputRow label="Line 1" value={profile.physical_address.line1} onChange={(v) => setAddr('line1', v)} /></div>
          <div className="col-span-2"><InputRow label="Line 2" value={profile.physical_address.line2} onChange={(v) => setAddr('line2', v)} /></div>
          <InputRow label="City" value={profile.physical_address.city} onChange={(v) => setAddr('city', v)} />
          <InputRow label="Province" value={profile.physical_address.province} onChange={(v) => setAddr('province', v)} />
          <InputRow label="Postal Code" value={profile.physical_address.postal} onChange={(v) => setAddr('postal', v)} />
          <InputRow label="Country" value={profile.physical_address.country} onChange={(v) => setAddr('country', v)} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-2">Banking Details</p>
        <div className="grid grid-cols-2 gap-3">
          <InputRow label="Bank" value={profile.banking_details.bank} onChange={(v) => setBank('bank', v)} />
          <InputRow label="Branch Code" value={profile.banking_details.branch_code} onChange={(v) => setBank('branch_code', v)} />
          <InputRow label="Account Nr" value={profile.banking_details.account_nr} onChange={(v) => setBank('account_nr', v)} />
          <InputRow label="Account Type" value={profile.banking_details.account_type} onChange={(v) => setBank('account_type', v)} />
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn btn-primary w-full">
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Company Info'}
      </button>
    </div>
  );
}

function EmployeesTab({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('firm_employees').select('*').eq('session_id', sessionId).order('name');
    setEmployees((data as Employee[]) ?? []);
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function updateEmployee(id: string, field: keyof Employee, value: string) {
    await supabase.from('firm_employees').update({ [field]: value }).eq('id', id);
    setEmployees((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));
  }

  if (loading) return <p className="text-xs text-navy-400 py-4 text-center">Loading employees…</p>;
  if (employees.length === 0) return (
    <p className="text-xs text-navy-400 py-4 text-center">
      No employees yet. Upload an employee list on the Upload tab and visit the Dashboard to consolidate.
    </p>
  );

  return (
    <div className="space-y-2 pb-4">
      {employees.map((emp) => {
        const isOpen = editing === emp.id;
        const dgSummary = emp.dg_roles
          ? Object.entries(emp.dg_roles).filter(([, count]) => count > 0).map(([role, count]) => `${role}: ${count}`).join(', ')
          : null;
        return (
          <div key={emp.id} className="border border-navy-100 rounded-lg overflow-hidden">
            <button
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-navy-50 text-left"
              onClick={() => setEditing(isOpen ? null : emp.id)}
            >
              <div>
                <p className="text-sm font-medium text-navy-800">{emp.name}</p>
                <p className="text-xs text-navy-500">{emp.job_title || '—'}{emp.department ? ` · ${emp.department}` : ''}</p>
                {dgSummary && <p className="text-xs text-teal-600 mt-0.5">DG roles: {dgSummary}</p>}
              </div>
              <span className="text-xs text-navy-400">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-2 bg-navy-50 border-t border-navy-100 grid grid-cols-2 gap-3">
                {(['name', 'email', 'id_number', 'job_title', 'department', 'phone'] as const).map((field) => (
                  <div key={field} className={field === 'name' || field === 'email' ? 'col-span-2' : ''}>
                    <label className="block text-xs font-medium text-navy-600 mb-1 capitalize">{field.replace('_', ' ')}</label>
                    <input
                      type="text"
                      className="input text-sm"
                      value={emp[field] ?? ''}
                      onChange={(e) => updateEmployee(emp.id, field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuppliersTab({ sessionId }: { sessionId: string }) {
  const supabase = createClient();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('firm_suppliers').select('*').eq('session_id', sessionId).order('supplier_name');
    setSuppliers((data as Supplier[]) ?? []);
    setLoading(false);
  }, [sessionId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function updateSupplier(id: string, field: keyof Supplier, value: string) {
    await supabase.from('firm_suppliers').update({ [field]: value }).eq('id', id);
    setSuppliers((prev) => prev.map((s) => s.id === id ? { ...s, [field]: value } : s));
  }

  async function addSupplier() {
    const { data } = await supabase
      .from('firm_suppliers')
      .insert({ session_id: sessionId, supplier_name: 'New Supplier' })
      .select('*')
      .single();
    if (data) setSuppliers((prev) => [...prev, data as Supplier]);
  }

  if (loading) return <p className="text-xs text-navy-400 py-4 text-center">Loading suppliers…</p>;

  return (
    <div className="space-y-3 pb-4">
      {suppliers.length === 0 && (
        <p className="text-xs text-navy-400 py-2 text-center">No suppliers yet. Add one below.</p>
      )}
      {suppliers.map((s) => (
        <div key={s.id} className="border border-navy-100 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {([
              ['supplier_name', 'Supplier Name'],
              ['contact_person', 'Contact Person'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['service_provided', 'Service Provided'],
              ['payment_terms', 'Payment Terms'],
              ['contract_value', 'Contract Value'],
            ] as [keyof Supplier, string][]).map(([field, label]) => (
              <div key={field} className={field === 'supplier_name' || field === 'service_provided' ? 'col-span-2' : ''}>
                <label className="block text-xs font-medium text-navy-600 mb-1">{label}</label>
                <input
                  type="text"
                  className="input text-sm"
                  value={s[field] ?? ''}
                  onChange={(e) => updateSupplier(s.id, field, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button onClick={addSupplier} className="btn btn-secondary w-full text-sm">+ Add Supplier</button>
    </div>
  );
}

// ── Main slide-over ───────────────────────────────────────────────────────────

export function FirmDataSlideOver({
  sessionId,
  open,
  initialTab,
  onClose,
}: {
  sessionId: string;
  open: boolean;
  initialTab: FirmTab;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<FirmTab>(initialTab);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const tabs: { key: FirmTab; label: string }[] = [
    { key: 'company',   label: 'Company Info' },
    { key: 'employees', label: 'Employees' },
    { key: 'suppliers', label: 'Suppliers' },
  ];

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Firm Data"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-navy-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-navy-800">Firm Data</h2>
          <button
            onClick={onClose}
            className="text-navy-400 hover:text-navy-700 text-2xl leading-none transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-navy-100 flex-shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                activeTab === t.key ? 'border-teal text-teal-700' : 'border-transparent text-navy-500 hover:text-navy-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 pt-4">
          {activeTab === 'company'   && <CompanyTab   sessionId={sessionId} />}
          {activeTab === 'employees' && <EmployeesTab sessionId={sessionId} />}
          {activeTab === 'suppliers' && <SuppliersTab sessionId={sessionId} />}
        </div>
      </div>
    </>
  );
}
