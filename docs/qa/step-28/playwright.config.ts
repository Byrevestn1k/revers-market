import { defineConfig, devices } from '@playwright/test'

export default defineConfig({ testDir: '.', testMatch: 'offer.spec.ts', workers: 1, timeout: 240000, expect: { timeout: 20000 }, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5180', actionTimeout: 15000 }, reporter: [['list']], outputDir: 'results' })
