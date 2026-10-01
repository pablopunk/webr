import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({ test: { projects: [
  { test: { name: 'server', environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 10_000, hookTimeout: 10_000 } },
  { resolve: { alias: { 'astro:transitions/client': fileURLToPath(new URL('./node_modules/astro/dist/transitions/router.js', import.meta.url)) } }, test: { name: 'ui', environment: 'jsdom', include: ['tests/ui/**/*.test.tsx'], testTimeout: 10_000 } },
] } });
