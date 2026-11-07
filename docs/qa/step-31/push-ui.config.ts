import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: '.', testMatch: 'push-ui.spec.ts', workers: 1, timeout: 30000, use: { baseURL: process.env.STEP31_BASE_URL || 'http://127.0.0.1:5191', browserName: 'chromium', headless: true, launchOptions: { executablePath: process.env.STEP31_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } } })
