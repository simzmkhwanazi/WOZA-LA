/**
 * Audit logger — writes a record to audit_events for every sensitive action.
 * Uses the service-role client so it always succeeds regardless of RLS.
 * Never throws — a logging failure must never break the main request.
 */

import { createServiceClient } from '@/lib/supabase/server';

export type AuditAction =
  | 'login'
  | 'logout'
  | 'view_session'
  | 'upload'
  | 'export'
  | 'edit_cluster'
  | 'delete'
  | 'auto_fix'
  | 'run_pipeline';

export interface AuditParams {
  userId: string;
  firmId?: string;
  action: AuditAction;
  resourceType?: 'session' | 'upload' | 'cluster' | 'document';
  resourceId?: string;
  detail?: Record<string, unknown>;
  request?: Request;   // pass the incoming request to capture IP + user-agent
}

export async function logAuditEvent(params: AuditParams): Promise<void> {
  try {
    const service = createServiceClient();

    // Extract IP and user-agent from the request headers if available
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    if (params.request) {
      ipAddress =
        params.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        params.request.headers.get('x-real-ip') ??
        null;
      userAgent = params.request.headers.get('user-agent') ?? null;
    }

    await service.from('audit_events').insert({
      user_id:       params.userId,
      firm_id:       params.firmId ?? null,
      action:        params.action,
      resource_type: params.resourceType ?? null,
      resource_id:   params.resourceId ?? null,
      detail:        params.detail ?? null,
      ip_address:    ipAddress,
      user_agent:    userAgent,
    });
  } catch (err) {
    // Log to server console but never crash the request
    console.error('[audit] failed to write audit event:', err);
  }
}
