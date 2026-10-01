import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { projects: [
  { test: { name: 'server', environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 10_000, hookTimeout: 10_000 } },
  { test: { name: 'ui', environment: 'jsdom', include: ['tests/ui/**/*.test.tsx'], testTimeout: 10_000 } },
] } });
