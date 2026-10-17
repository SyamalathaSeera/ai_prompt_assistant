import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    name: 'langgraph-demo',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
