/**
 * DataGrows Features Recommendations Generator
 *
 * Rule-based scoring derived directly from cluster data — no AI required.
 *
 * SERVER-ONLY — must run in a Node.js environment.
 */

import ExcelJS from 'exceljs';
import { validateRecord } from '../validator';
import type { ClientRecord } from '../schema/datagrows';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClusterRow {
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
}

export interface EmployeeRow {
  name: string;
  dg_roles?: Record<string, number> | null;
}

export interface FeaturesRecommendationsOptions {
  firmName: string;
  clusters: ClusterRow[];
  employees: EmployeeRow[];
  generatedBy?: string;
}

interface Feature {
  name: string;
  description: string;
  score: number;          // 0–100
  relevance: 'High' | 'Medium' | 'Low';
  evidence: string;
  action: string;
}

// ── Colour palette ────────────────────────────────────────────────────────────

const NAVY = '1E3A5F';
const TEAL = '0D9488';
const WHITE = 'FFFFFF';
const GREEN_BG = 'DCFCE7';
const AMBER_BG = 'FEF3C7';
const GREY_BG = 'F3F4F6';
const GREEN_TEXT = '15803D';
const AMBER_TEXT = 'B45309';
const GREY_TEXT = '6B7280';

// ── Score → relevance ─────────────────────────────────────────────────────────

