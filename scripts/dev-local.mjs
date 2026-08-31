import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const viteCli = path.resolve(path.dirname(require.resolve('vite')), '../../bin/vite.js')
const requestedRoot = process.env.ROLLCASTERS_CATALOG_RELEASE_DIR
const releasesRoot = path.resolve('..', 'rollcaster-dev', 'release-output')

function newestLocalRelease() {
  if (!fs.existsSync(releasesRoot)) return null
  return fs.readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(entry.name))
    .map((entry) => path.join(releasesRoot, entry.name))
    .filter((root) => fs.existsSync(path.join(root, 'game-data', 'latest.json')))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left), undefined, { numeric: true }))[0] ?? null
}

const catalogRoot = path.resolve(requestedRoot ?? newestLocalRelease() ?? '')
const pointerFile = path.join(catalogRoot, 'game-data', 'latest.json')
if (!fs.existsSync(pointerFile)) {
  throw new Error(`No local Catalog Release was found at ${catalogRoot}. Build a Catalog Release first or set ROLLCASTERS_CATALOG_RELEASE_DIR explicitly.`)
}
const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'))
const catalogPath = catalogRoot.replaceAll(path.sep, '/')
const candidateFile = path.resolve('release', 'game-update-candidate.json')
let candidateGameVersion
if (fs.existsSync(candidateFile)) {
  try {
    const candidate = JSON.parse(fs.readFileSync(candidateFile, 'utf8'))
    if (candidate.catalogRelease?.id === pointer.catalogVersion && typeof candidate.version === 'string') candidateGameVersion = candidate.version
  } catch {
    // The candidate manifest is optional; the configured VITE_GAME_VERSION remains valid for older local releases.
  }
}
const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
  cwd: path.resolve('.'),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_GAME_PROFILE: 'local',
    VITE_PROMO_DEFINITION_SUPABASE_URL: process.env.VITE_PROMO_DEFINITION_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_LOCAL_CATALOG_DIR: catalogRoot,
    VITE_GAME_CATALOG_MODE: 'release',
    VITE_GAME_CATALOG_RELEASE_ID: String(pointer.catalogVersion),
    VITE_GAME_CATALOG_BASE_URL: `/@fs/${catalogPath}/game-data`,
    VITE_GAME_ASSET_BASE_URL: `/@fs/${catalogPath}/game-assets`,
    VITE_GAME_LOCAL_CATALOG_PREVIEW: 'true',
    ...(candidateGameVersion ? { VITE_GAME_VERSION: candidateGameVersion } : {}),
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
