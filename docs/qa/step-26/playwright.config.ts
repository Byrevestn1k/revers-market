import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  outputDir: '../../../test-results/step-26',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5179', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npx concurrently -k "npm run dev --workspace backend" "npm run dev --workspace frontend -- --port 5179 --strictPort"', cwd: process.cwd(), url: 'http://127.0.0.1:5179', reuseExistingServer: false, timeout: 120_000 },
})
