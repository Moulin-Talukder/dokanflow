import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url({ protocol: /^https?$/ }),
});

// NEXT_PUBLIC_* values are inlined at build time, so each one must be referenced
// as a literal `process.env.NAME` expression. A missing value fails the build.
export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
