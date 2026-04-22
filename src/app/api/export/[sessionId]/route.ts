/**
 * Export endpoint.
 *
 * GET /api/export/:sessionId?type=datagrows   → DataGrows import .xlsx
 * GET /api/export/:sessionId?type=archived    → Archived-needs-followup report .xlsx
 * GET /api/export/:sessionId?type=firm_excel  → Client Intelligence Report .xlsx (multi-sheet)
 * GET /api/export/:sessionId?type=firm_pdf    → Client Intelligence Report .pdf
 * GET /api/export/:sessionId?type=features_pdf → DataGrows Features Recommendations .xlsx
 *
 * All document types are versioned (v1, v2, v3…) and recorded in generated_documents.
 * The DataGrows export also updates sessions.last_exported_at, clearing re-export markers.
 *
 * Uses service client so RLS doesn't block server-side reads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  exportToDataGrowsTemplate,
  exportArchiveReport,
} from '@/lib/exporter';
import { generateFirmMasterfile } from '@/lib/exporter/firm-masterfile';
import { generatePdfReport } from '@/lib/exporter/pdf-report';
import { generateFeaturesRecommendations } from '@/lib/exporter/features-recommendations';
import type { ClientRecord } from '@/lib/schema/datagrows';
import type {
  FirmProfileRow,
  EmployeeRow,
  ContactRow,
  SupplierRow,
  ClusterRow as MasterfileClusterRow,
} from '@/lib/exporter/firm-masterfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ExportType = 'datagrows' | 'archived' | 'firm_excel' | 'firm_pdf' | 'features_pdf';

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

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

/** Auto-increment version per document_type per session */
async function nextVersion(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  documentType: string,
): Promise<number> {
  const { data } = await supabase
    .from('generated_documents')
    .select('version')
    .eq('session_id', sessionId)
    .eq('document_type', documentType)
    .order('version', { ascending: false })
    .limit(1);

  const maxVersion = (data ?? [])[0]?.version ?? 0;
  return maxVersion + 1;
}

