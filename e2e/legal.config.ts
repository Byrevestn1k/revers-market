import { defineConfig } from '@playwright/test'

// Build first. This server has no jobs, migrations, real credentials or database.
export default defineConfig({
  testDir: '.',
  testMatch: 'legal-foundation.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  outputDir: '../test-results/legal',
  use: {
    baseURL: 'http://127.0.0.1:3188',
    browserName: 'chromium',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node support/legal-review-server.mjs',
    url: 'http://127.0.0.1:3188/legal/about',
    reuseExistingServer: false,
    env: { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/legal_audit_no_db' },
  },
})
