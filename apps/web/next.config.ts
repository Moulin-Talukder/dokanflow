import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// The monorepo keeps one .env at the repo root; Next only reads apps/web/.env*.
// Variables already set (CI, hosting platform) take precedence.
const rootEnvFile = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
};

export default nextConfig;