/** Record a generated document in the generated_documents table */
async function recordDocument(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
  documentType: string,
  version: number,
  fileName: string,
  generatedBy: string | null,
  storagePath: string | null = null,
) {
  await supabase.from('generated_documents').insert({
    session_id: sessionId,
    document_type: documentType,
    version,
    file_name: fileName,
    storage_path: storagePath,
    generated_by: generatedBy,
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  const url = new URL(req.url);
  const type = (url.searchParams.get('type') ?? 'datagrows') as ExportType;

  const supabase = createServiceClient();

  // ── Resolve session + firm ────────────────────────────────────────────────

  const { data: session } = await supabase
    .from('sessions')
    .select('id, operator_name, firms(name)')
    .eq('id', sessionId)
    .single();

  const firmRaw = session?.firms;
  const firm = Array.isArray(firmRaw) ? firmRaw[0] : firmRaw;
  const firmName = firm?.name ?? 'firm';
  const safeName = safeFilename(firmName);
  const operatorName = session?.operator_name ?? null;

  // ── Pull clusters ─────────────────────────────────────────────────────────

  const { data: clusters, error: clusterErr } = await supabase
    .from('clusters')
    .select('id, merged, sources, archived, archive_reason')
    .eq('session_id', sessionId);

  if (clusterErr) {
    return NextResponse.json({ error: clusterErr.message }, { status: 500 });
  }

  const rows = (clusters ?? []) as ClusterRow[];

  // ── DataGrows Masterfile ──────────────────────────────────────────────────

  if (type === 'datagrows') {
    const records: ClientRecord[] = rows.map((r) => ({
      ...r.merged,
      _sources: r.sources ?? [],
      _archived: r.archived,
      _archive_reason: r.archive_reason ?? undefined,
    }));

    try {
      const result = await exportToDataGrowsTemplate({ records, stripInstructions: true });
      const version = await nextVersion(supabase, sessionId, 'datagrows');
      const fileName = `${safeName}_datagrows_import_v${version}_${isoDate()}.xlsx`;

      // Update last_exported_at and status — this clears modified-after-export markers
      await supabase
        .from('sessions')
        .update({ status: 'exported', last_exported_at: new Date().toISOString() })
        .eq('id', sessionId);

      await recordDocument(supabase, sessionId, 'datagrows', version, fileName, operatorName);

      return new NextResponse(new Uint8Array(result.buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Rows-Written': String(result.rowsWritten),
          'X-Skipped-Archived': String(result.skippedArchived),
          'X-Skipped-Errors': String(result.skippedErrors),
          'X-Version': String(version),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Archived Report ───────────────────────────────────────────────────────

  if (type === 'archived') {
    const records: ClientRecord[] = rows.map((r) => ({
      ...r.merged,
      _sources: r.sources ?? [],
      _archived: r.archived,
      _archive_reason: r.archive_reason ?? undefined,
    }));

    try {
      const { buffer, rows: n } = await exportArchiveReport({ records });
      const version = await nextVersion(supabase, sessionId, 'archived');
      const fileName = `${safeName}_archived_report_v${version}_${isoDate()}.xlsx`;
      await recordDocument(supabase, sessionId, 'archived', version, fileName, operatorName);

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Row-Count': String(n),
          'X-Version': String(version),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Firm Excel (Client Intelligence Report) ───────────────────────────────

  if (type === 'firm_excel') {
    try {
      const [firmProfileRes, employeesRes, contactsRes, suppliersRes] = await Promise.all([
        supabase.from('firm_profile').select('*').eq('session_id', sessionId).maybeSingle(),
        supabase.from('firm_employees').select('*').eq('session_id', sessionId),
        supabase.from('firm_contacts').select('*').eq('session_id', sessionId),
        supabase.from('firm_suppliers').select('*').eq('session_id', sessionId),
      ]);

      const masterfileRows: MasterfileClusterRow[] = rows.map((r) => ({
        id: r.id,
        merged: r.merged,
        sources: r.sources,
        archived: r.archived,
      }));

      const buffer = await generateFirmMasterfile({
        firmProfile: (firmProfileRes.data as FirmProfileRow | null),
        firmName,
        clusters: masterfileRows,
        employees: (employeesRes.data ?? []) as EmployeeRow[],
        contacts: (contactsRes.data ?? []) as ContactRow[],
        suppliers: (suppliersRes.data ?? []) as SupplierRow[],
        generatedBy: operatorName ?? undefined,
      });

      const version = await nextVersion(supabase, sessionId, 'firm_excel');
      const fileName = `${safeName}_client_intelligence_v${version}_${isoDate()}.xlsx`;
      await recordDocument(supabase, sessionId, 'firm_excel', version, fileName, operatorName);

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Version': String(version),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Firm PDF (Client Intelligence Report) ─────────────────────────────────

  if (type === 'firm_pdf') {
    try {
      const [firmProfileRes, employeesRes, contactsRes, suppliersRes] = await Promise.all([
        supabase.from('firm_profile').select('*').eq('session_id', sessionId).maybeSingle(),
        supabase.from('firm_employees').select('*').eq('session_id', sessionId),
        supabase.from('firm_contacts').select('*').eq('session_id', sessionId),
        supabase.from('firm_suppliers').select('*').eq('session_id', sessionId),
      ]);

      const pdfRows = rows.map((r) => ({
        merged: r.merged,
        sources: r.sources,
        archived: r.archived,
      }));

      const buffer = await generatePdfReport({
        firmName,
        firmProfile: firmProfileRes.data as FirmProfileRow | null,
        clusters: pdfRows,
        employees: (employeesRes.data ?? []) as EmployeeRow[],
        contacts: (contactsRes.data ?? []) as ContactRow[],
        suppliers: (suppliersRes.data ?? []) as SupplierRow[],
        generatedBy: operatorName ?? undefined,
      });

      const version = await nextVersion(supabase, sessionId, 'firm_pdf');
      const fileName = `${safeName}_client_intelligence_v${version}_${isoDate()}.pdf`;
      await recordDocument(supabase, sessionId, 'firm_pdf', version, fileName, operatorName);

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Version': String(version),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // ── Features Recommendations ──────────────────────────────────────────────

  if (type === 'features_pdf') {
    try {
      const employeesRes = await supabase
        .from('firm_employees')
        .select('name, dg_roles')
        .eq('session_id', sessionId);

      const featRows = rows.map((r) => ({
        merged: r.merged,
        sources: r.sources,
        archived: r.archived,
      }));

      const buffer = await generateFeaturesRecommendations({
        firmName,
        clusters: featRows,
        employees: (employeesRes.data ?? []) as EmployeeRow[],
        generatedBy: operatorName ?? undefined,
      });

      const version = await nextVersion(supabase, sessionId, 'features_pdf');
      const fileName = `${safeName}_datagrows_features_v${version}_${isoDate()}.xlsx`;
      await recordDocument(supabase, sessionId, 'features_pdf', version, fileName, operatorName);

      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Version': String(version),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown export type: ${type}` }, { status: 400 });
}
