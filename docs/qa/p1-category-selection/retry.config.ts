import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'retry.spec.ts', timeout: 300000, expect: { timeout: 20000 }, workers: 1, reporter: 'list', use: { baseURL: 'http://127.0.0.1:5182', browserName: 'chromium', headless: true } })
