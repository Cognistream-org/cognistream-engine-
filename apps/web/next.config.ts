import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@cognistream/shared'],
  output: 'standalone',
};

export default nextConfig;