function toRelevance(score: number): 'High' | 'Medium' | 'Low' {
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

// ── Scoring functions ─────────────────────────────────────────────────────────

function scoreFeatures(
  clusters: ClusterRow[],
  employees: EmployeeRow[],
): Feature[] {
  const active = clusters.filter((c) => !c.archived);
  const total = active.length;
  if (total === 0) {
    return []; // No data to analyse
  }

  const merged = active.map((c) => c.merged);

  // Pre-compute counts
  const withEmail = merged.filter((r) => r.contact_email).length;
  const withPaye = merged.filter((r) => r.paye_nr).length;
  const withVat = merged.filter((r) => r.vat === true).length;
  const withPayroll = merged.filter((r) => r.payroll === true).length;
  const withCipc = merged.filter((r) => r.cipc_annual_return === true).length;
  const withIncomeTax = merged.filter((r) => r.income_tax === true).length;
  const withProvisionalTax = merged.filter((r) => r.provisional_tax === true).length;
  const withDocFolder = merged.filter((r) => r.documents_folder === true).length;
  const dormantCount = merged.filter((r) => r.status === 'Dormant').length;
  const activeCount = merged.filter((r) => r.status === 'Active').length;

  // Registered entity types for Share Registers
  const registeredEntities = ['PTY LTD', 'PLC', 'PUBLIC COMPANY', 'CLOSE CORPORATION'];
  const withShares = merged.filter((r) =>
    registeredEntities.includes(String(r.entity_type ?? '')),
  ).length;

  // Upsell candidates: Active clients with < 3 services ticked
  const SERVICE_FLAGS = [
    'financials', 'audit', 'income_tax', 'provisional_tax', 'turnover_tax',
    'vat', 'payroll', 'uif', 'workmans', 'cipc_annual_return', 'documents_folder',
  ] as const;

  const upsellCandidates = merged.filter((r) => {
    if (r.status !== 'Active') return false;
    const serviceCount = SERVICE_FLAGS.filter(
      (k) => (r as Record<string, unknown>)[k] === true,
    ).length;
    return serviceCount < 3;
  }).length;

  // Errors / quality
  let withErrors = 0;
  for (const r of merged) {
    const v = validateRecord(r);
    if (!v.ok && v.issues.some((i) => i.severity === 'error')) withErrors++;
  }

  // Employee role diversity (how many distinct role types are used)
  const roleTypes = new Set<string>();
  for (const emp of employees) {
    if (emp.dg_roles) {
      Object.keys(emp.dg_roles).forEach((r) => roleTypes.add(r));
    }
  }

  const pct = (n: number) => Math.round((n / total) * 100);

  const features: Feature[] = [
    // ── Automated Emails
    {
      name: 'Automated Emails',
      description: 'Automatically send deadline reminders and statements to clients via DataGrows.',
      score: Math.min(100, pct(withEmail) * 1.2),
      relevance: toRelevance(Math.min(100, pct(withEmail) * 1.2)),
      evidence: `${withEmail} of ${total} clients (${pct(withEmail)}%) have a contact email on record.`,
      action: withEmail > total * 0.7
        ? 'Enable Automated Emails — you have strong email coverage to start immediately.'
        : `Fill in contact emails for the remaining ${total - withEmail} clients first to maximise reach.`,
    },

    // ── Client Management
    {
      name: 'Client Management',
      description: 'Centralised client profiles, task tracking and deadline management per client.',
      score: Math.min(100, 40 + Math.min(60, total * 0.6)),
      relevance: toRelevance(Math.min(100, 40 + Math.min(60, total * 0.6))),
      evidence: `You are onboarding ${total} clients. ${activeCount} are Active, ${dormantCount} are Dormant.`,
      action: total > 50
        ? 'High priority — with over 50 clients, centralised task tracking will prevent missed deadlines.'
        : 'Useful now and essential as your client base grows.',
    },

    // ── Workflow Automation
    {
      name: 'Workflow Automation',
      description: 'Pre-built workflow templates for VAT, Payroll, CIPC, and other recurring services.',
      score: Math.min(100, pct(withVat + withPayroll + withCipc) * 0.8),
      relevance: toRelevance(Math.min(100, pct(withVat + withPayroll + withCipc) * 0.8)),
      evidence: `${withVat} clients on VAT, ${withPayroll} on Payroll, ${withCipc} on CIPC Annual Return.`,
      action: (withVat + withPayroll + withCipc) > total * 0.5
        ? 'Highly relevant — automate the high-volume recurring services immediately.'
        : 'Relevant as you grow your VAT, Payroll, and CIPC client base.',
    },

    // ── Real-Time Reporting
    {
      name: 'Real-Time Reporting',
      description: 'Live dashboards showing completion rates, deadlines, and staff workloads.',
      score: Math.min(100, 50 + (withErrors > 0 ? 30 : 0) + (employees.length > 3 ? 20 : 0)),
      relevance: toRelevance(Math.min(100, 50 + (withErrors > 0 ? 30 : 0) + (employees.length > 3 ? 20 : 0))),
      evidence: `${withErrors} records have data quality issues. ${employees.length} staff members manage ${total} clients.`,
      action: 'Enable Real-Time Reporting to give partners and managers live visibility into progress.',
    },

    // ── Document Management
    {
      name: 'Document Management',
      description: 'Secure document storage per client — store financials, tax returns, correspondence.',
      score: Math.min(100, pct(withDocFolder) * 1.5 + (total > 30 ? 30 : 0)),
      relevance: toRelevance(Math.min(100, pct(withDocFolder) * 1.5 + (total > 30 ? 30 : 0))),
      evidence: `${withDocFolder} of ${total} clients (${pct(withDocFolder)}%) are flagged for a Documents Folder.`,
      action: withDocFolder > 0
        ? 'Set up Document Management to store and share client documents securely.'
        : 'Consider flagging clients who need secure document storage when reviewing client records.',
    },

    // ── SARS & CIPC Day Counter
    {
      name: 'SARS & CIPC Day Counter',
      description: 'Countdown timers for SARS submission deadlines and CIPC annual return due dates.',
      score: Math.min(100, pct(withIncomeTax + withProvisionalTax + withCipc)),
      relevance: toRelevance(Math.min(100, pct(withIncomeTax + withProvisionalTax + withCipc))),
      evidence: `${withIncomeTax} clients on Income Tax, ${withProvisionalTax} on Provisional Tax, ${withCipc} on CIPC Annual Return.`,
      action: (withIncomeTax + withProvisionalTax + withCipc) > 0
        ? 'Activate SARS & CIPC Day Counter to never miss a submission deadline.'
        : 'Not yet applicable — add tax and CIPC services to client records to benefit from this feature.',
    },

    // ── Upselling to Clients
    {
      name: 'Upselling to Clients',
      description: 'Identify clients using fewer services than typical — spot upsell opportunities.',
      score: Math.min(100, pct(upsellCandidates) * 1.5),
      relevance: toRelevance(Math.min(100, pct(upsellCandidates) * 1.5)),
      evidence: `${upsellCandidates} Active clients (${pct(upsellCandidates)}%) currently have fewer than 3 services — potential upsell opportunity.`,
      action: upsellCandidates > 0
        ? `Review the ${upsellCandidates} under-serviced clients. Consider whether VAT, Payroll or Income Tax could benefit them.`
        : 'Your clients are well-serviced. Use this feature to monitor as the client base grows.',
    },

    // ── To-Do List Dashboard
    {
      name: 'To-Do List Dashboard',
      description: 'Assign and track tasks per client across all staff members.',
      score: Math.min(100, 40 + (employees.length > 0 ? 40 : 0) + (total > 20 ? 20 : 0)),
      relevance: toRelevance(Math.min(100, 40 + (employees.length > 0 ? 40 : 0) + (total > 20 ? 20 : 0))),
      evidence: `${employees.length} staff members on record, managing ${total} clients.`,
      action: employees.length > 1
        ? 'Use the To-Do Dashboard to distribute and track work across your team.'
        : 'Set up staff records in DataGrows before activating the To-Do Dashboard.',
    },

    // ── Automated Timekeeping
    {
      name: 'Automated Timekeeping',
      description: 'Track billable hours per client and per service automatically from task completions.',
      score: Math.min(100, (employees.length > 0 ? 40 : 0) + ((withVat + withPayroll + withIncomeTax) > total * 0.5 ? 40 : 20)),
      relevance: toRelevance(Math.min(100, (employees.length > 0 ? 40 : 0) + ((withVat + withPayroll + withIncomeTax) > total * 0.5 ? 40 : 20))),
      evidence: `${employees.length} staff, ${withVat + withPayroll + withIncomeTax} clients with recurring billable services.`,
      action: employees.length > 2
        ? 'Automate timekeeping to improve billing accuracy and staff utilisation visibility.'
        : 'Relevant once you have 3+ staff members actively managing client work.',
    },

    // ── Share Registers
    {
      name: 'Share Registers',
      description: 'Maintain digital share registers for Pty Ltd, PLC, and Public Company clients.',
      score: Math.min(100, pct(withShares) * 1.8),
      relevance: toRelevance(Math.min(100, pct(withShares) * 1.8)),
      evidence: `${withShares} of your ${total} clients (${pct(withShares)}%) are registered companies (Pty Ltd, PLC, etc.).`,
      action: withShares > 0
        ? `Activate Share Registers for your ${withShares} registered entities to stay compliant.`
        : 'No registered company clients currently. Activate when you onboard Pty Ltd or PLC clients.',
    },

    // ── CIPC Beneficial Ownership
    {
      name: 'CIPC Beneficial Ownership',
      description: 'Track and submit Beneficial Ownership declarations for registered companies.',
      score: Math.min(100, pct(withCipc) * 2),
      relevance: toRelevance(Math.min(100, pct(withCipc) * 2)),
      evidence: `${withCipc} clients are on CIPC Annual Return — all are subject to Beneficial Ownership requirements.`,
      action: withCipc > 0
        ? `Required by law for all ${withCipc} CIPC clients. Activate immediately to avoid penalties.`
        : 'Not yet applicable — add CIPC Annual Return service to relevant clients.',
    },

    // ── Upskill Your Team
    {
      name: 'Upskill Your Team',
      description: 'DataGrows training and certification resources for your accounting staff.',
      score: Math.min(100, (employees.length > 0 ? 50 : 20) + (roleTypes.size > 3 ? 30 : 10)),
      relevance: toRelevance(Math.min(100, (employees.length > 0 ? 50 : 20) + (roleTypes.size > 3 ? 30 : 10))),
      evidence: `${employees.length} staff members covering ${roleTypes.size} different role types in DataGrows.`,
      action: employees.length > 0
        ? 'Invest in DataGrows training to maximise the platform\'s value across your team.'
        : 'Add staff to DataGrows and invest in training to unlock the full feature set.',
    },

    // ── PAYE / Payroll reporting
    {
      name: 'EMP201 & EMP501 Submissions',
      description: 'Automated generation and tracking of SARS PAYE submissions for payroll clients.',
      score: Math.min(100, pct(withPaye) * 1.5),
      relevance: toRelevance(Math.min(100, pct(withPaye) * 1.5)),
      evidence: `${withPaye} of ${total} clients (${pct(withPaye)}%) have a PAYE number.`,
      action: withPaye > 0
        ? `Automate EMP201 and EMP501 tracking for your ${withPaye} payroll clients.`
        : 'Not yet applicable — relevant once you have payroll clients with PAYE numbers.',
    },
  ];

  // Sort by score descending
  return features.sort((a, b) => b.score - a.score);
}

// ── Main generator ────────────────────────────────────────────────────────────

export async function generateFeaturesRecommendations(
  opts: FeaturesRecommendationsOptions,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Woza La';
  wb.created = new Date();

  const ws = wb.addWorksheet('DataGrows Features');

  const features = scoreFeatures(opts.clusters, opts.employees);

  // Column widths
  ws.columns = [
    { key: 'feature',    width: 30 },
    { key: 'relevance',  width: 12 },
    { key: 'score',      width: 10 },
    { key: 'evidence',   width: 65 },
    { key: 'action',     width: 65 },
    { key: 'description', width: 55 },
  ];

  // Title row
  const titleRow = ws.addRow([`DataGrows Feature Recommendations — ${opts.firmName} · Data Analysis`]);
  titleRow.getCell(1).font = { bold: true, size: 15, color: { argb: `FF${NAVY}` } };
  ws.mergeCells('A1:F1');

  const dateRow = ws.addRow([
    `Generated ${new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}${opts.generatedBy ? ` by ${opts.generatedBy}` : ''}  |  Rule-based data analysis`,
  ]);
  dateRow.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
  ws.mergeCells('A2:F2');
  ws.addRow([]);

  // Header row
  const hRow = ws.addRow(['Feature', 'Relevance', 'Score', 'Evidence from Your Data', 'Recommended Action', 'Description']);
  hRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: `FF${WHITE}` } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
    cell.alignment = { vertical: 'top', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: `FF${TEAL}` } } };
  });

  // Feature rows
  for (const f of features) {
    const row = ws.addRow([f.name, f.relevance, f.score, f.evidence, f.action, f.description]);

    // Relevance cell colour
    const relCell = row.getCell(2);
    if (f.relevance === 'High') {
      relCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN_BG}` } };
      relCell.font = { bold: true, color: { argb: `FF${GREEN_TEXT}` } };
    } else if (f.relevance === 'Medium') {
      relCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AMBER_BG}` } };
      relCell.font = { bold: true, color: { argb: `FF${AMBER_TEXT}` } };
    } else {
      relCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREY_BG}` } };
      relCell.font = { color: { argb: `FF${GREY_TEXT}` } };
    }

    // Score cell — progress-bar style (bold number)
    const scoreCell = row.getCell(3);
    scoreCell.font = { bold: true };
    if (f.score >= 60) scoreCell.font = { bold: true, color: { argb: `FF${GREEN_TEXT}` } };
    else if (f.score >= 30) scoreCell.font = { bold: true, color: { argb: `FF${AMBER_TEXT}` } };
    else scoreCell.font = { bold: true, color: { argb: `FF${GREY_TEXT}` } };

    // Wrap text on evidence and action
    row.getCell(1).font = { bold: true };
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
    row.height = 60;
  }

  // Freeze header rows
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
