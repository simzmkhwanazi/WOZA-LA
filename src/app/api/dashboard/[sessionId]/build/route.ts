/**
 * POST /api/dashboard/[sessionId]/build
 *
 * Builds (or refreshes) all firm-level data for the Dashboard tab:
 *
 * 1. Company profile extraction
 *    - Finds uploads with source_type 'company' or 'cipc' for this session
 *    - Uses AI (Claude) to extract structured firm profile fields from the raw text
 *    - Upserts into firm_profile table
 *
 * 2. Employee consolidation
 *    - Step A: Reads all clusters and collects unique staff names from the
 *      8 staff-assignment columns (AA–AH: partner, manager, accountant,
 *      accounting_role, cipc_role, financials_role, hr_role, tax_role)
 *      → builds a dg_roles map { role: count } per person
 *    - Step B: If an 'employees' upload exists, AI-extracts employee records
 *      (name, email, id_number, job_title, department, phone)
 *    - Step C: Merges the two sets by email → ID → name
 *    - Upserts into firm_employees
 *
 * 3. Contacts extraction
 *    - Finds 'contacts' uploads, AI-extracts into firm_contacts
 *
 * 4. Suppliers extraction
 *    - Finds 'suppliers' uploads, AI-extracts into firm_suppliers
 *
 * Returns { ok: true, company: boolean, employees: number, contacts: number, suppliers: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Staff role columns (AA–AH) ────────────────────────────────────────────────

const STAFF_ROLE_KEYS = [
  'partner',
  'manager',
  'accountant',
  'accounting_role',
  'cipc_role',
  'financials_role',
  'hr_role',
  'tax_role',
] as const;

// ── AI helpers ────────────────────────────────────────────────────────────────

async function callClaude(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    return data.content.find((c) => c.type === 'text')?.text ?? null;
  } catch {
    return null;
  }
}

function extractJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

// ── Company profile extraction ────────────────────────────────────────────────

const COMPANY_SYSTEM = `You are extracting structured company/firm profile data from raw text.

Return ONLY a valid JSON object with these fields (omit fields you cannot find):
{
  "company_name": string,
  "registration_nr": string,
  "vat_nr": string,
  "bbbee_level": string,
  "industry_sector": string,
  "auditor_name": string,
  "contact_nr": string,
  "email": string,
  "physical_address": {
    "line1": string,
    "line2": string,
    "city": string,
    "province": string,
    "postal": string,
    "country": string
  },
  "banking_details": {
    "bank": string,
    "branch_code": string,
    "account_nr": string,
    "account_type": string
  }
}

Rules:
- Return ONLY the JSON object, no markdown, no explanation.
- South African context: company names may end in (Pty) Ltd, CC, NPC, etc.
- branch_code: 6-digit number (e.g. "632005" for FNB, "051001" for Nedbank)
- province: use full province name (e.g. "Gauteng", "Western Cape")
- country: default "South Africa" unless stated otherwise.`;

async function extractCompanyProfile(
  rawText: string,
  sourceType: string,
): Promise<Record<string, unknown> | null> {
  const text = await callClaude(
    COMPANY_SYSTEM,
    `Source type: ${sourceType}\n\nRaw content:\n${rawText.slice(0, 4000)}`,
  );
  if (!text) return null;
  return extractJson<Record<string, unknown>>(text);
}

// ── Employee extraction ───────────────────────────────────────────────────────

const EMPLOYEES_SYSTEM = `You are extracting employee/staff records from raw spreadsheet text.

Return ONLY a valid JSON array of employee objects:
[
  {
    "name": string,
    "email": string,
    "id_number": string,
    "job_title": string,
    "department": string,
    "phone": string
  }
]

Rules:
- Return ONLY the JSON array, no markdown, no explanation.
- "name" is required; include partial records if name is present.
- South African ID numbers are 13 digits.
- Omit fields you cannot find (do not include empty strings for missing fields).
- "job_title" should be a descriptive title like "Tax Manager", "Partner", "Junior Accountant".`;

interface EmployeeRecord {
  name: string;
  email?: string;
  id_number?: string;
  job_title?: string;
  department?: string;
  phone?: string;
}

async function extractEmployees(rawText: string): Promise<EmployeeRecord[]> {
  const text = await callClaude(
    EMPLOYEES_SYSTEM,
    `Raw spreadsheet content:\n${rawText.slice(0, 6000)}`,
  );
  if (!text) return [];
  const arr = extractJson<EmployeeRecord[]>(text);
  return Array.isArray(arr) ? arr.filter((e) => e.name) : [];
}

// ── Contacts extraction ───────────────────────────────────────────────────────

const CONTACTS_SYSTEM = `You are extracting contact records from raw spreadsheet text.

Return ONLY a valid JSON array:
[
  {
    "name": string,
    "organisation": string,
    "email": string,
    "phone": string,
    "relationship": string
  }
]

Rules:
- Return ONLY the JSON array.
- "relationship" examples: "Contractor", "Referral Partner", "Bank Contact", "IT Supplier", "Attorney", "Client".
- Omit fields you cannot find.`;

interface ContactRecord {
  name?: string;
  organisation?: string;
  email?: string;
  phone?: string;
  relationship?: string;
}

async function extractContacts(rawText: string): Promise<ContactRecord[]> {
  const text = await callClaude(
    CONTACTS_SYSTEM,
    `Raw content:\n${rawText.slice(0, 6000)}`,
  );
  if (!text) return [];
  const arr = extractJson<ContactRecord[]>(text);
  return Array.isArray(arr) ? arr : [];
}

// ── Suppliers extraction ──────────────────────────────────────────────────────

const SUPPLIERS_SYSTEM = `You are extracting supplier records from raw spreadsheet text.

Return ONLY a valid JSON array:
[
  {
    "supplier_name": string,
    "contact_person": string,
    "email": string,
    "phone": string,
    "service_provided": string,
    "payment_terms": string,
    "contract_value": string
  }
]

Rules:
- Return ONLY the JSON array.
- "supplier_name" is required.
- "payment_terms" examples: "30 days", "COD", "EFT 7 days".
- "contract_value" as a string, e.g. "R 5 000 / month".
- Omit fields you cannot find.`;

interface SupplierRecord {
  supplier_name?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  service_provided?: string;
  payment_terms?: string;
  contract_value?: string;
}

async function extractSuppliers(rawText: string): Promise<SupplierRecord[]> {
  const text = await callClaude(
    SUPPLIERS_SYSTEM,
    `Raw content:\n${rawText.slice(0, 6000)}`,
  );
  if (!text) return [];
  const arr = extractJson<SupplierRecord[]>(text);
  return Array.isArray(arr) ? arr.filter((s) => s.supplier_name) : [];
}

// ── Upload content reader ─────────────────────────────────────────────────────

interface UploadRow {
  id: string;
  source_type: string;
  storage_path: string | null;
  parsed_rows: unknown[] | null;
  column_map: Record<string, string> | null;
}

/**
 * Convert parsed_rows + column_map into a flat text representation for AI.
 * If no parsed rows, fall back to a note that the file has no parsed content.
 */
