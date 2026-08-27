import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { downloadPublishedCatalog, validatePublishedCatalogContract } from './download-published-catalog.mjs'

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const pack = Buffer.from('{"pack":true}\n')
const asset = Buffer.from('webp-fixture')
const assetManifest = Buffer.from(`${JSON.stringify({ schemaVersion: 2, catalogVersion: '2026.08.23.1', assets: [{ path: 'ui/logo.test.webp', sha256: hash(asset) }] })}\n`)
const manifestObject = {
  catalogVersion: '2026.08.23.1', schemaVersion: 2, minimumGameVersion: '0.1.0', publishedAt: '2026-08-23T00:00:00.000Z',
  assetGitStatus: 'clean', assetGitRevision: 'a'.repeat(40), assetManifestUrl: '../../../game-assets/asset-manifest.test.json', assetManifestSha256: hash(assetManifest),
  packs: [{ key: 'core', url: 'core.test.json', sha256: hash(pack) }],
}
const manifest = Buffer.from(`${JSON.stringify(manifestObject)}\n`)
const candidate = {
  catalogRelease: {
    id: '2026.08.23.1', manifestSha256: hash(manifest), source: 'local', localPath: 'catalog',
    manifestPath: 'game-data/releases/2026.08.23.1/release-manifest.test.json',
    assetProvenance: { status: 'catalog-manifest-clean', repository: 'pmarshall7516/rollcaster-assets', commit: 'a'.repeat(40) },
  },
}

assert.throws(() => validatePublishedCatalogContract({ catalogRelease: { ...candidate.catalogRelease, source: 'remote' } }), /local immutable bundle/i)

const handoffRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollcasters-local-catalog-handoff-'))
const sourceRoot = path.join(handoffRoot, 'catalog')
const manifestFile = path.join(sourceRoot, candidate.catalogRelease.manifestPath)
fs.mkdirSync(path.dirname(manifestFile), { recursive: true })
fs.writeFileSync(manifestFile, manifest)
fs.writeFileSync(path.join(path.dirname(manifestFile), 'core.test.json'), pack)
const assetManifestFile = path.resolve(path.dirname(manifestFile), manifestObject.assetManifestUrl)
fs.mkdirSync(path.dirname(assetManifestFile), { recursive: true })
fs.writeFileSync(assetManifestFile, assetManifest)
fs.mkdirSync(path.join(sourceRoot, 'game-assets/ui'), { recursive: true })
fs.writeFileSync(path.join(sourceRoot, 'game-assets/ui/logo.test.webp'), asset)
fs.mkdirSync(path.join(sourceRoot, 'game-data'), { recursive: true })
fs.writeFileSync(path.join(sourceRoot, 'game-data/latest.json'), `${JSON.stringify({
  catalogVersion: candidate.catalogRelease.id,
  minimumGameVersion: manifestObject.minimumGameVersion,
  publishedAt: manifestObject.publishedAt,
  releaseManifestSha256: candidate.catalogRelease.manifestSha256,
  releaseManifestUrl: 'releases/2026.08.23.1/release-manifest.test.json',
  schemaVersion: manifestObject.schemaVersion,
}, null, 2)}\n`)

const root = path.join(handoffRoot, 'catalog-release')
const result = await downloadPublishedCatalog(candidate, root, undefined, handoffRoot)
assert.equal(result.assetCount, 1)
assert.equal(fs.readFileSync(path.join(root, 'game-assets/ui/logo.test.webp'), 'utf8'), asset.toString())
const latest = JSON.parse(fs.readFileSync(path.join(root, 'game-data/latest.json'), 'utf8'))
assert.equal(latest.catalogVersion, candidate.catalogRelease.id)
await assert.rejects(downloadPublishedCatalog(candidate, root, undefined, handoffRoot), /must be empty/i)
console.log('Local Catalog handoff contract passed: protected CI verifies and copies the committed immutable bundle without R2.')
