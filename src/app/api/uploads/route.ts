/**
 * POST /api/uploads
 * Receives parsed spreadsheet data and file metadata from the client,
 * writes to uploads + raw_records using the service-role client (bypasses RLS).
 *
 * The actual file is uploaded directly to Supabase Storage from the browser.
 * This route only handles the database side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeSourceType } from '@/lib/normalizers/source-type';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UploadPayload {
  sessionId: string;
  sourceType: string;
  fileName: string;
  storagePath: string;
  rowCount: number | null;
  detectedColumns: string[] | null;
  rows: Record<string, unknown>[] | null;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as UploadPayload;
  const { sessionId, sourceType, fileName, storagePath, rowCount, detectedColumns, rows } = body;

  if (!sessionId || !sourceType || !fileName || !storagePath) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // ── Ownership check ───────────────────────────────────────────────────────
  const { validateSessionAccess, accessErrorResponse } = await import('@/lib/auth/validate-session-access');
  const { logAuditEvent } = await import('@/lib/auth/audit');
  let access;
  try { access = await validateSessionAccess(sessionId); }
  catch (err) { return accessErrorResponse(err); }
  void logAuditEvent({ userId: access.userId, firmId: access.firmId, action: 'upload', resourceType: 'upload', resourceId: sessionId, detail: { fileName }, request: req });

  // Normalize the source type before any DB insert
  let normalized: Awaited<ReturnType<typeof normalizeSourceType>>;
  try {
    normalized = await normalizeSourceType(sourceType);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid source type' },
      { status: 422 },
    );
  }

  const supabase = createServiceClient();

  // Insert uploads row
  const { data: uploadRow, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      session_id: sessionId,
      source_type: normalized.sourceType,
      source_raw: normalized.sourceRaw,
      file_name: fileName,
      storage_path: storagePath,
      row_count: rowCount ?? null,
      detected_columns: detectedColumns ?? null,
    })
    .select()
    .single();

  if (uploadErr || !uploadRow) {
    return NextResponse.json(
      { error: uploadErr?.message ?? 'Failed to save upload record' },
      { status: 500 },
    );
  }

  // Insert raw_records in chunks of 500 (only for spreadsheets)
  if (rows && rows.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((row, idx) => ({
        upload_id: uploadRow.id,
        row_index: i + idx,
        data: row,
      }));
      const { error: rawErr } = await supabase.from('raw_records').insert(chunk);
      if (rawErr) {
        return NextResponse.json(
          { error: rawErr.message ?? 'Failed to save records' },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ uploadId: uploadRow.id });
}
