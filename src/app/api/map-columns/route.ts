/**
 * POST /api/map-columns
 *
 * Accepts { sessionId, uploadId, headers: string[] }
 * 1. Runs deterministic heuristics first (fast, free).
 * 2. For any header still unmapped, calls Claude Haiku to suggest a field key.
 * 3. Returns { mapping: Record<header, fieldKey|null>, confidence: Record<header, 'heuristic'|'ai'|'none'> }
 *
 * The client can call this on page-load or on-demand; the result is used to
 * pre-populate column mapping choices. The human never has to touch it if
 * confidence is high.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initialMapping, fieldOptions } from '@/lib/parsers/mapping-heuristics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a column-mapping assistant for a South African accounting firm onboarding tool.

Given a list of column headers from a firm's internal spreadsheet, suggest which canonical DataGrows field key each header should map to.

The canonical fields are:
{{FIELDS_LIST}}

Rules:
- Return ONLY a valid JSON object — no explanation, no markdown, no code fences.
- Keys are the detected column headers (exactly as provided).
- Values are the canonical field key (snake_case) or null if no reasonable match exists.
- Never invent field keys — only use the canonical keys listed above.
- Prefer specific matches over generic ones.`;

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    sessionId?: string;
    uploadId?: string;
    headers?: string[];
  };

  const { sessionId, headers } = body;
  if (!Array.isArray(headers) || headers.length === 0) {
    return NextResponse.json({ error: 'headers array is required' }, { status: 400 });
  }


  // Step 1 — deterministic heuristics
  const heuristicMapping = initialMapping(headers);

  const mapping: Record<string, string | null> = {};
  const confidence: Record<string, 'heuristic' | 'ai' | 'none'> = {};

  for (const h of headers) {
    const hval = heuristicMapping[h];
    mapping[h] = hval ?? null;
    confidence[h] = hval ? 'heuristic' : 'none';
  }

  // Step 2 — AI fallback for unmapped headers
  const unmapped = headers.filter((h) => mapping[h] === null);

  if (unmapped.length > 0) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const fields = fieldOptions();
        const fieldsList = fields
          .map((f) => `${f.key} — "${f.header}" (${f.type})`)
          .join('\n');

        const systemPrompt = SYSTEM_PROMPT.replace('{{FIELDS_LIST}}', fieldsList);

        const userMessage = `Map these column headers to canonical field keys:\n${unmapped.map((h) => `- "${h}"`).join('\n')}`;

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
          }),
        });

        if (res.ok) {
          const data = await res.json() as { content: Array<{ type: string; text: string }> };
          const rawText = data.content.find((c) => c.type === 'text')?.text ?? '';
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);

          if (jsonMatch) {
            const aiResult = JSON.parse(jsonMatch[0]) as Record<string, string | null>;
            const validKeys = new Set(fields.map((f) => f.key));

            for (const h of unmapped) {
              const suggested = aiResult[h];
              if (suggested && validKeys.has(suggested)) {
                mapping[h] = suggested;
                confidence[h] = 'ai';
              }
            }
          }
        }
      } catch {
        // AI failed — silently fall through with heuristic results
        console.error('[map-columns] AI fallback failed');
      }
    }
  }

  return NextResponse.json({ mapping, confidence });
}
