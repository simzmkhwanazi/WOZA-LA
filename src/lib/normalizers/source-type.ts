/**
 * Source-type normalization.
 *
 * Pipeline:
 *   1. Deterministic map   — fast, exact match on trimmed/lowercased input
 *   2. AI fallback         — Claude classifies anything the map misses
 *   3. Final validation    — rejects if still not a valid enum value
 *
 * Never modifies the DB constraint — the normalised value is always one of
 * the allowed enum values before any INSERT.
 */

import type { SourceType } from '@/lib/schema/sources';

// ── Canonical allowed values (must match DB check constraint exactly) ──────────

export const VALID_SOURCE_TYPES = new Set<SourceType>([
  'cipc',
  'sars',
  'sage',
  'xero',
  'excel',
  'employees',
  'company',
]);

// ── Deterministic map ─────────────────────────────────────────────────────────
// Keys are lowercase + trimmed. Add more aliases here as needed.

const DETERMINISTIC_MAP: Record<string, SourceType> = {
  // company
  'company':                    'company',
  'company details':            'company',
  'company detail':             'company',
  'company info':               'company',
  'company information':        'company',
  'company docs':               'company',
  'company documents':          'company',
  'company profile':            'company',
  'firm details':               'company',
  'firm profile':               'company',
  'firm info':                  'company',
  'firm information':           'company',
  'service provider':           'company',
  'service provider profile':   'company',
  'registration details':       'company',
  'profile':                    'company',
  'letterhead':                 'company',
  'registration certificate':   'company',

  // cipc
  'cipc':                               'cipc',
  'company registration':               'cipc',
  'companies and intellectual property commission': 'cipc',
  'annual return':                      'cipc',
  'annual returns':                     'cipc',
  'cipc filing':                        'cipc',
  'cipc data':                          'cipc',
  'cipc export':                        'cipc',

  // sars
  'sars':                       'sars',
  'tax':                        'sars',
  'efiling':                    'sars',
  'e-filing':                   'sars',
  'south african revenue service': 'sars',
  'tax certificate':            'sars',
  'tax certificates':           'sars',
  'tax numbers':                'sars',
  'tax number':                 'sars',
  'sars export':                'sars',
  'sars data':                  'sars',
  'tax records':                'sars',

  // sage
  'sage':                       'sage',
  'sage accounting':            'sage',
  'sage one':                   'sage',
  'sage pastel':                'sage',
  'sage 50':                    'sage',
  'sage 200':                   'sage',
  'sage export':                'sage',
  'sage data':                  'sage',

  // xero
  'xero':                       'xero',
  'xero accounting':            'xero',
  'xero export':                'xero',
  'xero data':                  'xero',

  // excel / generic
  'excel':                      'excel',
  'manual excel':               'excel',
  'spreadsheet':                'excel',
  'manual spreadsheet':         'excel',
  'manual':                     'excel',
  'generic':                    'excel',
  'other':                      'excel',
  'misc':                       'excel',
  'miscellaneous':              'excel',
  'custom':                     'excel',

  // employees
  'employees':                  'employees',
  'employee list':              'employees',
  'employee listing':           'employees',
  'staff':                      'employees',
  'staff list':                 'employees',
  'staff listing':              'employees',
  'team':                       'employees',
  'team list':                  'employees',
  'personnel':                  'employees',
  'personnel list':             'employees',
  'hr':                         'employees',
  'hr list':                    'employees',
  'human resources':            'employees',
  'workers':                    'employees',
  'payroll':                    'employees',
  'payroll list':               'employees',
};

// ── Step 1: deterministic lookup ──────────────────────────────────────────────

function deterministicLookup(raw: string): SourceType | null {
  const key = raw.trim().toLowerCase();
  return DETERMINISTIC_MAP[key] ?? null;
}

// ── Step 2: AI fallback ───────────────────────────────────────────────────────

async function aiFallback(raw: string): Promise<SourceType | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const validList = [...VALID_SOURCE_TYPES].join(', ');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: `You are a classifier. Map the following upload source label to exactly one of these values: ${validList}.

Source label: "${raw}"

Rules:
- Reply with only the single matching value, nothing else.
- If the label is about company registration, filings or CIPC records → cipc
- If the label is about SARS, tax, eFiling → sars
- If the label is about Sage accounting software → sage
- If the label is about Xero accounting software → xero
- If the label is about employee, staff, personnel, payroll lists → employees
- If the label is about the firm's own company details, profile, registration docs → company
- For anything else → excel

Value:`,
        },
      ],
    }),
  });

  if (!res.ok) return null;

  const data = await res.json() as { content?: Array<{ type: string; text: string }> };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim().toLowerCase();
  if (!text) return null;

  // Extract just the first word in case the model adds anything extra
  const candidate = text.split(/\s/)[0] as SourceType;
  return VALID_SOURCE_TYPES.has(candidate) ? candidate : null;
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface NormalizeResult {
  sourceType: SourceType;
  sourceRaw: string;
  method: 'deterministic' | 'ai' | 'passthrough';
}

/**
 * Normalizes any raw string into a valid SourceType.
 * Throws if no valid mapping can be determined.
 */
export async function normalizeSourceType(raw: string): Promise<NormalizeResult> {
  const trimmed = raw.trim();

  // Passthrough: already a valid enum value
  if (VALID_SOURCE_TYPES.has(trimmed as SourceType)) {
    return { sourceType: trimmed as SourceType, sourceRaw: trimmed, method: 'passthrough' };
  }

  // Step 1: deterministic map
  const det = deterministicLookup(trimmed);
  if (det) {
    return { sourceType: det, sourceRaw: trimmed, method: 'deterministic' };
  }

  // Step 2: AI fallback
  const ai = await aiFallback(trimmed);
  if (ai) {
    return { sourceType: ai, sourceRaw: trimmed, method: 'ai' };
  }

  // Step 3: Final validation failure
  throw new Error(
    `Could not map "${trimmed}" to a valid source type. ` +
    `Allowed values: ${[...VALID_SOURCE_TYPES].join(', ')}.`,
  );
}
