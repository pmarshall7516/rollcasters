import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { downloadPublishedCatalog, validatePublishedCatalogContract } from './download-published-catalog.mjs'

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const pack = Buffer.from('{"pack":true}\n')
const asset = Buffer.from('webp-fixture')
const assetManifest = Buffer.from(`${JSON.stringify({ schemaVersion: 1, catalogVersion: '2026.08.22.1', assets: [{ path: 'ui/logo.test.webp', sha256: hash(asset) }] })}\n`)
const manifestObject = {
  catalogVersion: '2026.08.22.1', schemaVersion: 2, minimumGameVersion: '0.1.0', publishedAt: '2026-08-22T00:00:00.000Z',
  assetGitStatus: 'unversioned', assetManifestUrl: '../../../game-assets/asset-manifest.test.json', assetManifestSha256: hash(assetManifest),
  packs: [{ key: 'core', url: 'core.test.json', sha256: hash(pack) }],
}
const manifest = Buffer.from(`${JSON.stringify(manifestObject)}\n`)
const candidate = {
  catalogRelease: {
    id: '2026.08.22.1', manifestSha256: hash(manifest), publicBaseUrl: 'https://catalog.example/releases/',
    manifestPath: 'game-data/releases/2026.08.22.1/release-manifest.test.json',
    assetProvenance: { status: 'legacy-published-release-attested', repository: 'pmarshall7516/rollcaster-assets', commit: 'b'.repeat(40) },
  },
}

// The legacy exception is pinned to the real published manifest, never an arbitrary fixture.
assert.throws(() => validatePublishedCatalogContract(candidate), /already-published immutable manifest/i)
candidate.catalogRelease.id = '2026.08.23.1'
manifestObject.catalogVersion = '2026.08.23.1'
const currentManifest = Buffer.from(`${JSON.stringify(manifestObject)}\n`)
candidate.catalogRelease.manifestSha256 = hash(currentManifest)
const fixtures = new Map([
  ['https://catalog.example/releases/game-data/releases/2026.08.22.1/release-manifest.test.json', currentManifest],
  ['https://catalog.example/releases/game-data/releases/2026.08.22.1/core.test.json', pack],
  ['https://catalog.example/releases/game-assets/asset-manifest.test.json', assetManifest],
  ['https://catalog.example/releases/game-assets/ui/logo.test.webp', asset],
])
const fetchFixture = async (url) => {
  const bytes = fixtures.get(String(url))
  return bytes ? new Response(bytes) : new Response('missing', { status: 404 })
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollcasters-published-catalog-'))
const result = await downloadPublishedCatalog(candidate, root, fetchFixture)
assert.equal(result.assetCount, 1)
assert.equal(fs.readFileSync(path.join(root, 'game-assets/ui/logo.test.webp'), 'utf8'), asset.toString())
const latest = JSON.parse(fs.readFileSync(path.join(root, 'game-data/latest.json'), 'utf8'))
assert.equal(latest.catalogVersion, '2026.08.23.1')
await assert.rejects(downloadPublishedCatalog(candidate, root, fetchFixture), /must be empty/i)
console.log('Published Catalog download contract passed.')
