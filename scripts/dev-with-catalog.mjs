import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const valueAfter = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const releaseId = valueAfter('--release')
const requestedDir = valueAfter('--catalog-dir')
if (!releaseId && !requestedDir) {
  throw new Error('Usage: npm run dev:catalog -- --release YYYY.MM.DD.N or --catalog-dir /absolute/release-directory')
}

const catalogRoot = path.resolve(requestedDir ?? path.join('..', 'rollcaster-dev', 'release-output', String(releaseId)))
const pointerFile = path.join(catalogRoot, 'game-data', 'latest.json')
if (!fs.existsSync(pointerFile)) throw new Error(`Catalog pointer not found: ${pointerFile}`)
const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'))
if (releaseId && pointer.catalogVersion !== releaseId) {
  throw new Error(`Catalog directory contains ${String(pointer.catalogVersion)}, not ${releaseId}.`)
}

const viteCli = path.resolve(path.dirname(require.resolve('vite')), '../../bin/vite.js')
const vitePath = catalogRoot.replaceAll(path.sep, '/')
const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], {
  cwd: path.resolve('.'),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_LOCAL_CATALOG_DIR: catalogRoot,
    VITE_GAME_CATALOG_MODE: 'release',
    VITE_GAME_CATALOG_RELEASE_ID: String(pointer.catalogVersion),
    VITE_GAME_CATALOG_BASE_URL: `/@fs/${vitePath}/game-data`,
    VITE_GAME_ASSET_BASE_URL: `/@fs/${vitePath}/game-assets`,
  },
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})
