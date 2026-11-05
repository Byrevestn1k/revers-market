import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: '.', testMatch: 'chat.spec.ts', workers: 1, timeout: 360000, expect: { timeout: 20000 },
    use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5179', screenshot: 'only-on-failure', actionTimeout: 15000 },
    reporter: [['list']], outputDir: 'results',
})
