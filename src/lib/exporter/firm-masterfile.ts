/**
 * Firm Masterfile Excel Generator
 *
 * Produces a multi-sheet ExcelJS workbook — the "Client Intelligence Report"
 * for the accounting firm. This is NOT the DataGrows import template; it is
 * a human-readable summary of all data captured for the firm.
 *
 * Sheets:
 *  1. Overview        — firm profile + session stats + generation date
 *  2. Clients         — all clusters: Name, Entity Type, Reg Nr, Status, Sources, Year End, Services
 *  3. Source Coverage — all clients × all source types: ✓/✗ grid
 *  4. Services Matrix — full client × service grid (all 11 service columns)
 *  5. Employees       — all firm_employees with DG roles summary
 *  6. Contacts        — all firm_contacts
 *  7. Suppliers       — all firm_suppliers
 *  8. Data Quality    — per-client error/warning list
 *
 * SERVER-ONLY — must run in a Node.js environment.
 */

import ExcelJS from 'exceljs';
import { validateRecord } from '../validator';
import type { ClientRecord } from '../schema/datagrows';
import { CLIENT_SOURCE_TYPES } from '../schema/sources';

// ── Colour palette ────────────────────────────────────────────────────────────

const TEAL = '0D9488';
const NAVY = '1E3A5F';
const LIGHT_GREY = 'F3F4F6';
const WHITE = 'FFFFFF';
const GREEN = '16A34A';
const AMBER = 'D97706';
const ROSE = 'E11D48';

// ── Helpers ───────────────────────────────────────────────────────────────────

function headerRow(ws: ExcelJS.Worksheet, values: string[], bgColor = NAVY) {
  const row = ws.addRow(values);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${WHITE}` } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bgColor}` } };
    cell.border = {
      bottom: { style: 'thin', color: { argb: `FF${TEAL}` } },
    };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  return row;
}

function setColWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function boolCell(value: unknown): string {
  if (value === true || value === 'TRUE' || value === 1) return '✓';
  if (value === false || value === 'FALSE' || value === 0) return '✗';
  return '—';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FirmProfileRow {
  company_name?: string;
  registration_nr?: string;
  vat_nr?: string;
  bbbee_level?: string;
  industry_sector?: string;
  auditor_name?: string;
  contact_nr?: string;
  email?: string;
  physical_address?: {
    line1?: string; line2?: string; city?: string;
    province?: string; postal?: string; country?: string;
  };
  banking_details?: {
    bank?: string; branch_code?: string; account_nr?: string; account_type?: string;
  };
}

export interface EmployeeRow {
  name: string;
  email?: string;
  id_number?: string;
  job_title?: string;
  department?: string;
  phone?: string;
  dg_roles?: Record<string, number> | null;
  source?: string;
}

export interface ContactRow {
  name?: string;
  organisation?: string;
  email?: string;
  phone?: string;
  relationship?: string;
}

export interface SupplierRow {
  supplier_name?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  service_provided?: string;
  payment_terms?: string;
  contract_value?: string;
}

export interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
}

export interface FirmMasterfileOptions {
  firmProfile: FirmProfileRow | null;
  firmName: string;
  clusters: ClusterRow[];
  employees: EmployeeRow[];
  contacts: ContactRow[];
  suppliers: SupplierRow[];
  generatedBy?: string;
}

// ── Service keys ──────────────────────────────────────────────────────────────

