/**
 * Template version tracking.
 *
 * Computes and caches a SHA-256 hash of the canonical DataGrows template file.
 * On export, the hash is recorded so any future template change is detectable.
 *
 * SERVER-ONLY — uses Node's crypto and fs modules.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { TOTAL_COLUMNS } from './datagrows';

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'public',
  'datagrows_canonical_template.xlsx',
);

export interface TemplateVersion {
  hash: string;       // SHA-256 hex digest
  version: string;    // Short prefix for display, e.g. "a3f2b1"
  fields: number;     // Should always be TOTAL_COLUMNS (86)
}

let _cached: TemplateVersion | null = null;

/**
 * Returns the version info for the canonical template.
 * Result is cached in memory for the lifetime of the process.
 */
export async function getTemplateVersion(): Promise<TemplateVersion> {
  if (_cached) return _cached;

  const buf = await readFile(TEMPLATE_PATH);
  const hash = createHash('sha256').update(buf).digest('hex');

  _cached = {
    hash,
    version: hash.slice(0, 8),
    fields: TOTAL_COLUMNS,
  };

  return _cached;
}

/**
 * Verify a stored hash against the current template on disk.
 * Returns true if they match (template unchanged).
 */
export async function verifyTemplateHash(storedHash: string): Promise<boolean> {
  const current = await getTemplateVersion();
  return current.hash === storedHash;
}

/** Bust the in-memory cache (useful in tests). */
export function bustTemplateCache(): void {
  _cached = null;
}
