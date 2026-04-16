/**
 * Export endpoint.
 *
 * GET /api/export/:sessionId?type=datagrows  → the DataGrows import xlsx
 * GET /api/export/:sessionId?type=archived   → the Archived-needs-followup report
 *
 * Reads all clusters for the session from Supabase (uses service client so RLS
 * doesn't block), pulls merged JSON, runs it through the server-side exporter,
 * and streams the resulting .xlsx back to the browser.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  exportToDataGrowsTemplate,
  exportArchiveReport,
} from '@/lib/exporter';
import type { ClientRecord } from '@/lib/schema/datagrows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClusterRow {
  id: string;
  merged: ClientRecord;
  sources: string[] | null;
  archived: boolean;
  archive_reason: string | null;
}

function safeFilename(firmName: string) {
  return firmName.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60) || 'firm';
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'datagrows';

  const supabase = createServiceClient();

  // Resolve firm name for filename
  const { data: session } = await supabase
    .from('sessions')
    .select('id, firms(name)')
    .eq('id', sessionId)
    .single();

  const firmRaw = session?.firms;
  const firm = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw;
  const firmName = safeFilename(firm?.name ?? 'firm');

  // Pull all clusters for the session
  const { data: clusters, error } = await supabase
    .from('clusters')
    .select('id, merged, sources, archived, archive_reason')
    .eq('session_id', sessionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (clusters ?? []) as ClusterRow[];

  // Decorate each merged record with the metadata fields the exporter looks at
  const records: ClientRecord[] = rows.map((r) => ({
    ...r.merged,
    _sources: r.sources ?? [],
    _archived: r.archived,
    _archive_reason: r.archive_reason ?? undefined,
  }));

  try {
    if (type === 'archived') {
      const { buffer, rows: n } = await exportArchiveReport({ records });
      // Mark session exported at this point? No — only for the main one.
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${firmName}_archived_report.xlsx"`,
          'X-Row-Count': String(n),
        },
      });
    }

    const { buffer, rowsWritten, skippedArchived } = await exportToDataGrowsTemplate({
      records,
      stripInstructions: true,
    });

    // Flag the session as exported (idempotent — we always allow re-export)
    await supabase.from('sessions').update({ status: 'exported' }).eq('id', sessionId);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${firmName}_datagrows_import.xlsx"`,
        'X-Rows-Written': String(rowsWritten),
        'X-Skipped-Archived': String(skippedArchived),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
