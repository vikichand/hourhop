import { defineConfig } from '@playwright/test';

// E2E runs against the built, unpacked MV3 extension (.output/chrome-mv3) in a fresh temp profile.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  // Keep a trace for failures so CI runs can be diagnosed from the uploaded artifact.
  use: { trace: 'retain-on-failure' },
});
