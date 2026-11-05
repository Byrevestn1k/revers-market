import { defineConfig, devices } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'profile.spec.ts', workers: 1, timeout: 120000, use: { ...devices['Desktop Chrome'] }, reporter: [['list']], outputDir: 'results' })
