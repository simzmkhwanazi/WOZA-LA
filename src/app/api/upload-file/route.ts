/**
 * POST /api/upload-file
 * Accepts multipart FormData with a `file` field and a `storagePath` field.
 * Saves the file to data/uploads/<storagePath> and returns { storagePath }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { UPLOADS_DIR } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const storagePath = form.get('storagePath') as string | null;

    if (!file || !storagePath) {
      return NextResponse.json({ error: 'Missing file or storagePath' }, { status: 400 });
    }

    const destPath = path.join(UPLOADS_DIR, storagePath);
    await mkdir(path.dirname(destPath), { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(destPath, buffer);

    return NextResponse.json({ storagePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
