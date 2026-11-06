import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'category.spec.ts', timeout: 600000, expect: { timeout: 15000 }, workers: 1, reporter: 'list', use: { baseURL: 'http://127.0.0.1:5182', browserName: 'chromium', headless: true } })
