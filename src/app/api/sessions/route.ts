/**
 * POST /api/sessions
 * Creates a firm and a new session server-side.
 * Operator name is auto-detected from the logged-in user — no manual entry needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { firmName, operatorName: operatorOverride, notes } = await req.json() as {
    firmName?: string;
    operatorName?: string;
    notes?: string;
  };

  if (!firmName?.trim()) {
    return NextResponse.json({ error: 'Firm name is required' }, { status: 400 });
  }

  // Resolve the logged-in user for operator_name auto-detection
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  const operatorName =
    operatorOverride?.trim() ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email ||
    null;

  const supabase = createServiceClient();

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

  // Add the creating user as an admin member of this firm.
  // Without this, the user would be locked out of their own session
  // once tenant-filtered RLS is applied.
  if (user?.id) {
    await supabase
      .from('firm_members')
      .insert({ firm_id: firm.id, user_id: user.id, role: 'admin' })
      .throwOnError();
  }

  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .insert({
      firm_id: firm.id,
      status: 'uploading',
      operator_name: operatorName,
      notes: notes?.trim() || null,
    })
    .select()
    .single();

  if (sessErr || !session) {
    return NextResponse.json(
      { error: sessErr?.message ?? 'Failed to create session' },
      { status: 500 },
    );
  }

  // Log the session creation
  const { logAuditEvent } = await import('@/lib/auth/audit');
  if (user?.id) {
    void logAuditEvent({ userId: user.id, firmId: firm.id, action: 'view_session', resourceType: 'session', resourceId: session.id, request: req });
  }

  return NextResponse.json({ sessionId: session.id });
}
