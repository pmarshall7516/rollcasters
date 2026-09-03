import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseEnv } from './db-utils.mjs'
import {
  assertLoopbackConnection,
  buildPreviewCompatibilityError,
} from './local-player-release-sync.mjs'

const args = process.argv.slice(2)
const value = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const releaseId = value('--release')
const explicitCatalogDir = value('--catalog-dir')
if (!releaseId && !explicitCatalogDir) throw new Error('Pass --release YYYY.MM.DD.N or --catalog-dir <directory>.')
const catalogDir = path.resolve(explicitCatalogDir ?? path.join('..', 'rollcaster-dev', 'release-output', releaseId))
const pointerFile = path.join(catalogDir, 'game-data', 'latest.json')
if (!fs.existsSync(pointerFile)) throw new Error(`Catalog pointer not found: ${pointerFile}`)
const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'))
if (releaseId && pointer.catalogVersion !== releaseId) throw new Error(`Catalog directory contains ${pointer.catalogVersion}, not ${releaseId}.`)

function versionTuple(value) {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) throw new Error(`Invalid Game version: ${value}`)
  return match.slice(1).map(Number)
}

function compareVersions(left, right) {
  const a = versionTuple(left)
  const b = versionTuple(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

const candidatePath = path.resolve('release', 'game-update-candidate.json')
const candidate = fs.existsSync(candidatePath) ? JSON.parse(fs.readFileSync(candidatePath, 'utf8')) : null
const version = value('--version') ?? (candidate?.catalogRelease?.id === pointer.catalogVersion ? candidate.version : undefined)
if (!version) throw new Error('Pass --version X.Y.Z or provide a candidate for the selected Catalog Release.')
if (compareVersions(version, pointer.minimumGameVersion) < 0) {
  throw new Error(`Game ${version} cannot run Catalog ${pointer.catalogVersion}; it requires Game ${pointer.minimumGameVersion} or newer.`)
}

function run(script, scriptArgs, env = process.env) {
  const result = spawnSync(process.execPath, [path.resolve('scripts', script), ...scriptArgs], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const configuredEnv = { ...parseEnv(), ...process.env }
function discoverLocalSupabaseConfig() {
  const status = spawnSync('supabase', ['status', '--workdir', process.cwd(), '-o', 'env'], { encoding: 'utf8' })
  if (status.error || status.status !== 0) return {}
  const values = {}
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^"|"$/g, '')
  }
  return values
}

const localSupabaseStatus = discoverLocalSupabaseConfig()
const localSupabaseUrl = configuredEnv.VITE_LOCAL_SUPABASE_URL ?? localSupabaseStatus.API_URL
const localSupabaseKey = configuredEnv.VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY ?? localSupabaseStatus.ANON_KEY
if (!localSupabaseUrl || !localSupabaseKey) {
  throw new Error('Local preview packaging requires a running local Supabase stack or VITE_LOCAL_SUPABASE_URL and VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY.')
}
assertLoopbackConnection(localSupabaseUrl)

async function verifyLocalPlayerBackend() {
  const healthController = new AbortController()
  const healthTimeout = setTimeout(() => healthController.abort(), 5000)
  try {
    const health = await fetch(`${localSupabaseUrl.replace(/\/$/, '')}/auth/v1/health`, {
      signal: healthController.signal,
    })
    if (!health.ok) throw new Error(`Auth health returned HTTP ${health.status}.`)
  } catch (error) {
    throw new Error(`Local Supabase is not reachable at ${localSupabaseUrl}; run npm run local:player:start first. ${error.message}`)
  } finally {
    clearTimeout(healthTimeout)
  }

  const status = await fetch(`${localSupabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_game_update_status`, {
    method: 'POST',
    headers: {
      apikey: localSupabaseKey,
      Authorization: `Bearer ${localSupabaseKey}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  if (!status.ok) throw new Error(`Local player compatibility status returned HTTP ${status.status}.`)
  const payload = await status.json()
  const active = Array.isArray(payload) ? payload[0] : payload?.active
  if (!active) throw new Error('Local player database has no active Game Update; run npm run local:player:bootstrap first.')
  const activeReleaseId = active.catalogReleaseId ?? active.catalog_release_id
  if (active.version !== version || activeReleaseId !== pointer.catalogVersion) {
    throw new Error(buildPreviewCompatibilityError({
      version,
      releaseId: pointer.catalogVersion,
      activeVersion: active.version,
      activeReleaseId,
    }))
  }
}

await verifyLocalPlayerBackend()

const staged = path.resolve('public', 'desktop-catalog')
if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true })
run('stage-desktop-catalog.mjs', ['--source', catalogDir])
run('build-desktop.mjs', ['local'], {
  ...configuredEnv,
  VITE_SUPABASE_URL: localSupabaseUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: localSupabaseKey,
  VITE_PROMO_DEFINITION_SUPABASE_URL: configuredEnv.VITE_PROMO_DEFINITION_SUPABASE_URL ?? configuredEnv.VITE_SUPABASE_URL,
  VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY: configuredEnv.VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY ?? configuredEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_EXPECTED_SUPABASE_PROJECT_REF: 'rollcasters-local-player',
  ROLLCASTERS_GAME_VERSION: version,
  VITE_GAME_PLAYER_BOOTSTRAP_MODE: 'v1',
  VITE_GAME_LOCAL_CATALOG_PREVIEW: 'true',
})
console.log(`Built the local Rollcasters preview for Catalog ${pointer.catalogVersion} and Game ${version}.`)
