import type { NextConfig } from 'next';

// v3.1 — force Vercel cache bust
const nextConfig: NextConfig = {
  serverExternalPackages: ['exceljs', 'xlsx'],
  experimental: {
    serverActions: {
      bodySizeLimit: '52mb',
    },
  },
};

export default nextConfig;
