import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:5185',
    viewport: { width: 1360, height: 920 },
  },
});
