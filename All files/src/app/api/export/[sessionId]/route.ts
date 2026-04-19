import { createClient, createServiceClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Type for export version record in Supabase.
 */
interface ExportVersion {
  id: string;
  session_id: string;
  version_number: number;
  exported_by: string;
  client_count: number;
  file_path: string;
  created_at: string;
}

/**
 * Converts 0-based column index to Excel column letters.
 * Used for column validation.
 *
 * @param index - 0-based column index
 * @returns Excel column letters
 */
function indexToCol(index: number): string {
  let col = '';
  let num = index + 1;
  while (num > 0) {
    const remainder = (num - 1) % 26;
    col = String.fromCharCode('A'.charCodeAt(0) + remainder) + col;
    num = Math.floor((num - 1) / 26);
  }
  return col;
}

/**
 * Gets the next version number for a session's exports.
 * Queries the export_versions table to determine the highest existing version.
 *
 * @param supabase - Supabase client
 * @param sessionId - Session ID
 * @returns Next version number (1 if first export)
 */
async function getNextVersionNumber(supabase: any, sessionId: string): Promise<number> {
  const { data, error } = await supabase
    .from('export_versions')
    .select('version_number')
    .eq('session_id', sessionId)
    .order('version_number', { ascending: false })
    .limit(1);

  if (error) {
    console.warn(`Error querying export versions: ${error.message}`);
    return 1;
  }

  if (!data || data.length === 0) {
    return 1;
  }

  return (data[0].version_number || 0) + 1;
}

/**
 * Stores an export file in Supabase Storage.
 *
 * @param supabase - Supabase client
 * @param sessionId - Session ID
 * @param versionNumber - Version number
 * @param buffer - File buffer to store
 * @returns File path in storage
 */
async function storeExportFile(
  supabase: any,
  sessionId: string,
  versionNumber: number,
  buffer: Buffer
): Promise<string> {
  const filePath = `exports/${sessionId}/v${versionNumber}.xlsx`;

  const { error } = await supabase.storage.from('exports').upload(filePath, buffer, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to upload export file: ${error.message}`);
  }

  return filePath;
}

/**
 * Creates a record in the export_versions table.
 *
 * @param supabase - Supabase client
 * @param versionRecord - Export version data
 * @returns Created record
 */
async function createExportVersionRecord(supabase: any, versionRecord: Omit<ExportVersion, 'id' | 'created_at'>): Promise<ExportVersion> {
  const { data, error } = await supabase
    .from('export_versions')
    .insert([versionRecord])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create export version record: ${error.message}`);
  }

  return data;
}

/**
 * Cleans up old export files from Supabase Storage.
 * Keeps only the most recent N versions.
 *
 * @param supabase - Supabase client
 * @param sessionId - Session ID
 * @param keepVersions - Number of versions to retain
 */
async function cleanupOldExports(
  supabase: any,
  sessionId: string,
  keepVersions: number = 5
): Promise<void> {
  // Query all versions for this session
  const { data: allVersions, error: queryError } = await supabase
    .from('export_versions')
    .select('id, version_number, file_path')
    .eq('session_id', sessionId)
    .order('version_number', { ascending: false });

  if (queryError) {
    console.warn(`Error querying exports for cleanup: ${queryError.message}`);
    return;
  }

  if (!allVersions || allVersions.length <= keepVersions) {
    return; // Nothing to clean up
  }

  // Delete old versions
  const versionsToDelete = allVersions.slice(keepVersions);
  for (const version of versionsToDelete) {
    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('exports')
      .remove([version.file_path]);

    if (storageError) {
      console.warn(`Error deleting export file: ${storageError.message}`);
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('export_versions')
      .delete()
      .eq('id', version.id);

    if (dbError) {
      console.warn(`Error deleting export version record: ${dbError.message}`);
    }
  }
}

/**
 * GET /api/export/[sessionId]
 * Exports merged and processed client data to DataGrows template format.
 * Stores version information in Supabase for audit trail.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();

    // Get the current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch session data
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Fetch clusters/records for export
    const { data: clusters, error: clusterError } = await supabase
      .from('clusters')
      .select('*')
      .eq('session_id', sessionId);

    if (clusterError) {
      return NextResponse.json(
        { error: 'Failed to fetch clusters' },
        { status: 500 }
      );
    }

    // Get next version number
    const versionNumber = await getNextVersionNumber(supabase, sessionId);

    // Generate export (placeholder - actual implementation would call exportToDataGrowsTemplate)
    // const buffer = await exportToDataGrowsTemplate(clusters);
    const buffer = Buffer.alloc(0); // Placeholder

    // Store export file in Supabase Storage
    const filePath = await storeExportFile(supabase, sessionId, versionNumber, buffer);

    // Create version record in database
    const versionRecord = await createExportVersionRecord(supabase, {
      session_id: sessionId,
      version_number: versionNumber,
      exported_by: user.email || user.id,
      client_count: clusters?.length || 0,
      file_path: filePath,
    });

    // Clean up old exports (keep last 5 versions)
    await cleanupOldExports(supabase, sessionId, 5);

    // Return file with metadata headers
    const response = new NextResponse(buffer);
    response.headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.headers.set('Content-Disposition', `attachment; filename="export-v${versionNumber}.xlsx"`);
    response.headers.set('X-Export-Version', String(versionNumber));
    response.headers.set('X-Export-Path', filePath);
    response.headers.set('X-Export-Record-Count', String(clusters?.length || 0));

    return response;
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}

export { cleanupOldExports };
