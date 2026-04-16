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

// ── DataGrows features catalogue ───────────────────────────────────────────────

const DATAGROWS_FEATURES = [
  {
    name: 'Automated Emails',
    description:
      'Automatically send emails to clients for document requests, reminders, and status updates',
  },
  {
    name: 'Client Management',
    description:
      'Centralised client database with all key information, contacts, and service history',
  },
  {
    name: 'Workflow Automation',
    description:
      'Automate recurring tasks like VAT returns, payroll runs, and CIPC filings across the client portfolio',
  },
  {
    name: 'Real-Time Reporting',
    description:
      'Live dashboards showing work-in-progress, client status, and team performance metrics',
  },
  {
    name: 'Document Management',
    description:
      'Cloud-based document storage and retrieval linked directly to each client record',
  },
  {
    name: 'SARS and CIPC Day Counter',
    description:
      'Track SARS submission deadlines and CIPC annual return dates with automated countdown alerts',
  },
  {
    name: 'Upselling to Clients',
    description:
      "Identify cross-sell and upsell opportunities based on each client's profile and current services",
  },
  {
    name: 'To-Do List Dashboard',
    description:
      'Team-wide task management dashboard with priority ranking and deadline tracking per client',
  },
  {
    name: 'Automated Timekeeping Per Task',
    description:
      'Auto-log time spent on each client task for accurate billing and productivity reporting',
  },
  {
    name: 'Share Registers & Share Certificates',
    description:
      'Generate and maintain statutory share registers and share certificates for registered companies',
  },
  {
    name: 'CIPC Beneficial Ownership',
    description:
      'Manage, store and submit CIPC Beneficial Ownership declarations for registered entities',
  },
  {
    name: 'Upskill Your Entire Team',
    description:
      'In-app training modules and CPD tracking to grow the skills of the entire accounting team',
  },
] as const;

const SYSTEM_PROMPT = `You are a DataGrows feature relevance expert. DataGrows is a South African accounting SaaS platform used by accounting firms to manage their client portfolios.

Given a statistical profile of an accounting firm's client portfolio, recommend which DataGrows product features will deliver the most immediate value.

The 12 available DataGrows features are:
${DATAGROWS_FEATURES.map((f, i) => `${i + 1}. ${f.name} — ${f.description}`).join('\n')}

Return ONLY a valid JSON object — no explanation, no markdown, no code fences — with this exact structure:
{
  "urgent_features": [
    { "name": "Feature Name", "reason": "One sentence explaining why this is urgent given the specific portfolio data" }
  ],
  "nice_to_have_features": [
    { "name": "Feature Name", "reason": "One sentence explaining why this would benefit them" }
  ]
}

Rules:
- urgent_features: 3–5 features that should be activated immediately based on the portfolio data
- nice_to_have_features: 3–5 features that are beneficial but not immediately critical
- Only recommend features from the 12 listed above — do not invent new feature names
- Justify each recommendation with specifics from the data (e.g. "47 of 120 clients have VAT registration")
- Prioritise features that address the largest segments or highest compliance risk`;

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

function profileToText(p: PortfolioProfile): string {
  const entityLines = Object.entries(p.entityTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');

  const progLines = Object.entries(p.accountingPrograms)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');

  return `Firm: ${p.firmName}
Total clients: ${p.totalClients}
  Active: ${p.activeClients} | Dormant: ${p.dormantClients}

Entity types:
${entityLines || '  - (none recorded)'}

Tax & compliance registrations:
  - VAT-registered: ${p.vatClients}
  - PAYE-registered: ${p.payeClients}
  - CIPC registered entities: ${p.cipcClients}
  - Income tax clients: ${p.incomeTaxClients}
  - Provisional tax clients: ${p.provisionalTaxClients}

Services in use:
  - Payroll clients: ${p.payrollClients} (${p.totalEmployees} total employees)
  - Audit clients: ${p.auditClients}
  - EMP201 submissions: ${p.emp201Clients}
  - Document folder enabled: ${p.documentFolderClients}
  - Email clients via DataGrows: ${p.emailClients}

Accounting programs:
${progLines || '  - (none recorded)'}

Recommend which DataGrows features this accounting firm should prioritise activating.`;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as { sessionId?: string; staffId?: string };
  const { sessionId, staffId } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 500 },
    );
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

  // Build portfolio profile (include archived clients in the count — they're still part of the portfolio)
  const records: ClientRecord[] = allRecords.map((r) => r.merged);
  const profile = buildProfile(records, firmName);

  // Call Anthropic
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: profileToText(profile) }],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json().catch(() => ({})) as { error?: { message?: string } };
    return NextResponse.json(
      { error: err.error?.message ?? `Anthropic API error (${anthropicRes.status})` },
      { status: 500 },
    );
  }

  const anthropicData = await anthropicRes.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const rawText = anthropicData.content.find((c) => c.type === 'text')?.text ?? '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: 'AI returned an unexpected format. Please try again.' },
      { status: 500 },
    );
  }

  let result: { urgent_features: unknown[]; nice_to_have_features: unknown[] };
  try {
    result = JSON.parse(jsonMatch[0]);
  } catch {
    return NextResponse.json(
      { error: 'Failed to parse AI response. Please try again.' },
      { status: 500 },
    );
  }

  // Non-blocking log to Supabase
  (async () => {
    try {
      await supabase.from('feature_engine_logs').insert({
        staff_id: staffId ?? null,
        session_id: sessionId,
        portfolio_profile: profile,
        urgent_features: result.urgent_features,
        nice_to_have_features: result.nice_to_have_features,
        // Legacy columns — nullable after migration
        source_system: null,
        data_types: null,
      });
    } catch {
      console.error('[feature-engine] Failed to write log to Supabase');
    }
  })();

  return NextResponse.json({ ...result, profile });
}
