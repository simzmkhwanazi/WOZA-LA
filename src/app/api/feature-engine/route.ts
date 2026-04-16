/**
 * POST /api/feature-engine
 *
 * Accepts { sourceSystem, dataTypes, staffId? } from the client.
 * Calls the Anthropic API server-side (ANTHROPIC_API_KEY never leaves the server).
 * Returns { urgent_features, nice_to_have_features }.
 * Fires a non-blocking log to feature_engine_logs in Supabase.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a DataGrows feature relevance expert. DataGrows is a South African accounting SaaS platform. Given a client's source accounting system and the data types being imported, identify which DataGrows product features are most relevant to enable for that client.

Return ONLY a valid JSON object — no explanation, no markdown, no code fences — with this exact structure:
{
  "urgent_features": [
    { "name": "Feature Name", "reason": "One sentence explaining why this is urgent given their data" }
  ],
  "nice_to_have_features": [
    { "name": "Feature Name", "reason": "One sentence explaining why this would benefit them" }
  ]
}

Rules:
- urgent_features: 3–5 features that should be activated immediately given what data is available
- nice_to_have_features: 3–5 features that are beneficial but not critical
- Be specific to the source system and data types provided
- Focus on practical DataGrows features: billing, VAT returns, payroll runs, CIPC compliance, financial reporting, bank reconciliation, tax submissions, document management, client portal, etc.`;

export async function POST(req: NextRequest) {
  const body = await req.json() as { sourceSystem?: string; dataTypes?: string[]; staffId?: string };
  const { sourceSystem, dataTypes, staffId } = body;

  if (!sourceSystem || !dataTypes?.length) {
    return NextResponse.json(
      { error: 'sourceSystem and dataTypes are required' },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  // ── Call Anthropic ─────────────────────────────────────────────────────────
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
      messages: [
        {
          role: 'user',
          content: `Source system: ${sourceSystem}\nData types imported: ${dataTypes.join(', ')}\n\nIdentify the most relevant DataGrows features for this client.`,
        },
      ],
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

  // Extract JSON from the response (handle any accidental wrapping)
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

  // ── Non-blocking log to Supabase ───────────────────────────────────────────
  (async () => {
    try {
      const supabase = createServiceClient();
      await supabase.from('feature_engine_logs').insert({
        staff_id: staffId ?? null,
        source_system: sourceSystem,
        data_types: dataTypes,
        urgent_features: result.urgent_features,
        nice_to_have_features: result.nice_to_have_features,
      });
    } catch {
      // Non-blocking — log failure must not surface to the user
      console.error('[feature-engine] Failed to write log to Supabase');
    }
  })();

  return NextResponse.json(result);
}
