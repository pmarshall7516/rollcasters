import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const local = JSON.parse(fs.readFileSync('src-tauri/tauri.local.conf.json', 'utf8'))
assert.equal(base.identifier, 'com.rollcasters.game')
assert.equal(local.identifier, 'com.rollcasters.local')
assert.equal(base.bundle.macOS.signingIdentity, '-', 'The initial macOS channel must use ad-hoc signing.')
assert.deepEqual(base.bundle.targets, ['dmg', 'nsis'])
assert.deepEqual(base.bundle.icon, [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico',
], 'macOS and Windows bundles must use the generated Rollcasters icon assets.')
for (const icon of base.bundle.icon) assert.ok(fs.existsSync(`src-tauri/${icon}`), `Configured desktop icon is missing: ${icon}`)
assert.equal(base.bundle.createUpdaterArtifacts, true)
assert.equal(base.bundle.windows.nsis.installMode, 'currentUser')
assert.deepEqual(base.bundle.macOS.dmg, {
  windowSize: { width: 660, height: 400 },
  appPosition: { x: 180, y: 170 },
  applicationFolderPosition: { x: 480, y: 170 },
}, 'Every macOS DMG must use the standard app-to-Applications layout.')
assert.ok(base.app.security.csp && !base.app.security.csp.includes("default-src *"), 'Desktop CSP must fail closed.')
assert.ok(base.app.security.csp.match(/img-src[^;]*http:\/\/127\.0\.0\.1:1430/), 'Desktop CSP must allow packaged artwork from the loopback asset server.')
assert.ok(base.app.security.csp.includes('http://127.0.0.1:1430'), 'Desktop CSP must allow only the loopback catalog server.')
const catalogReleaseSource = fs.readFileSync('src/lib/catalog-release.ts', 'utf8')
assert.ok(catalogReleaseSource.includes('tauri://localhost'), 'Catalog URL resolution must handle the macOS Tauri origin.')
assert.ok(catalogReleaseSource.includes('http://tauri.localhost'), 'Catalog URL resolution must provide an HTTP(S) alias for macOS Tauri assets.')
assert.ok(catalogReleaseSource.includes('normalizeAppUrl(location.origin)'), 'Catalog cache keys must not use the non-HTTP macOS Tauri origin.')
const viteConfig = fs.readFileSync('vite.config.ts', 'utf8')
assert.ok(viteConfig.includes('http://127.0.0.1:1430') && viteConfig.includes('/desktop-catalog/game-data'), 'Desktop builds must use the loopback catalog server.')
assert.ok(!JSON.stringify(base).match(/service.role|private.key|password/i), 'Desktop configuration must not carry secret material.')
assert.notEqual(base.plugins.updater.pubkey, '', 'Updater verification may not be disabled.')
assert.notEqual(base.plugins.updater.pubkey, 'DESKTOP_UPDATER_PUBLIC_KEY_REQUIRED', 'A real updater public key must be compiled into the client.')
assert.ok(base.plugins.updater.endpoints.every((endpoint) => endpoint.startsWith('https://')))
assert.deepEqual(base.plugins.updater.endpoints, ['https://github.com/pmarshall7516/rollcaster-releases/releases/latest/download/latest.json'])
assert.equal(base.plugins.updater.dangerousInsecureTransportProtocol, undefined)
assert.equal(local.plugins.updater.active, false, 'Local tooling must not participate in the Stable updater channel.')
const buildScript = fs.readFileSync('scripts/build-desktop.mjs', 'utf8')
assert.match(buildScript, /TAURI_UPDATER_PUBLIC_KEY/, 'Release packaging must inject its protected public key.')
assert.match(buildScript, /spawnSync\(process\.execPath/, 'Release packaging must invoke the local Tauri JavaScript CLI cross-platform.')
assert.doesNotMatch(buildScript, /npx\.cmd/, 'Release packaging must not spawn the Windows command shim directly.')
const stageScript = fs.readFileSync('scripts/stage-desktop-catalog.mjs', 'utf8')
assert.match(stageScript, /ROLLCASTERS_EXPECTED_CATALOG_ID/)
assert.match(stageScript, /args\.find\(\(argument\) => !argument\.startsWith/)
console.log('Tauri desktop configuration contract passed.')
