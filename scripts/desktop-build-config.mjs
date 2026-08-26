import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function createDesktopBuildConfig({ profile, version, publicKey }) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollcasters-desktop-'))
  const generated = path.join(temporaryDirectory, `tauri.${profile}.signing.conf.json`)
  try {
    const config = profile === 'local' ? { version } : { version, plugins: { updater: { pubkey: publicKey } } }
    fs.writeFileSync(generated, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    throw error
  }

  let cleaned = false
  return {
    generated,
    cleanup() {
      if (cleaned) return
      cleaned = true
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    },
  }
}
