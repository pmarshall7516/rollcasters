import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

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

const staged = path.resolve('public', 'desktop-catalog')
if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true })
run('stage-desktop-catalog.mjs', ['--source', catalogDir])
run('build-desktop.mjs', ['local'], {
  ...process.env,
  ROLLCASTERS_GAME_VERSION: version,
  VITE_GAME_PLAYER_BOOTSTRAP_MODE: 'v1',
  VITE_GAME_LOCAL_CATALOG_PREVIEW: 'true',
})
console.log(`Built the local Rollcasters preview for Catalog ${pointer.catalogVersion} and Game ${version}.`)
