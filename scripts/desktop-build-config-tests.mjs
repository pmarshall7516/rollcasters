import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDesktopBuildConfig } from './desktop-build-config.mjs'

const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rollcasters-desktop-config-test-'))
try {
  const stalePath = path.join(staleRoot, 'tauri.local.signing.conf.json')
  fs.writeFileSync(stalePath, '{"version":"stale"}\n')

  const first = createDesktopBuildConfig({ profile: 'local', version: '1.0.6', publicKey: '' })
  const second = createDesktopBuildConfig({ profile: 'local', version: '1.0.7', publicKey: '' })
  assert.notEqual(first.generated, second.generated, 'Concurrent builds must not share a generated config path.')
  assert.deepEqual(JSON.parse(fs.readFileSync(first.generated, 'utf8')), { version: '1.0.6' })
  assert.deepEqual(JSON.parse(fs.readFileSync(second.generated, 'utf8')), { version: '1.0.7' })
  assert.equal(fs.statSync(first.generated).mode & 0o777, 0o600)
  assert.equal(fs.statSync(second.generated).mode & 0o777, 0o600)

  first.cleanup()
  first.cleanup()
  second.cleanup()
  assert.equal(fs.existsSync(first.generated), false)
  assert.equal(fs.existsSync(second.generated), false)
  assert.equal(fs.existsSync(stalePath), true, 'Cleanup must not remove files it did not create.')
} finally {
  fs.rmSync(staleRoot, { recursive: true, force: true })
}

console.log('Desktop generated-config lifecycle contract passed.')
