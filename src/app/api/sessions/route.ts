/**
 * POST /api/sessions
 * Creates a firm (upsert by name) and a new session in one server-side call.
 * Uses the service-role client to bypass RLS.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { firmName, operatorName } = await req.json() as {
    firmName?: string;
    operatorName?: string;
  };

  if (!firmName?.trim()) {
    return NextResponse.json({ error: 'Firm name is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Insert firm
  const { data: firm, error: firmErr } = await supabase
    .from('firms')
    .insert({ name: firmName.trim() })
    .select()
    .single();

  if (firmErr || !firm) {
    return NextResponse.json(
      { error: firmErr?.message ?? 'Failed to create firm' },
      { status: 500 },
    );
  }

  // Insert session
  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .insert({
      firm_id: firm.id,
      status: 'uploading',
      operator_name: operatorName?.trim() || null,
    })
    .select()
    .single();

  if (sessErr || !session) {
    return NextResponse.json(
      { error: sessErr?.message ?? 'Failed to create session' },
      { status: 500 },
    );
  }

  return NextResponse.json({ sessionId: session.id });
}