const SERVICE_KEYS = [
  { key: 'financials',      label: 'Financials' },
  { key: 'audit',           label: 'Audit' },
  { key: 'income_tax',      label: 'Income Tax' },
  { key: 'provisional_tax', label: 'Provisional Tax' },
  { key: 'turnover_tax',    label: 'Turnover Tax' },
  { key: 'vat',             label: 'VAT' },
  { key: 'payroll',         label: 'Payroll' },
  { key: 'uif',             label: 'UIF' },
  { key: 'workmans',        label: "Workman's" },
  { key: 'cipc_annual_return', label: 'CIPC Annual Return' },
  { key: 'documents_folder',   label: 'Documents Folder' },
] as const;

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateFirmMasterfile(
  opts: FirmMasterfileOptions,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Woza La';
  wb.created = new Date();

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  const monthYear = now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });

  const nonArchived = opts.clusters.filter((c) => !c.archived);
  const allMerged = nonArchived.map((c) => c.merged);

  // ── Sheet 1: Overview ──────────────────────────────────────────────────────

  const wsOverview = wb.addWorksheet('Overview');
  setColWidths(wsOverview, [30, 50]);

  // Title
  const titleRow = wsOverview.addRow([`Client Intelligence Report — ${monthYear}`]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: `FF${NAVY}` } };
  titleRow.getCell(1).alignment = { horizontal: 'left' };
  wsOverview.mergeCells('A1:B1');
  wsOverview.addRow([]);

  // Firm info section
  wsOverview.addRow(['Generated for', opts.firmName]);
  wsOverview.addRow(['Generated on', dateStr]);
  wsOverview.addRow(['Generated by', 'DataGrows']);
  wsOverview.addRow([]);

  // Firm profile
  if (opts.firmProfile) {
    const fp = opts.firmProfile;
    wsOverview.addRow(['FIRM PROFILE', '']).getCell(1).font = { bold: true, color: { argb: `FF${TEAL}` } };
    if (fp.company_name)    wsOverview.addRow(['Company Name', fp.company_name]);
    if (fp.registration_nr) wsOverview.addRow(['Registration Nr', fp.registration_nr]);
    if (fp.vat_nr)          wsOverview.addRow(['VAT Nr', fp.vat_nr]);
    if (fp.bbbee_level)     wsOverview.addRow(['B-BBEE Level', fp.bbbee_level]);
    if (fp.industry_sector) wsOverview.addRow(['Industry Sector', fp.industry_sector]);
    if (fp.auditor_name)    wsOverview.addRow(['Auditor / Exec', fp.auditor_name]);
    if (fp.contact_nr)      wsOverview.addRow(['Contact Nr', fp.contact_nr]);
    if (fp.email)           wsOverview.addRow(['Email', fp.email]);
    if (fp.physical_address) {
      const a = fp.physical_address;
      const addr = [a.line1, a.line2, a.city, a.province, a.postal, a.country].filter(Boolean).join(', ');
      if (addr) wsOverview.addRow(['Physical Address', addr]);
    }
    if (fp.banking_details) {
      const b = fp.banking_details;
      if (b.bank) wsOverview.addRow(['Bank', `${b.bank}${b.branch_code ? ` (${b.branch_code})` : ''}`]);
      if (b.account_nr) wsOverview.addRow(['Account Nr', `${b.account_nr}${b.account_type ? ` (${b.account_type})` : ''}`]);
    }
    wsOverview.addRow([]);
  }

  // Stats section
  let withErrors = 0;
  let withWarnings = 0;
  const statusCounts: Record<string, number> = {};
  const entityCounts: Record<string, number> = {};

  for (const r of allMerged) {
    const v = validateRecord(r);
    if (!v.ok) {
      if (v.issues.some((i) => i.severity === 'error')) withErrors++;
      if (v.issues.some((i) => i.severity === 'warning')) withWarnings++;
    }
    const status = String(r.status ?? 'Unknown');
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const entity = String(r.entity_type ?? 'Unknown');
    entityCounts[entity] = (entityCounts[entity] ?? 0) + 1;
  }

  wsOverview.addRow(['SESSION STATS', '']).getCell(1).font = { bold: true, color: { argb: `FF${TEAL}` } };
  wsOverview.addRow(['Total Clusters', opts.clusters.length]);
  wsOverview.addRow(['Active Clients', nonArchived.length]);
  wsOverview.addRow(['Archived', opts.clusters.length - nonArchived.length]);
  wsOverview.addRow(['Records with Errors', withErrors]);
  wsOverview.addRow(['Records with Warnings', withWarnings]);
  wsOverview.addRow(['Employees on Record', opts.employees.length]);
  wsOverview.addRow(['Contacts on Record', opts.contacts.length]);
  wsOverview.addRow(['Suppliers on Record', opts.suppliers.length]);

  // ── Sheet 2: Clients ───────────────────────────────────────────────────────

  const wsClients = wb.addWorksheet('Clients');
  setColWidths(wsClients, [40, 22, 22, 16, 14, 14, 25, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14]);

  headerRow(wsClients, [
    'Client Name', 'Entity Type', 'Registration Nr', 'Status',
    'Year End', 'Tax Nr', 'Sources',
    ...SERVICE_KEYS.map((s) => s.label),
  ]);

  for (const c of nonArchived) {
    const r = c.merged;
    const row = wsClients.addRow([
      r.client_name ?? '',
      r.entity_type ?? '',
      r.registration_nr ?? '',
      r.status ?? '',
      r.year_end ?? '',
      r.tax_nr ?? '',
      (c.sources ?? []).join(', '),
      ...SERVICE_KEYS.map((s) => boolCell((r as Record<string, unknown>)[s.key])),
    ]);
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      // Alternate row shading
      if (wsClients.rowCount % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${LIGHT_GREY}` } };
      }
      // Colour service cells
      if (colNum > 7) {
        const val = cell.value;
        if (val === '✓') cell.font = { color: { argb: `FF${GREEN}` }, bold: true };
        if (val === '✗') cell.font = { color: { argb: 'FFCCCCCC' } };
      }
    });
  }

  wsClients.autoFilter = { from: 'A1', to: `R1` };

  // ── Sheet 3: Source Coverage ───────────────────────────────────────────────

  const wsSource = wb.addWorksheet('Source Coverage');
  const sourceCols = CLIENT_SOURCE_TYPES as readonly string[];
  setColWidths(wsSource, [40, ...sourceCols.map(() => 14)]);

  headerRow(wsSource, ['Client Name', ...sourceCols.map((s) => s.toUpperCase())]);

  for (const c of nonArchived) {
    const r = c.merged;
    const sources = new Set(c.sources ?? []);
    wsSource.addRow([
      r.client_name ?? '',
      ...sourceCols.map((s) => (sources.has(s) ? '✓' : '✗')),
    ]);
  }

  // ── Sheet 4: Services Matrix ───────────────────────────────────────────────

  const wsServices = wb.addWorksheet('Services Matrix');
  setColWidths(wsServices, [40, ...SERVICE_KEYS.map(() => 16)]);

  headerRow(wsServices, ['Client Name', ...SERVICE_KEYS.map((s) => s.label)]);

  for (const c of nonArchived) {
    const r = c.merged;
    const row = wsServices.addRow([
      r.client_name ?? '',
      ...SERVICE_KEYS.map((s) => boolCell((r as Record<string, unknown>)[s.key])),
    ]);
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      if (colNum > 1) {
        if (cell.value === '✓') cell.font = { color: { argb: `FF${GREEN}` }, bold: true };
        if (cell.value === '✗') cell.font = { color: { argb: 'FFCCCCCC' } };
      }
    });
  }

  // ── Sheet 5: Employees ─────────────────────────────────────────────────────

  const wsEmployees = wb.addWorksheet('Employees');
  setColWidths(wsEmployees, [30, 30, 18, 25, 20, 18, 40, 16]);

  headerRow(wsEmployees, [
    'Name', 'Email', 'ID Number', 'Job Title', 'Department', 'Phone',
    'DG Roles Summary', 'Source',
  ]);

  for (const emp of opts.employees) {
    const rolesSummary = emp.dg_roles
      ? Object.entries(emp.dg_roles)
          .filter(([, count]) => count > 0)
          .map(([role, count]) => `${role.replace(/_/g, ' ')}: ${count}`)
          .join(', ')
      : '';
    wsEmployees.addRow([
      emp.name,
      emp.email ?? '',
      emp.id_number ?? '',
      emp.job_title ?? '',
      emp.department ?? '',
      emp.phone ?? '',
      rolesSummary,
      emp.source ?? '',
    ]);
  }

  if (opts.employees.length === 0) {
    wsEmployees.addRow(['No employee data available. Upload an employee list and rebuild.']);
  }

  // ── Sheet 6: Contacts ──────────────────────────────────────────────────────

  const wsContacts = wb.addWorksheet('Contacts');
  setColWidths(wsContacts, [30, 30, 30, 18, 20]);

  headerRow(wsContacts, ['Name', 'Organisation', 'Email', 'Phone', 'Relationship']);

  for (const c of opts.contacts) {
    wsContacts.addRow([
      c.name ?? '',
      c.organisation ?? '',
      c.email ?? '',
      c.phone ?? '',
      c.relationship ?? '',
    ]);
  }

  if (opts.contacts.length === 0) {
    wsContacts.addRow(['No contacts on record.']);
  }

  // ── Sheet 7: Suppliers ─────────────────────────────────────────────────────

  const wsSuppliers = wb.addWorksheet('Suppliers');
  setColWidths(wsSuppliers, [30, 25, 30, 18, 30, 20, 20]);

  headerRow(wsSuppliers, [
    'Supplier Name', 'Contact Person', 'Email', 'Phone',
    'Service Provided', 'Payment Terms', 'Contract Value',
  ]);

  for (const s of opts.suppliers) {
    wsSuppliers.addRow([
      s.supplier_name ?? '',
      s.contact_person ?? '',
      s.email ?? '',
      s.phone ?? '',
      s.service_provided ?? '',
      s.payment_terms ?? '',
      s.contract_value ?? '',
    ]);
  }

  if (opts.suppliers.length === 0) {
    wsSuppliers.addRow(['No suppliers on record.']);
  }

  // ── Sheet 8: Data Quality ──────────────────────────────────────────────────

  const wsQuality = wb.addWorksheet('Data Quality');
  setColWidths(wsQuality, [40, 10, 10, 60]);

  headerRow(wsQuality, ['Client Name', 'Errors', 'Warnings', 'Issues']);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const c of nonArchived) {
    const v = validateRecord(c.merged);
    const errors = v.issues.filter((i) => i.severity === 'error');
    const warnings = v.issues.filter((i) => i.severity === 'warning');

    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (errors.length > 0 || warnings.length > 0) {
      const issueText = v.issues
        .map((i) => `[${i.severity.toUpperCase()}] ${i.field}: ${i.message}`)
        .join('; ');

      const row = wsQuality.addRow([
        c.merged.client_name ?? '',
        errors.length,
        warnings.length,
        issueText,
      ]);

      if (errors.length > 0) {
        row.getCell(2).font = { color: { argb: `FF${ROSE}` }, bold: true };
      }
      if (warnings.length > 0) {
        row.getCell(3).font = { color: { argb: `FF${AMBER}` }, bold: true };
      }
    }
  }

  // Summary row at bottom
  wsQuality.addRow([]);
  const summaryRow = wsQuality.addRow([
    `Total: ${nonArchived.length} records`,
    totalErrors,
    totalWarnings,
    `${Math.round(((nonArchived.length - withErrors) / Math.max(nonArchived.length, 1)) * 100)}% records are export-ready`,
  ]);
  summaryRow.font = { bold: true };
  summaryRow.getCell(2).font = { bold: true, color: { argb: `FF${ROSE}` } };
  summaryRow.getCell(3).font = { bold: true, color: { argb: `FF${AMBER}` } };

  // ── Finalise ───────────────────────────────────────────────────────────────

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
