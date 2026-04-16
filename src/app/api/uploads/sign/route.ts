/**
 * POST /api/uploads/sign
 * Returns a signed upload URL for Supabase Storage.
 * Uses the service-role key so no storage RLS policies are required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { sessionId, fileName } = await req.json() as { sessionId: string; fileName: string };

  if (!sessionId || !fileName) {
    return NextResponse.json({ error: 'Missing sessionId or fileName' }, { status: 400 });
  }

  const storagePath = `${sessionId}/${Date.now()}-${fileName}`;
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from('uploads')
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create signed URL' }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path: storagePath });
}
