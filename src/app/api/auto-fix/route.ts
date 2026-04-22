/**
 * POST /api/auto-fix
 *
 * Accepts { sessionId } — reads all clusters for the session, identifies
 * records with validation errors, and uses Claude Sonnet to suggest fixes
 * for each errored field.
 *
 * Only safe, deterministic fields are auto-applied:
 *   entity_type, status, year_end, registration_nr, vat_type, accounting_type,
 *   accounting_due_date, accounting_program, bank_statements
 *
 * Returns { fixed: number, clusters: Record<clusterId, patches> }
 * The caller (ExportStep / ReviewStep) can then persist the patches via
 * PATCH /api/clusters/[id] or display them as proposed changes.
 *
 * Uses claude-sonnet-4-6 — the stronger model — because fixing errors
 * requires understanding context, not just pattern-matching headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { validateRecord } from '@/lib/validator';
import type { ClientRecord } from '@/lib/schema/datagrows';
import {
  ENTITY_TYPES, STATUS_VALUES, MONTHS, VAT_TYPES,
  ACCOUNTING_TYPES, ACCOUNTING_DUE_DATES, ACCOUNTING_PROGRAMS,
  BANK_STATEMENTS,
} from '@/lib/schema/datagrows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Fields allowed for AI auto-correction ────────────────────────────────────
// Only enum/controlled fields. Free-text names, IDs, dates are NOT touched.

const FIXABLE_FIELDS = new Set([
  'entity_type',
  'status',
  'year_end',
  'accounting_start_month',
  'audit_due_month',
  'vat_type',
  'accounting_type',
  'accounting_due_date',
  'accounting_program',
  'bank_statements',
]);

const ALLOWED_VALUES: Record<string, readonly string[]> = {
  entity_type: ENTITY_TYPES,
  status: STATUS_VALUES,
  year_end: MONTHS,
  accounting_start_month: MONTHS,
  audit_due_month: MONTHS,
  vat_type: VAT_TYPES,
  accounting_type: ACCOUNTING_TYPES,
  accounting_due_date: ACCOUNTING_DUE_DATES,
  accounting_program: ACCOUNTING_PROGRAMS,
  bank_statements: BANK_STATEMENTS,
};

const SYSTEM_PROMPT = `You are a data-quality assistant for a South African accounting firm onboarding tool.

You receive a client record that has failed validation. For each field that has an invalid or missing value, suggest the most likely correct value from the allowed list.

Rules:
- Return ONLY a valid JSON object — no explanation, no markdown, no code fences.
- Keys are field names, values are the corrected values (strings only).
- Only suggest corrections for the fields listed in "Fields to fix".
- Only choose from the "Allowed values" list provided per field.
- If you cannot determine the correct value with confidence, omit the field entirely.
- Use the client name, registration number, and any other context clues available.`;

export async function POST(req: NextRequest) {
  const body = await req.json() as { sessionId?: string };
  const { sessionId } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  const { validateSessionAccess, accessErrorResponse } = await import('@/lib/auth/validate-session-access');
  const { logAuditEvent } = await import('@/lib/auth/audit');
  let access;
  try { access = await validateSessionAccess(sessionId); }
  catch (err) { return accessErrorResponse(err); }
  void logAuditEvent({ userId: access.userId, firmId: access.firmId, action: 'auto_fix', resourceType: 'session', resourceId: sessionId, request: req });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  const supabase = createServiceClient();

  const { data: clusters, error } = await supabase
    .from('clusters')
    .select('id, merged, archived')
    .eq('session_id', sessionId)
    .eq('archived', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!clusters || clusters.length === 0) {
    return NextResponse.json({ fixed: 0, patches: {} });
  }

  // Identify records with errors in fixable fields
  type ClusterRow = { id: string; merged: ClientRecord; archived: boolean };
  const needsFix = (clusters as ClusterRow[]).filter((c) => {
    const result = validateRecord(c.merged);
    return !result.ok && result.issues.some(
      (i) => i.severity === 'error' && FIXABLE_FIELDS.has(i.field),
    );
  });

  if (needsFix.length === 0) {
    return NextResponse.json({ fixed: 0, patches: {} });
  }

  // Process in batches of 10 to avoid token limits
  const BATCH_SIZE = 10;
  const allPatches: Record<string, Record<string, string>> = {};
  let fixedCount = 0;

  for (let i = 0; i < needsFix.length; i += BATCH_SIZE) {
    const batch = needsFix.slice(i, i + BATCH_SIZE);

    for (const cluster of batch) {
      const result = validateRecord(cluster.merged);
      const fixableIssues = result.issues.filter(
        (is) => is.severity === 'error' && FIXABLE_FIELDS.has(is.field),
      );

      if (fixableIssues.length === 0) continue;

      // Build context for this record
      const rec = cluster.merged;
      const contextLines: string[] = [
        `Client Name: ${rec.client_name ?? '(unknown)'}`,
        `Registration Nr: ${rec.registration_nr ?? '(none)'}`,
        `ID Number: ${rec.id_number ?? '(none)'}`,
        `Entity Type (current): ${rec.entity_type ?? '(blank)'}`,
        `Status (current): ${rec.status ?? '(blank)'}`,
        `Year End (current): ${rec.year_end ?? '(blank)'}`,
      ];

      const fieldsToFix = fixableIssues.map((is) => {
        const allowed = ALLOWED_VALUES[is.field];
        return [
          `Field: ${is.field}`,
          `Current value: "${(rec as Record<string, unknown>)[is.field] ?? ''}"`,
          `Error: ${is.message}`,
          `Allowed values: ${allowed ? allowed.join(', ') : 'any string'}`,
        ].join('\n');
      }).join('\n\n');

      const userMessage = [
        'Client record context:',
        ...contextLines,
        '',
        'Fields to fix:',
        fieldsToFix,
      ].join('\n');

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
            max_tokens: 256,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
          }),
        });

        if (!res.ok) continue;

        const data = await res.json() as { content: Array<{ type: string; text: string }> };
        const rawText = data.content.find((c) => c.type === 'text')?.text ?? '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const suggested = JSON.parse(jsonMatch[0]) as Record<string, string>;

        // Validate suggested values against allowed lists
        const validatedPatch: Record<string, string> = {};
        for (const [field, value] of Object.entries(suggested)) {
          if (!FIXABLE_FIELDS.has(field)) continue;
          const allowed = ALLOWED_VALUES[field];
          if (allowed && !allowed.includes(value)) continue;
          validatedPatch[field] = value;
        }

        if (Object.keys(validatedPatch).length > 0) {
          allPatches[cluster.id] = validatedPatch;
          fixedCount++;
        }
      } catch {
        // Individual record failed — continue with the rest
        console.error(`[auto-fix] Failed to process cluster ${cluster.id}`);
      }
    }
  }

  // Apply patches to clusters in Supabase
  for (const [clusterId, patch] of Object.entries(allPatches)) {
    const existing = (clusters as ClusterRow[]).find((c) => c.id === clusterId);
    if (!existing) continue;

    const updatedMerged = { ...existing.merged, ...patch };
    await supabase
      .from('clusters')
      .update({ merged: updatedMerged, auto_fixed: true })
      .eq('id', clusterId);
  }

  return NextResponse.json({
    fixed: fixedCount,
    patches: allPatches,
  });
}
