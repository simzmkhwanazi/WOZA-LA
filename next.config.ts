import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ExcelJS uses dynamic require paths; keep them server-only.
  serverExternalPackages: ['exceljs', 'xlsx', 'better-sqlite3'],
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
};

export default nextConfig;
