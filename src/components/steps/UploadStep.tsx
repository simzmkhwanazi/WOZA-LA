'use client';

import { useState, useEffect, useCallback } from 'react';
import { parseWorkbook } from '@/lib/parsers/generic';
import type { SourceType } from '@/lib/schema/sources';
import { SOURCE_LABELS } from '@/lib/schema/sources';
import { getUploads, createUpload, insertRawRecords, type UploadRow } from '@/lib/actions/db';

const SOURCE_OPTIONS: SourceType[] = ['sage', 'xero', 'sars', 'cipc', 'excel', 'employees'];

export function UploadStep({ sessionId }: { sessionId: string }) {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [sourceType, setSourceType] = useState<SourceType>('sage');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUploads = useCallback(async () => {
    setUploads(await getUploads(sessionId));
  }, [sessionId]);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    try {
      // Parse client-side to get rows + detected columns
      const buffer = await file.arrayBuffer();
      const parsed = parseWorkbook(buffer, file.name);
      const primary = parsed.sheets.find((s) => s.sheetName === parsed.primarySheetName);
      if (!primary) throw new Error('No readable sheet found');

      // Save raw file to local disk via API route
      const storagePath = `${sessionId}/${Date.now()}-${file.name}`;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('storagePath', storagePath);
      const upRes = await fetch('/api/upload-file', { method: 'POST', body: fd });
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'File upload failed');
      }

      // Create uploads row
      const { uploadId, error: rowErr } = await createUpload({
        sessionId,
        sourceType,
        fileName: file.name,
        storagePath,
        rowCount: primary.rows.length,
        detectedColumns: primary.detectedColumns,
      });
      if (rowErr || !uploadId) throw new Error(rowErr ?? 'Insert failed');

      // Bulk-insert raw_records (server action handles transaction internally)
      const rawRows = primary.rows.map((data, idx) => ({ row_index: idx, data }));
      const { error: rawErr } = await insertRawRecords(uploadId, rawRows);
      if (rawErr) throw new Error(rawErr);

      await loadUploads();
      e.target.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-navy-800 mb-3">Upload source files</h3>
        <p className="text-sm text-navy-500 mb-4">
          Upload each file the firm sent you. Tag it with the source so Woza La knows
          which hierarchy to apply when merging.
        </p>

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-navy-700 mb-1">Source</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
              className="input"
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-navy-700 mb-1">File (.xlsx / .csv)</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFile}
              disabled={uploading}
              className="input"
            />
          </div>
        </div>
        {uploading && <p className="text-sm text-teal-700 mt-3">Parsing and uploading…</p>}
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-3 border-b border-navy-100">
          <h3 className="text-sm font-semibold text-navy-700">Uploaded files ({uploads.length})</h3>
        </div>
        {uploads.length === 0 ? (
          <p className="px-6 py-8 text-sm text-navy-500 text-center">No uploads yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-left text-navy-600">
              <tr>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Rows</th>
                <th className="px-4 py-2 font-medium">Columns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 font-medium">{u.file_name}</td>
                  <td className="px-4 py-2">
                    <span className="badge badge-muted">{SOURCE_LABELS[u.source_type]}</span>
                  </td>
                  <td className="px-4 py-2">{u.row_count ?? '—'}</td>
                  <td className="px-4 py-2 text-navy-500">
                    {u.detected_columns?.length ?? 0} detected
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
