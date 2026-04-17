/**
 * POST /api/feature-engine
 *
 * Accepts { sessionId, staffId? } from the client.
 * Pulls all merged clusters for the session from Supabase.
 * Builds a statistical portfolio profile from the cluster data.
 * Calls Anthropic to recommend from the 12 real DataGrows product features.
 * Returns { urgent_features, nice_to_have_features, profile }.
 * Fires a non-blocking log to feature_engine_logs in Supabase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import type { ClientRecord } from '@/lib/schema/datagrows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Profile extraction ─────────────────────────────────────────────────────────

function isTrue(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toUpperCase() === 'TRUE';
  return false;
}

function isTruthy(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && v !== false && v !== 'FALSE';
}

interface PortfolioProfile {
  firmName: string;
  totalClients: number;
  activeClients: number;
  dormantClients: number;
  entityTypeCounts: Record<string, number>;
  vatClients: number;
  payeClients: number;
  payrollClients: number;
  totalEmployees: number;
  cipcClients: number;
  incomeTaxClients: number;
  provisionalTaxClients: number;
  auditClients: number;
  documentFolderClients: number;
  emailClients: number;
  emp201Clients: number;
  accountingPrograms: Record<string, number>;
}

function buildProfile(records: ClientRecord[], firmName: string): PortfolioProfile {
  const profile: PortfolioProfile = {
    firmName,
    totalClients: records.length,
    activeClients: 0,
    dormantClients: 0,
    entityTypeCounts: {},
    vatClients: 0,
    payeClients: 0,
    payrollClients: 0,
    totalEmployees: 0,
    cipcClients: 0,
    incomeTaxClients: 0,
    provisionalTaxClients: 0,
    auditClients: 0,
    documentFolderClients: 0,
    emailClients: 0,
    emp201Clients: 0,
    accountingPrograms: {},
  };

  for (const rec of records) {
    const status = String(rec.status ?? '').toLowerCase();
    if (status === 'active') profile.activeClients++;
    if (status === 'dormant') profile.dormantClients++;

    const et = String(rec.entity_type ?? '');
    if (et) profile.entityTypeCounts[et] = (profile.entityTypeCounts[et] ?? 0) + 1;

    if (isTruthy(rec.vat_nr) || isTrue(rec.vat)) profile.vatClients++;
    if (isTruthy(rec.paye_nr)) profile.payeClients++;
    if (isTrue(rec.payroll)) profile.payrollClients++;

    const emp = Number(rec.nr_of_employees);
    if (!isNaN(emp)) profile.totalEmployees += emp;

    if (isTruthy(rec.registration_nr) || isTrue(rec.cipc_annual_return))
      profile.cipcClients++;

    if (isTrue(rec.income_tax)) profile.incomeTaxClients++;
    if (isTrue(rec.provisional_tax)) profile.provisionalTaxClients++;
    if (isTrue(rec.audit)) profile.auditClients++;
    if (isTrue(rec.documents_folder)) profile.documentFolderClients++;
    if (isTrue(rec.email_client_from_dg)) profile.emailClients++;
    if (isTrue(rec.emp201)) profile.emp201Clients++;

    const prog = String(rec.accounting_program ?? '');
    if (prog) profile.accountingPrograms[prog] = (profile.accountingPrograms[prog] ?? 0) + 1;
  }

  return profile;
}

// ── Rule-based feature scoring ─────────────────────────────────────────────────

interface ScoredFeature {
  name: string;
  score: number;
  evidence: string;
  action: string;
}

function scoreFeatures(profile: PortfolioProfile): ScoredFeature[] {
  const t = profile.totalClients || 1;
  const pct = (n: number) => Math.round((n / t) * 100);

  const vatPct   = pct(profile.vatClients);
  const payePct  = pct(profile.payeClients);
  const cipcPct  = pct(profile.cipcClients);

  const features: ScoredFeature[] = [
    {
      name: 'SARS and CIPC Day Counter',
      score: Math.min(95, 35 + Math.round((profile.vatClients + profile.cipcClients) / (t * 2) * 65)),
      evidence: `${profile.vatClients} VAT-registered clients (${vatPct}%) and ${profile.cipcClients} CIPC-registered entities (${cipcPct}%) face regular submission deadlines.`,
      action: 'Activate the Day Counter immediately to track SARS and CIPC due dates and eliminate missed submissions.',
    },
    {
      name: 'CIPC Beneficial Ownership',
      score: Math.min(90, 15 + Math.round(profile.cipcClients / t * 80)),
      evidence: `${profile.cipcClients} of ${t} clients (${cipcPct}%) are registered entities subject to Beneficial Ownership requirements.`,
      action: cipcPct > 0
        ? `Required by law — activate Beneficial Ownership management for all ${profile.cipcClients} CIPC clients to avoid penalties.`
        : 'Not yet applicable — activate when you onboard registered company clients.',
    },
    {
      name: 'Workflow Automation',
      score: Math.min(90, 25 + Math.round((profile.vatClients + profile.payeClients + profile.payrollClients) / (t * 3) * 75)),
      evidence: `${profile.vatClients} VAT, ${profile.payeClients} PAYE, and ${profile.payrollClients} payroll clients each need recurring processing every period.`,
      action: 'Automate VAT returns, payroll runs, and CIPC filings to reduce manual effort and compliance risk.',
    },
    {
      name: 'Client Management',
      score: Math.min(95, 45 + Math.min(50, Math.round(profile.activeClients / 4))),
      evidence: `${profile.activeClients} active clients across ${Object.keys(profile.entityTypeCounts).length} entity types require structured management.`,
      action: 'Centralise all client records, service history, and deadlines in DataGrows Client Management.',
    },
    {
      name: 'Automated Emails',
      score: Math.min(88, 30 + Math.min(58, Math.round(profile.activeClients / 3))),
      evidence: `${profile.activeClients} active clients require regular communication, document requests, and deadline reminders.`,
      action: 'Enable Automated Emails to send deadline alerts and document requests without manual follow-up.',
    },
    {
      name: 'Real-Time Reporting',
      score: Math.min(85, 30 + Math.min(55, Math.round(profile.totalClients / 5))),
      evidence: `${profile.totalClients} clients across ${Object.keys(profile.entityTypeCounts).length} entity types — partners need visibility into team workload and progress.`,
      action: 'Enable Real-Time Reporting dashboards for partners and managers to track work-in-progress.',
    },
    {
      name: 'Document Management',
      score: profile.documentFolderClients < t * 0.3 ? 78 : 42,
      evidence: `Only ${profile.documentFolderClients} of ${t} clients (${pct(profile.documentFolderClients)}%) have document folders enabled — the rest have no structured document storage.`,
      action: profile.documentFolderClients > 0
        ? 'Set up Document Management to store and share client documents securely against each record.'
        : 'Flag clients for document storage in their records, then activate Document Management.',
    },
    {
      name: 'Share Registers & Share Certificates',
      score: Math.min(80, 10 + Math.round(profile.cipcClients / t * 70)),
      evidence: `${profile.cipcClients} CIPC-registered entities (${cipcPct}%) may require statutory share registers and certificates.`,
      action: cipcPct > 0
        ? `Activate Share Registers for your ${profile.cipcClients} registered entities to maintain compliance.`
        : 'Activate when you onboard Pty Ltd or public company clients.',
    },
    {
      name: 'To-Do List Dashboard',
      score: Math.min(80, 28 + Math.min(52, Math.round(profile.activeClients / 5))),
      evidence: `${profile.activeClients} active clients generate significant task volume across the team.`,
      action: 'Distribute and track client tasks across staff using the To-Do Dashboard to prevent work slipping.',
    },
    {
      name: 'Automated Timekeeping Per Task',
      score: Math.min(72, 15 + Math.round((profile.payrollClients + profile.auditClients) / t * 65)),
      evidence: `${profile.payrollClients} payroll and ${profile.auditClients} audit clients are high time-cost engagements that require accurate billing.`,
      action: 'Enable Automated Timekeeping to auto-log hours per task and improve billing accuracy.',
    },
    {
      name: 'Upselling to Clients',
      score: Math.min(70, 18 + Math.round(profile.dormantClients / t * 35) + Math.round(profile.activeClients / t * 30)),
      evidence: `${profile.dormantClients} dormant and ${profile.activeClients} active clients represent cross-sell and reactivation opportunities.`,
      action: 'Identify under-serviced clients and use the Upselling feature to recommend additional services.',
    },
    {
      name: 'Upskill Your Entire Team',
      score: 42,
      evidence: `${profile.totalClients} clients across diverse service types (VAT: ${vatPct}%, PAYE: ${payePct}%) require ongoing staff competence.`,
      action: 'Run DataGrows in-app training modules and track CPD credits across your entire team.',
    },
  ];

  return features.sort((a, b) => b.score - a.score);
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as { sessionId?: string; staffId?: string };
  const { sessionId, staffId } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Resolve firm name
  const { data: session } = await supabase
    .from('sessions')
    .select('id, firms(name)')
    .eq('id', sessionId)
    .single();

  const firmRaw = session?.firms;
  const firm = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw;
  const firmName: string = firm?.name ?? 'this firm';

  // Pull all clusters for the session
  const { data: clusters, error: clusterErr } = await supabase
    .from('clusters')
    .select('merged, archived')
    .eq('session_id', sessionId);

  if (clusterErr) {
    return NextResponse.json({ error: clusterErr.message }, { status: 500 });
  }

  const allRecords = (clusters ?? []) as Array<{ merged: ClientRecord; archived: boolean }>;

  if (allRecords.length === 0) {
    return NextResponse.json(
      { error: 'No client data found for this session. Please complete the mapping step first.' },
      { status: 422 },
    );
  }

  // Build portfolio profile (include archived clients — they're still part of the portfolio)
  const records: ClientRecord[] = allRecords.map((r) => r.merged);
  const profile = buildProfile(records, firmName);

  // Score features using rule-based engine (no AI required)
  const scored = scoreFeatures(profile);

  const urgent_features = scored
    .filter((f) => f.score >= 60)
    .map((f) => ({ name: f.name, reason: `${f.evidence} ${f.action}` }));

  const nice_to_have_features = scored
    .filter((f) => f.score >= 30 && f.score < 60)
    .map((f) => ({ name: f.name, reason: `${f.evidence} ${f.action}` }));

  // Non-blocking log to Supabase
  (async () => {
    try {
      await supabase.from('feature_engine_logs').insert({
        staff_id: staffId ?? null,
        session_id: sessionId,
        portfolio_profile: profile,
        urgent_features,
        nice_to_have_features,
        source_system: null,
        data_types: null,
      });
    } catch {
      console.error('[feature-engine] Failed to write log to Supabase');
    }
  })();

  return NextResponse.json({ urgent_features, nice_to_have_features, profile });
}
