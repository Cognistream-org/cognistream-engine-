import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@cognistream/shared', 'framer-motion'],
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;