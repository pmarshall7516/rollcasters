import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "sprite-containment");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");

function source(width, height, label, color, shape = "rect") {
  const art = shape === "ellipse"
    ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.46}" ry="${height * 0.46}" fill="${color}" stroke="#fff" stroke-width="6"/>`
    : `<rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="12" fill="${color}" stroke="#fff" stroke-width="6"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${art}<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#081022" font-family="sans-serif" font-size="${Math.max(12, Math.min(width, height) / 6)}" font-weight="800">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const cases = [
  { name: "Tall Rollcaster", src: source(568, 954, "TALL", "#a779ff"), box: "sprite-frame-hero", sprite: "sprite-hero sprite-fit-portrait element-basic" },
  { name: "Near-square Critter", src: source(460, 500, "CRITTER", "#61dda0"), box: "sprite-frame-md", sprite: "sprite-medium element-bloom" },
  { name: "Square Relic", src: source(400, 400, "RELIC", "#ffd980"), box: "sprite-frame-sm", sprite: "sprite-small element-metal" },
  { name: "Oval Coin", src: source(340, 430, "COIN", "#f5b942", "ellipse"), box: "sprite-frame-sm", sprite: "sprite-small element-basic" },
  { name: "Wide pose", src: source(900, 320, "WIDE", "#4fe4e1"), box: "sprite-frame-lg", sprite: "sprite-large element-aqua" },
];

const gallery = cases.map(({ name, src, box, sprite }) => `
  <figure>
    <span class="sprite-frame ${box}">
      <span class="sprite ${sprite}" data-sprite-box>
        <img class="sprite-box__image" data-sprite-image src="${src}" alt="${name}">
      </span>
    </span>
    <figcaption>${name}</figcaption>
  </figure>`).join("");

const iconSource = source(160, 320, "ICON", "#ff6e86");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html>
    <html>
      <head>
        <style>${css}</style>
        <style>
          body { padding: 32px; background: #080b1d; color: #f7f3ff; }
          .test-grid { display: flex; flex-wrap: wrap; align-items: end; gap: 28px; }
          figure { display: grid; justify-items: center; gap: 10px; margin: 0; }
          figcaption { font: 700 14px/1.2 sans-serif; }
          .icon-example { width: 42px; height: 42px; }
        </style>
      </head>
      <body>
        <main class="test-grid">
          ${gallery}
          <figure>
            <span class="asset-icon icon-example" data-sprite-box>
              <img class="asset-icon__image sprite-box__image" data-sprite-image src="${iconSource}" alt="Tall icon">
            </span>
            <figcaption>Static icon</figcaption>
          </figure>
        </main>
      </body>
    </html>`);

  await page.waitForFunction(() => [...document.querySelectorAll("[data-sprite-image]")].every((image) => image.complete && image.naturalWidth > 0));

  async function inspectViewport(name, width, height) {
    await page.setViewportSize({ width, height });
    const results = await page.locator("[data-sprite-image]").evaluateAll((images) => images.map((image) => {
      const imageRect = image.getBoundingClientRect();
      const box = image.parentElement;
      const boxRect = box.getBoundingClientRect();
      const imageStyle = getComputedStyle(image);
      const boxStyle = getComputedStyle(box);
      const epsilon = 0.01;
      return {
        alt: image.alt,
        box: [boxRect.width, boxRect.height],
        image: [imageRect.width, imageRect.height],
        objectFit: imageStyle.objectFit,
        objectPosition: imageStyle.objectPosition,
        imagePosition: imageStyle.position,
        boxPosition: boxStyle.position,
        boxOverflow: boxStyle.overflow,
        padding: Number.parseFloat(imageStyle.paddingLeft),
        squareBox: Math.abs(boxRect.width - boxRect.height) <= epsilon,
        contained:
          imageRect.left >= boxRect.left - epsilon &&
          imageRect.top >= boxRect.top - epsilon &&
          imageRect.right <= boxRect.right + epsilon &&
          imageRect.bottom <= boxRect.bottom + epsilon,
      };
    }));
    const screenshot = path.join(outputDir, `sprite-containment-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { name, width, height, screenshot, results };
  }

  await mkdir(outputDir, { recursive: true });
  const viewports = [];
  viewports.push(await inspectViewport("desktop", 1120, 720));
  viewports.push(await inspectViewport("mobile", 360, 720));
  const results = viewports.flatMap((viewport) => viewport.results.map((result) => ({ viewport: viewport.name, ...result })));
  const failures = results.filter((result) =>
    result.objectFit !== "contain" ||
    result.objectPosition !== "50% 50%" ||
    result.imagePosition !== "absolute" ||
    result.boxPosition !== "relative" ||
    result.boxOverflow !== "hidden" ||
    result.padding < 1 ||
    !result.squareBox ||
    !result.contained
  );

  if (failures.length) {
    throw new Error(`Sprite containment failures:\n${JSON.stringify(failures, null, 2)}`);
  }

  console.log(JSON.stringify({ checked: results.length, viewports }, null, 2));
} finally {
  await browser.close();
}
