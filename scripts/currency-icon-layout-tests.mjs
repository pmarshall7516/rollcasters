import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8')
const coins = `data:image/png;base64,${fs.readFileSync(path.join(root, '..', 'assets', 'ui', 'coins.png')).toString('base64')}`

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 160 } })
  await page.setContent(`<!doctype html><style>${css}</style><main style="padding:40px;background:#080b1d"><div class="currency-pill"><span class="asset-icon"><img class="asset-icon__image sprite-box__image" src="${coins}" alt="Coins"></span><span>3,273</span></div></main>`)
  await page.waitForFunction(() => document.images[0]?.complete && document.images[0].naturalWidth > 0)
  const result = await page.locator('img').evaluate((image) => {
    const rect = image.getBoundingClientRect()
    const frame = image.parentElement.getBoundingClientRect()
    const style = getComputedStyle(image)
    return {
      image: [rect.left, rect.top, rect.right, rect.bottom],
      frame: [frame.left, frame.top, frame.right, frame.bottom],
      transform: style.transform,
      objectFit: style.objectFit,
    }
  })
  const epsilon = 0.01
  const contained = result.image[0] >= result.frame[0] - epsilon
    && result.image[2] <= result.frame[2] + epsilon
    && result.image[1] >= result.frame[1] - epsilon
    && result.image[3] <= result.frame[3] + epsilon
  if (result.transform !== 'none' || !contained || result.objectFit !== 'contain') {
    throw new Error(`Currency icon layout failure: ${JSON.stringify(result)}`)
  }
  console.log('Currency icon layout passed: compact currency artwork stays fully inside its icon frame.')
} finally {
  await browser.close()
}
