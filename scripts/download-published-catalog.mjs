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
  if (catalog.source !== 'local') throw new Error('Published Catalog must use the local immutable bundle source.')
  if (!safeRelative(catalog.localPath)) throw new Error('Local Catalog bundle path is unsafe.')
  if (!safeRelative(catalog.manifestPath)) throw new Error('Published Catalog manifest path is unsafe.')
  const provenance = catalog.assetProvenance
  if (catalog.id === LEGACY_CATALOG_ID && catalog.manifestSha256 !== LEGACY_MANIFEST_SHA256) throw new Error('Catalog 2026.08.22.1 must use its already-published immutable manifest.')
  if (catalog.id === LEGACY_CATALOG_ID) {
    if (provenance?.status !== 'legacy-published-release-attested' || provenance?.repository !== 'pmarshall7516/rollcaster-assets' || !/^[0-9a-f]{40}$/.test(String(provenance?.commit ?? ''))) {
      throw new Error('Catalog 2026.08.22.1 requires its explicit clean Git LFS provenance receipt.')
    }
  }
  return { catalog }
}

export async function downloadPublishedCatalog(candidate, outputRoot, fetchImpl = fetch, candidateRoot = process.cwd()) {
  const { catalog } = validatePublishedCatalogContract(candidate)
  const root = path.resolve(outputRoot)
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('Published Catalog output directory must be empty.')
  fs.mkdirSync(root, { recursive: true })
  const sourceRoot = path.resolve(candidateRoot, catalog.localPath)
  if (!fs.existsSync(sourceRoot)) throw new Error(`Local Catalog bundle is missing: ${sourceRoot}`)
  const sourcePointerPath = path.join(sourceRoot, 'game-data', 'latest.json')
  const sourcePointer = JSON.parse(fs.readFileSync(sourcePointerPath, 'utf8'))
  if (sourcePointer.catalogVersion !== catalog.id || sourcePointer.releaseManifestSha256 !== catalog.manifestSha256) throw new Error('Local Catalog pointer does not match the candidate.')
  const sourceManifestPath = path.resolve(sourceRoot, 'game-data', sourcePointer.releaseManifestUrl)
  if (sourceManifestPath !== path.resolve(sourceRoot, catalog.manifestPath)) throw new Error('Local Catalog manifest path does not match the candidate.')
  const manifestBytes = fs.readFileSync(sourceManifestPath)
  verifyBytes(manifestBytes, catalog.manifestSha256, 'Catalog manifest')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.catalogVersion !== catalog.id) throw new Error('Published Catalog ID does not match its manifest.')
  for (const pack of manifest.packs ?? []) {
    if (!safeRelative(pack.url) || !SHA256.test(String(pack.sha256 ?? ''))) throw new Error(`Catalog pack contract is invalid: ${String(pack.key)}.`)
    const packFile = path.resolve(path.dirname(sourceManifestPath), pack.url)
    if (!fs.existsSync(packFile)) throw new Error(`Local Catalog pack is missing: ${String(pack.key)}.`)
    verifyBytes(fs.readFileSync(packFile), pack.sha256, `Catalog pack ${pack.key}`)
  }
  const assetManifestPath = path.resolve(path.dirname(sourceManifestPath), manifest.assetManifestUrl)
  const assetManifestBytes = fs.readFileSync(assetManifestPath)
  verifyBytes(assetManifestBytes, manifest.assetManifestSha256, 'Catalog asset manifest')
  const assetManifest = JSON.parse(assetManifestBytes.toString('utf8'))
  for (const asset of assetManifest.assets ?? []) {
    if (!safeRelative(asset.path) || !SHA256.test(String(asset.sha256 ?? ''))) throw new Error(`Catalog asset contract is invalid: ${String(asset.path)}.`)
    const assetFile = path.resolve(sourceRoot, 'game-assets', asset.path)
    if (!fs.existsSync(assetFile)) throw new Error(`Local Catalog asset is missing: ${String(asset.path)}.`)
    verifyBytes(fs.readFileSync(assetFile), asset.sha256, `Catalog asset ${asset.path}`)
  }
  fs.cpSync(sourceRoot, root, { recursive: true, errorOnExist: false })
  return { catalogVersion: catalog.id, manifestSha256: catalog.manifestSha256, assetCount: assetManifest.assets.length }
}

function verifyBytes(bytes, expected, label) {
  const actual = crypto.createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${label} checksum mismatch.`)
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value) && !value.split('/').includes('..') && !value.includes('\\')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidateFile = path.resolve(process.argv[2] ?? 'release/game-update-candidate.json')
  const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
  const result = await downloadPublishedCatalog(candidate, process.argv[3] ?? 'catalog-release', fetch, path.dirname(candidateFile))
  console.log(JSON.stringify(result))
}
