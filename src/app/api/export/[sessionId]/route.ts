/**
 * Export endpoint.
 *
 * GET /api/export/:sessionId?type=datagrows  → the DataGrows import xlsx
 * GET /api/export/:sessionId?type=archived   → the Archived-needs-followup report
 *
 * Reads clusters directly from the local SQLite database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionWithFirm, getClusters, setSessionStatus } from '@/lib/db/queries';
import {
  exportToDataGrowsTemplate,
  exportArchiveReport,
} from '@/lib/exporter';
import type { ClientRecord } from '@/lib/schema/datagrows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeFilename(name: string) {
  return name.replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60) || 'firm';
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const url = new URL(req.url);
  const type = url.searchParams.get('type') ?? 'datagrows';

  const sessionInfo = getSessionWithFirm(sessionId);
  const firmName = safeFilename(sessionInfo?.firmName ?? 'firm');

  const clusterRows = getClusters(sessionId);

  const records: ClientRecord[] = clusterRows.map((r) => ({
    ...r.merged,
    _sources: r.sources,
    _archived: r.archived,
    _archive_reason: r.archive_reason ?? undefined,
  }));

  try {
    if (type === 'archived') {
      const { buffer, rows: n } = await exportArchiveReport({ records });
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${firmName}_archived_report.xlsx"`,
          'X-Row-Count': String(n),
        },
      });
    }

    const { buffer, rowsWritten, skippedArchived } = await exportToDataGrowsTemplate({
      records,
      stripInstructions: true,
    });

    setSessionStatus(sessionId, 'exported');

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
