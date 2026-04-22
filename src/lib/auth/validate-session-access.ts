/**
 * Server-side ownership guard.
 *
 * Call this at the top of every API route that touches a sessionId.
 * Answers: "Is the logged-in user a member of the firm that owns this session?"
 *
 * If yes  → returns { userId, firmId, role }
 * If no   → throws an Error('UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND')
 */

import { createClient, createServiceClient } from '@/lib/supabase/server';

export interface SessionAccess {
  userId: string;
  firmId: string;
  role: 'admin' | 'operator' | 'viewer';
}

export async function validateSessionAccess(sessionId: string): Promise<SessionAccess> {
  // 1. Who is making the request?
  const authClient = await createClient();
  const { data: { user }, error: authError } = await authClient.auth.getUser();

  if (authError || !user) throw new Error('UNAUTHORIZED');

  // 2. Which firm owns this session?
  const service = createServiceClient();
  const { data: session, error: sessionError } = await service
    .from('sessions')
    .select('id, firm_id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) throw new Error('NOT_FOUND');

  // 3. Is this user a member of that firm?
  const { data: membership, error: memberError } = await service
    .from('firm_members')
    .select('role')
    .eq('firm_id', session.firm_id)
    .eq('user_id', user.id)
    .single();

  if (memberError || !membership) throw new Error('FORBIDDEN');

  return {
    userId: user.id,
    firmId: session.firm_id as string,
    role: membership.role as SessionAccess['role'],
  };
}

/** Maps thrown error codes to the correct HTTP Response. */
export function accessErrorResponse(err: unknown): Response {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'UNAUTHORIZED') return new Response('Unauthorized', { status: 401 });
  if (msg === 'FORBIDDEN')    return new Response('Forbidden',    { status: 403 });
  if (msg === 'NOT_FOUND')    return new Response('Not found',    { status: 404 });
  console.error('[auth] unexpected error:', err);
  return new Response('Internal server error', { status: 500 });
}