function rowsToText(upload: UploadRow): string {
  const rows = upload.parsed_rows ?? [];
  if (rows.length === 0) return '(no parsed rows available)';

  const lines: string[] = [];
  for (const row of rows.slice(0, 200)) {
    if (typeof row === 'object' && row !== null) {
      lines.push(
        Object.entries(row as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && v !== '')
          .map(([k, v]) => `${k}: ${v}`)
          .join(' | '),
      );
    }
  }
  return lines.join('\n');
}

// ── Main route ────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  const supabase = createServiceClient();

  const result = {
    ok: true,
    company: false,
    employees: 0,
    contacts: 0,
    suppliers: 0,
  };

  // ── 1. Fetch all uploads for this session ─────────────────────────────────

  const { data: uploads } = await supabase
    .from('uploads')
    .select('id, source_type, storage_path, parsed_rows, column_map')
    .eq('session_id', sessionId);

  const allUploads = (uploads ?? []) as UploadRow[];

  // ── 2. Company profile extraction ─────────────────────────────────────────

  // Source priority for company info: cipc > sars > company > sage > xero > excel
  const COMPANY_PRIORITY = ['cipc', 'sars', 'company', 'sage', 'xero', 'excel'];
  const companyUploads = allUploads
    .filter((u) => COMPANY_PRIORITY.includes(u.source_type))
    .sort((a, b) => COMPANY_PRIORITY.indexOf(a.source_type) - COMPANY_PRIORITY.indexOf(b.source_type));

  if (companyUploads.length > 0) {
    // Combine text from all company-relevant uploads (highest priority first)
    const combinedText = companyUploads
      .map((u) => `[Source: ${u.source_type}]\n${rowsToText(u)}`)
      .join('\n\n---\n\n');

    const extracted = await extractCompanyProfile(combinedText, companyUploads[0].source_type);

    if (extracted) {
      // Check if firm_profile already exists for this session
      const { data: existing } = await supabase
        .from('firm_profile')
        .select('id')
        .eq('session_id', sessionId)
        .maybeSingle();

      const payload = {
        ...extracted,
        session_id: sessionId,
        sources: companyUploads.map((u) => u.source_type),
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        // Only overwrite fields that are currently empty (don't clobber manual edits)
        const { data: currentProfile } = await supabase
          .from('firm_profile')
          .select('*')
          .eq('id', existing.id)
          .single();

        if (currentProfile) {
          const conservativePayload: Record<string, unknown> = {
            updated_at: payload.updated_at,
            sources: payload.sources,
          };
          // Only update scalar fields that are empty/null in the current profile
          const scalarFields = [
            'company_name', 'registration_nr', 'vat_nr', 'bbbee_level',
            'industry_sector', 'auditor_name', 'contact_nr', 'email',
          ];
          for (const f of scalarFields) {
            if (!currentProfile[f] && extracted[f]) {
              conservativePayload[f] = extracted[f];
            }
          }
          // For nested objects, merge field-by-field
          if (extracted.physical_address && typeof extracted.physical_address === 'object') {
            const currAddr = (currentProfile.physical_address ?? {}) as Record<string, string>;
            const newAddr = extracted.physical_address as Record<string, string>;
            const merged: Record<string, string> = { ...newAddr };
            for (const k of Object.keys(currAddr)) {
              if (currAddr[k]) merged[k] = currAddr[k]; // current wins if set
            }
            conservativePayload.physical_address = merged;
          }
          if (extracted.banking_details && typeof extracted.banking_details === 'object') {
            const currBank = (currentProfile.banking_details ?? {}) as Record<string, string>;
            const newBank = extracted.banking_details as Record<string, string>;
            const merged: Record<string, string> = { ...newBank };
            for (const k of Object.keys(currBank)) {
              if (currBank[k]) merged[k] = currBank[k];
            }
            conservativePayload.banking_details = merged;
          }
          await supabase
            .from('firm_profile')
            .update(conservativePayload)
            .eq('id', existing.id);
        }
      } else {
        await supabase.from('firm_profile').insert(payload);
      }
      result.company = true;
    }
  }

  // ── 3. Employee consolidation ─────────────────────────────────────────────

  // Step A: collect DG role assignments from cluster merged data
  const { data: clusters } = await supabase
    .from('clusters')
    .select('merged')
    .eq('session_id', sessionId)
    .eq('archived', false);

  // Map: normalised name → { role → count }
  const dgRolesMap = new Map<string, Record<string, number>>();

  for (const cluster of (clusters ?? []) as { merged: Record<string, unknown> }[]) {
    const merged = cluster.merged;
    for (const roleKey of STAFF_ROLE_KEYS) {
      const name = merged[roleKey];
      if (!name || typeof name !== 'string' || !name.trim()) continue;
      const norm = name.trim().toLowerCase();
      const existing = dgRolesMap.get(norm) ?? {};
      existing[roleKey] = (existing[roleKey] ?? 0) + 1;
      dgRolesMap.set(norm, existing);
    }
  }

  // Step B: AI-extract employees from any 'employees' uploads
  const employeeUploads = allUploads.filter((u) => u.source_type === 'employees');
  const aiEmployees: EmployeeRecord[] = [];
  for (const upload of employeeUploads) {
    const text = rowsToText(upload);
    const extracted = await extractEmployees(text);
    aiEmployees.push(...extracted);
  }

  // Step C: merge AI employees with DG role assignments
  // Also include any staff names from DG roles that weren't in the AI list
  const finalEmployees: Array<{
    name: string;
    email?: string;
    id_number?: string;
    job_title?: string;
    department?: string;
    phone?: string;
    dg_roles: Record<string, number>;
    source: string;
  }> = [];

  // Build lookup maps from AI employees
  const byEmail = new Map<string, EmployeeRecord>();
  const byId = new Map<string, EmployeeRecord>();
  const byName = new Map<string, EmployeeRecord>();

  for (const emp of aiEmployees) {
    if (emp.email) byEmail.set(emp.email.toLowerCase(), emp);
    if (emp.id_number) byId.set(emp.id_number, emp);
    if (emp.name) byName.set(emp.name.trim().toLowerCase(), emp);
  }

  // Set to track which DG names have been matched to an AI employee
  const matchedDgNames = new Set<string>();

  for (const emp of aiEmployees) {
    const norm = emp.name.trim().toLowerCase();
    // Try to find matching DG roles
    let dgRoles: Record<string, number> = {};

    // Match by email first
    if (emp.email) {
      const emailNorm = emp.email.toLowerCase();
      // Look for any DG name whose AI record matches this email
      for (const [dgName, roles] of dgRolesMap.entries()) {
        const dgAi = byEmail.get(emailNorm);
        if (dgAi && dgAi.name.trim().toLowerCase() === dgName) {
          dgRoles = roles;
          matchedDgNames.add(dgName);
          break;
        }
      }
    }

    // Match by name if not found yet
    if (Object.keys(dgRoles).length === 0 && dgRolesMap.has(norm)) {
      dgRoles = dgRolesMap.get(norm)!;
      matchedDgNames.add(norm);
    }

    finalEmployees.push({
      ...emp,
      dg_roles: dgRoles,
      source: Object.keys(dgRoles).length > 0 ? 'both' : 'employees_upload',
    });
  }

  // Add DG-only names (not matched to any AI employee)
  for (const [dgName, dgRoles] of dgRolesMap.entries()) {
    if (matchedDgNames.has(dgName)) continue;
    // Reconstruct display name from the normalised version
    // Find original casing from cluster data
    const originalName = (() => {
      for (const cluster of (clusters ?? []) as { merged: Record<string, unknown> }[]) {
        for (const roleKey of STAFF_ROLE_KEYS) {
          const n = cluster.merged[roleKey];
          if (typeof n === 'string' && n.trim().toLowerCase() === dgName) return n.trim();
        }
      }
      return dgName; // fallback
    })();

    finalEmployees.push({
      name: originalName,
      dg_roles: dgRoles,
      source: 'dg_assignments',
    });
  }

  // Delete existing employees for this session and re-insert (full rebuild)
  if (finalEmployees.length > 0 || dgRolesMap.size > 0) {
    await supabase.from('firm_employees').delete().eq('session_id', sessionId);

    const insertRows = finalEmployees.map((e) => ({
      session_id: sessionId,
      name: e.name,
      email: e.email ?? null,
      id_number: e.id_number ?? null,
      job_title: e.job_title ?? null,
      department: e.department ?? null,
      phone: e.phone ?? null,
      dg_roles: e.dg_roles,
      source: e.source,
    }));

    if (insertRows.length > 0) {
      await supabase.from('firm_employees').insert(insertRows);
    }
    result.employees = insertRows.length;
  }

  // ── 4. Contacts extraction ────────────────────────────────────────────────

  const contactUploads = allUploads.filter((u) => u.source_type === 'contacts');
  if (contactUploads.length > 0) {
    const allContacts: ContactRecord[] = [];
    for (const upload of contactUploads) {
      const text = rowsToText(upload);
      const extracted = await extractContacts(text);
      allContacts.push(...extracted);
    }

    if (allContacts.length > 0) {
      // Delete existing and re-insert
      await supabase.from('firm_contacts').delete().eq('session_id', sessionId);
      const rows = allContacts.map((c) => ({
        session_id: sessionId,
        name: c.name ?? null,
        organisation: c.organisation ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        relationship: c.relationship ?? null,
      }));
      await supabase.from('firm_contacts').insert(rows);
      result.contacts = rows.length;
    }
  }

  // ── 5. Suppliers extraction ───────────────────────────────────────────────

  const supplierUploads = allUploads.filter((u) => u.source_type === 'suppliers');
  if (supplierUploads.length > 0) {
    const allSuppliers: SupplierRecord[] = [];
    for (const upload of supplierUploads) {
      const text = rowsToText(upload);
      const extracted = await extractSuppliers(text);
      allSuppliers.push(...extracted);
    }

    if (allSuppliers.length > 0) {
      // Only insert if firm_suppliers is currently empty (don't clobber manual entries)
      const { count } = await supabase
        .from('firm_suppliers')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId);

      if ((count ?? 0) === 0) {
        const rows = allSuppliers.map((s) => ({
          session_id: sessionId,
          supplier_name: s.supplier_name ?? 'Unknown Supplier',
          contact_person: s.contact_person ?? null,
          email: s.email ?? null,
          phone: s.phone ?? null,
          service_provided: s.service_provided ?? null,
          payment_terms: s.payment_terms ?? null,
          contract_value: s.contract_value ?? null,
        }));
        await supabase.from('firm_suppliers').insert(rows);
        result.suppliers = rows.length;
      }
    }
  }

  return NextResponse.json(result);
}
