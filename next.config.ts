import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['exceljs', 'xlsx'],
  experimental: {
    serverActions: {
      bodySizeLimit: '52mb',
    },
  },
};

export default nextConfig;
