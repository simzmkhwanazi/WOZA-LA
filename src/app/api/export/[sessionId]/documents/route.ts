/**
 * GET /api/export/[sessionId]/documents
 *
 * Returns the list of previously generated documents for a session, with
 * signed download URLs from Supabase Storage (if stored) or a re-download
 * trigger URL otherwise.
 *
 * Response:
 * {
 *   documents: Array<{
 *     id: string;
 *     document_type: 'datagrows' | 'archived' | 'firm_excel' | 'firm_pdf' | 'features_pdf';
 *     version: number;
 *     file_name: string | null;
 *     generated_by: string | null;
 *     created_at: string;
 *     download_url: string | null;
 *   }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DocumentRow {
  id: string;
  document_type: string;
  version: number;
  file_name: string | null;
  storage_path: string | null;
  generated_by: string | null;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  const { validateSessionAccess, accessErrorResponse } = await import('@/lib/auth/validate-session-access');
  const { logAuditEvent } = await import('@/lib/auth/audit');
  let access;
  try { access = await validateSessionAccess(sessionId); }
  catch (err) { return accessErrorResponse(err); }
  void logAuditEvent({ userId: access.userId, firmId: access.firmId, action: 'view_session', resourceType: 'document', resourceId: sessionId, request: req });

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('generated_documents')
    .select('id, document_type, version, file_name, storage_path, generated_by, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as DocumentRow[];

  // Generate signed download URLs for documents stored in Supabase Storage
  const documents = await Promise.all(
    rows.map(async (row) => {
      let download_url: string | null = null;

      if (row.storage_path) {
        const { data: signed } = await supabase.storage
          .from('documents')
          .createSignedUrl(row.storage_path, 60 * 60); // 1-hour expiry
        download_url = signed?.signedUrl ?? null;
      }

      return {
        id: row.id,
        document_type: row.document_type,
        version: row.version,
        file_name: row.file_name,
        generated_by: row.generated_by,
        created_at: row.created_at,
        download_url,
      };
    }),
  );

  return NextResponse.json({ documents });
}
