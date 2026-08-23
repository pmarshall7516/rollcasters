import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const profile = process.argv[2]
if (!['local', 'stable'].includes(profile)) throw new Error('Desktop profile must be local or stable.')
const publicKey = String(process.env.TAURI_UPDATER_PUBLIC_KEY ?? '').trim()
const version = String(process.env.ROLLCASTERS_GAME_VERSION ?? (profile === 'local' ? '0.1.0-local' : '')).trim()
if (profile === 'stable' && !publicKey) throw new Error('Stable packaging requires TAURI_UPDATER_PUBLIC_KEY from the protected signing environment.')
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`${profile} packaging requires ROLLCASTERS_GAME_VERSION as SemVer.`)
if (publicKey && !/^[A-Za-z0-9+/=]+$/.test(publicKey)) throw new Error('TAURI_UPDATER_PUBLIC_KEY must be base64 encoded.')
const generated = path.resolve('src-tauri', `tauri.${profile}.signing.conf.json`)
const overlays = profile === 'local' ? ['src-tauri/tauri.local.conf.json', generated] : [generated]
let exitStatus = 0
try {
  fs.writeFileSync(generated, `${JSON.stringify(profile === 'local' ? { version } : { version, plugins: { updater: { pubkey: publicKey } } }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  const bundleArgs = process.env.TAURI_BUNDLES?.trim() ? ['--bundles', process.env.TAURI_BUNDLES.trim()] : []
  const tauriCli = path.resolve('node_modules', '@tauri-apps', 'cli', 'tauri.js')
  if (!fs.existsSync(tauriCli)) throw new Error('The local Tauri CLI is missing; run npm ci before packaging.')
  const result = spawnSync(process.execPath, [tauriCli, 'build', ...overlays.flatMap((config) => ['--config', config]), ...bundleArgs], { stdio: 'inherit', env: { ...process.env, VITE_GAME_VERSION: version } })
  if (result.error) throw result.error
  if (result.status !== 0) exitStatus = result.status ?? 1
} finally {
  if (fs.existsSync(generated)) fs.unlinkSync(generated)
}
if (exitStatus !== 0) process.exit(exitStatus)
