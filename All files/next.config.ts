import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ExcelJS uses dynamic require paths; keep them server-only.
  serverExternalPackages: ['exceljs', 'xlsx'],
};

export default nextConfig;
