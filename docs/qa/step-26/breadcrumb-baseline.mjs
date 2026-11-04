import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const base = '1387aa2741ed4c768c1af9f9dddb9b947df20008'
const readBase = path => execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const css = [readBase('frontend/src/styles.css'), readBase('frontend/src/App.css')].join('\n')
const app = readBase('frontend/src/App.tsx')
if (!app.includes('<main className="public-detail-page"><nav className="breadcrumbs"')) throw new Error('Baseline breadcrumb markup changed; review the reproduction')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } })
  await page.setContent(`<style>${css}</style><main class="public-detail-page"><nav class="breadcrumbs" aria-label="Навігаційний шлях"><a href="/dashboard">Головна</a><span><i>›</i><a href="/products">Товари</a></span><span><i>›</i><b aria-current="page">Тестовий товар для перевірки форми Step 26</b></span></nav></main>`, { waitUntil: 'domcontentloaded' })
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, breadcrumbClientWidth: document.querySelector('.breadcrumbs').clientWidth, breadcrumbScrollWidth: document.querySelector('.breadcrumbs').scrollWidth }))
  await mkdir('docs/qa/step-26/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/qa/step-26/screenshots/breadcrumb-baseline-320.png' })
  console.log(JSON.stringify(dimensions))
  if (dimensions.scrollWidth <= dimensions.width) process.exitCode = 1
} finally { await browser.close() }
