/**
 * Renders every milk-label preset through the real drawLabel (e2e/label-render.html, served by the dev
 * server) with the app's Nunito font, saves each PNG 1:1 at 203 dpi, decodes the QR from every label that
 * has a code, and checks that nothing is drawn outside the label or over the QR.
 *
 * Usage: node e2e/label-shots.mjs <out-dir> [base-url=http://localhost:5173] [font-dir]
 *   font-dir: a folder with Google Fonts' nunito.css and its woff2 files, served in place of the CDN when
 *   the machine running this has no route to it.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { chromium } from 'playwright'
import jsQR from 'jsqr'

const OUT = process.argv[2] ?? './e2e/out/labels'
const BASE = process.argv[3] ?? 'http://localhost:5173'
const FONTS = process.argv[4] ?? null
const MOD = process.argv[5] ?? 'labels'
const SIZES = process.argv[6] ?? ''
mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage()
page.on('pageerror', (e) => check(`pageerror ${e.message}`, false))
if (FONTS) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ body: readFileSync(existsSync(join(FONTS, 'fonts.css')) ? join(FONTS, 'fonts.css') : join(FONTS, 'nunito.css')), contentType: 'text/css' }))
  await page.route('https://fonts.gstatic.com/**', (route) => {
    const file = join(FONTS, basename(new URL(route.request().url()).pathname))
    return existsSync(file) ? route.fulfill({ body: readFileSync(file), contentType: 'font/woff2' }) : route.abort()
  })
}
await page.goto(`${BASE}/e2e/label-render.html?mod=${MOD}&sizes=${SIZES}`)
await page.waitForSelector('body[data-ready]', { timeout: 20000 })
check('Nunito and Fraunces loaded', (await page.getAttribute('body', 'data-ready')) === 'true')

const labels = await page.$$eval('canvas', (list) =>
  list.map((c) => {
    const ctx = c.getContext('2d')
    const img = ctx.getImageData(0, 0, c.width, c.height)
    // Ink outside a 1-pixel border, and per-row/column ink coverage, for the layout checks.
    let edge = 0
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        if (x > 0 && y > 0 && x < c.width - 1 && y < c.height - 1) continue
        if (img.data[(y * c.width + x) * 4] < 128) edge++
      }
    return { name: c.dataset.name, width: c.width, height: c.height, png: c.toDataURL('image/png'), data: Array.from(img.data), edge }
  }),
)
for (const l of labels) {
  writeFileSync(join(OUT, `${l.name}.png`), Buffer.from(l.png.split(',')[1], 'base64'))
  check(`${l.name}: nothing printed on the label edge`, l.edge === 0, String(l.edge))
  if (!l.name.endsWith('no-bag')) {
    const qr = jsQR(Uint8ClampedArray.from(l.data), l.width, l.height)
    check(`${l.name}: QR decodes`, qr !== null && /^bramble:milk:[A-Z0-9]{6}$/.test(qr.data), qr?.data ?? 'no QR found')
  }
}
await browser.close()
console.log(`${labels.length} labels in ${OUT}; ${failed} failures`)
process.exit(failed ? 1 : 0)
