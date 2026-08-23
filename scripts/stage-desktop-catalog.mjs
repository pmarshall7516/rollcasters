import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const configuredSource = value('--source') || args.find((argument) => !argument.startsWith('-')) || process.env.ROLLCASTERS_CATALOG_RELEASE_DIR
if (!configuredSource) throw new Error('Pass --source or set ROLLCASTERS_CATALOG_RELEASE_DIR to an immutable Catalog Release directory.')
const sourceRoot = path.resolve(configuredSource)
if (!fs.existsSync(sourceRoot)) throw new Error('The configured immutable Catalog Release directory does not exist.')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const latest = readJson(path.join(sourceRoot, 'game-data/latest.json'))
const manifestFile = path.resolve(path.join(sourceRoot, 'game-data', latest.releaseManifestUrl))
if (sha256(manifestFile) !== latest.releaseManifestSha256) throw new Error('Catalog Release manifest checksum failed.')
const manifest = readJson(manifestFile)
if (process.env.ROLLCASTERS_EXPECTED_CATALOG_ID && manifest.catalogVersion !== process.env.ROLLCASTERS_EXPECTED_CATALOG_ID) throw new Error('Catalog Release ID does not match the Game Update candidate.')
if (process.env.ROLLCASTERS_EXPECTED_CATALOG_SHA256 && latest.releaseManifestSha256 !== process.env.ROLLCASTERS_EXPECTED_CATALOG_SHA256) throw new Error('Catalog Release hash does not match the Game Update candidate.')
for (const pack of manifest.packs) {
  const packFile = path.join(path.dirname(manifestFile), pack.url)
  if (sha256(packFile) !== pack.sha256) throw new Error(`Catalog pack checksum failed: ${pack.key}.`)
}
const assetManifestFile = path.resolve(path.dirname(manifestFile), manifest.assetManifestUrl)
if (sha256(assetManifestFile) !== manifest.assetManifestSha256) throw new Error('Catalog asset manifest checksum failed.')
const assetManifest = readJson(assetManifestFile)
for (const asset of assetManifest.assets) {
  const assetFile = path.join(sourceRoot, 'game-assets', asset.path)
  if (sha256(assetFile) !== asset.sha256) throw new Error(`Catalog asset checksum failed: ${asset.path}.`)
}
if (manifest.assetGitStatus !== 'clean') {
  const receiptFile = path.join(sourceRoot, 'catalog-asset-provenance.json')
  const receipt = fs.existsSync(receiptFile) ? readJson(receiptFile) : null
  const legacyAccepted = manifest.catalogVersion === '2026.08.22.1'
    && latest.releaseManifestSha256 === '208bd8a45e7c5c771bd0622d6c55d57903ebebf91095d2ca5e7c5c6acfa5b2fd'
    && receipt?.status === 'legacy-published-release-attested'
    && receipt?.repository === 'pmarshall7516/rollcaster-assets'
    && /^[0-9a-f]{40}$/.test(String(receipt?.commit ?? ''))
  if (!legacyAccepted) throw new Error(`Catalog asset revision is ${manifest.assetGitStatus}; official packaging requires a clean revision or the exact 2026.08.22.1 provenance receipt.`)
}

const target = path.resolve('public/desktop-catalog')
fs.mkdirSync(target, { recursive: true })
for (const entry of ['game-data', 'game-assets']) {
  fs.cpSync(path.join(sourceRoot, entry), path.join(target, entry), { recursive: true, force: false, errorOnExist: true })
}
fs.writeFileSync(path.join(target, 'catalog-provenance.json'), `${JSON.stringify({
  catalogVersion: manifest.catalogVersion,
  releaseManifestSha256: latest.releaseManifestSha256,
  sourceSnapshotSha256: manifest.sourceSnapshotSha256,
  assetGitRevision: manifest.assetGitRevision,
  assetProvenance: fs.existsSync(path.join(sourceRoot, 'catalog-asset-provenance.json')) ? readJson(path.join(sourceRoot, 'catalog-asset-provenance.json')) : null,
}, null, 2)}\n`)
console.log(`Staged verified Catalog Release ${manifest.catalogVersion} for desktop packaging.`)
