import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[0-9a-f]{64}$/
const LEGACY_CATALOG_ID = '2026.08.22.1'
const LEGACY_MANIFEST_SHA256 = '208bd8a45e7c5c771bd0622d6c55d57903ebebf91095d2ca5e7c5c6acfa5b2fd'

export function validatePublishedCatalogContract(candidate) {
  const catalog = candidate.catalogRelease ?? {}
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(String(catalog.id ?? ''))) throw new Error('Published Catalog ID is invalid.')
  if (!SHA256.test(String(catalog.manifestSha256 ?? ''))) throw new Error('Published Catalog manifest SHA-256 is invalid.')
  const base = new URL(String(catalog.publicBaseUrl ?? ''))
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Published Catalog base URL must be credential-free HTTPS.')
  if (!safeRelative(catalog.manifestPath)) throw new Error('Published Catalog manifest path is unsafe.')
  const provenance = catalog.assetProvenance
  if (catalog.id === LEGACY_CATALOG_ID && catalog.manifestSha256 !== LEGACY_MANIFEST_SHA256) throw new Error('Catalog 2026.08.22.1 must use its already-published immutable manifest.')
  if (catalog.id === LEGACY_CATALOG_ID) {
    if (provenance?.status !== 'legacy-published-release-attested' || provenance?.repository !== 'pmarshall7516/rollcaster-assets' || !/^[0-9a-f]{40}$/.test(String(provenance?.commit ?? ''))) {
      throw new Error('Catalog 2026.08.22.1 requires its explicit clean Git LFS provenance receipt.')
    }
  }
  return { catalog, base }
}

export async function downloadPublishedCatalog(candidate, outputRoot, fetchImpl = fetch) {
  const { catalog, base } = validatePublishedCatalogContract(candidate)
  const root = path.resolve(outputRoot)
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('Published Catalog output directory must be empty.')
  fs.mkdirSync(root, { recursive: true })
  const manifestUrl = new URL(catalog.manifestPath, ensureSlash(base))
  const manifestBytes = await download(manifestUrl, fetchImpl)
  verifyBytes(manifestBytes, catalog.manifestSha256, 'Catalog manifest')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.catalogVersion !== catalog.id) throw new Error('Published Catalog ID does not match its manifest.')
  writeRelative(root, catalog.manifestPath, manifestBytes)
  const manifestDirectory = new URL('./', manifestUrl)
  await Promise.all((manifest.packs ?? []).map(async (pack) => {
    if (!safeRelative(pack.url) || !SHA256.test(String(pack.sha256 ?? ''))) throw new Error(`Catalog pack contract is invalid: ${String(pack.key)}.`)
    const bytes = await download(new URL(pack.url, manifestDirectory), fetchImpl)
    verifyBytes(bytes, pack.sha256, `Catalog pack ${pack.key}`)
    writeRelative(root, joinUrlPath(path.posix.dirname(catalog.manifestPath), pack.url), bytes)
  }))
  const assetManifestUrl = new URL(manifest.assetManifestUrl, manifestDirectory)
  const assetManifestBytes = await download(assetManifestUrl, fetchImpl)
  verifyBytes(assetManifestBytes, manifest.assetManifestSha256, 'Catalog asset manifest')
  const assetManifest = JSON.parse(assetManifestBytes.toString('utf8'))
  const assetManifestPath = relativeUrlPath(base, assetManifestUrl)
  writeRelative(root, assetManifestPath, assetManifestBytes)
  const assetRootUrl = new URL('./', assetManifestUrl)
  await parallelMap(assetManifest.assets ?? [], 4, async (asset) => {
    if (!safeRelative(asset.path) || !SHA256.test(String(asset.sha256 ?? ''))) throw new Error(`Catalog asset contract is invalid: ${String(asset.path)}.`)
    const bytes = await download(new URL(asset.path, assetRootUrl), fetchImpl)
    verifyBytes(bytes, asset.sha256, `Catalog asset ${asset.path}`)
    writeRelative(root, joinUrlPath(path.posix.dirname(assetManifestPath), asset.path), bytes)
  })
  const latest = {
    catalogVersion: catalog.id,
    minimumGameVersion: manifest.minimumGameVersion,
    publishedAt: manifest.publishedAt,
    releaseManifestSha256: catalog.manifestSha256,
    releaseManifestUrl: path.posix.relative('game-data', catalog.manifestPath),
    schemaVersion: manifest.schemaVersion,
  }
  writeRelative(root, 'game-data/latest.json', Buffer.from(`${JSON.stringify(latest, null, 2)}\n`))
  writeRelative(root, 'catalog-asset-provenance.json', Buffer.from(`${JSON.stringify({
    catalogVersion: catalog.id,
    catalogManifestSha256: catalog.manifestSha256,
    ...catalog.assetProvenance,
  }, null, 2)}\n`))
  return { catalogVersion: catalog.id, manifestSha256: catalog.manifestSha256, assetCount: assetManifest.assets.length }
}

async function download(url, fetchImpl) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchImpl(url, { redirect: 'follow' })
    if (response.ok) return Buffer.from(await response.arrayBuffer())
    if ((response.status !== 429 && response.status < 500) || attempt === 5) throw new Error(`Published Catalog download failed (${response.status}) for ${url.pathname}.`)
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)))
  }
  throw new Error(`Published Catalog download failed for ${url.pathname}.`)
}

function verifyBytes(bytes, expected, label) {
  const actual = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${label} checksum mismatch.`)
}

function writeRelative(root, relative, bytes) {
  if (!safeRelative(relative)) throw new Error(`Unsafe Catalog output path: ${relative}.`)
  const target = path.resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Catalog output escaped its root.')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes, { flag: 'wx' })
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\\')
}

function ensureSlash(url) {
  return new URL(url.href.endsWith('/') ? url.href : `${url.href}/`)
}

function relativeUrlPath(base, target) {
  const root = ensureSlash(base)
  if (root.origin !== target.origin || !target.pathname.startsWith(root.pathname)) throw new Error('Published Catalog URL escaped its configured origin.')
  return decodeURIComponent(target.pathname.slice(root.pathname.length))
}

function joinUrlPath(directory, relative) {
  return path.posix.normalize(path.posix.join(directory, relative))
}

async function parallelMap(items, concurrency, worker) {
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidate = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] ?? 'release/game-update-candidate.json'), 'utf8'))
  const result = await downloadPublishedCatalog(candidate, process.argv[3] ?? 'catalog-release')
  console.log(JSON.stringify(result))
}
