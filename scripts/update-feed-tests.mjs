import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollcasters-update-feed-'))
const artifacts = path.join(root, 'artifacts')
fs.mkdirSync(artifacts)
for (const [name, value] of [
  ['Rollcasters-1.2.3-arm64.app.tar.gz', 'mac'], ['Rollcasters-1.2.3-arm64.app.tar.gz.sig', 'mac-signature'],
  ['Rollcasters-1.2.3-arm64.dmg', 'dmg'], ['Rollcasters-1.2.3-setup.exe', 'windows'], ['Rollcasters-1.2.3-setup.exe.sig', 'windows-signature'],
]) fs.writeFileSync(path.join(artifacts, name), value)
const candidate = { version: '1.2.3', channel: 'stable', createdAt: '2026-08-21T00:00:00.000Z', sourceCommit: 'a'.repeat(40), releaseNotes: 'Fixture.', catalogRelease: { id: '2026.08.21.1', manifestSha256: 'b'.repeat(64) }, distribution: { repository: 'owner/releases', tag: 'game-v1.2.3' } }
const candidateFile = path.join(root, 'candidate.json')
const output = path.join(root, 'latest.json')
fs.writeFileSync(candidateFile, JSON.stringify(candidate))
execFileSync(process.execPath, [path.resolve('scripts/create-update-feed.mjs'), candidateFile, artifacts, output])
const feed = JSON.parse(fs.readFileSync(output, 'utf8'))
assert.deepEqual(Object.keys(feed.platforms).sort(), ['darwin-aarch64', 'windows-x86_64'])
assert.equal(feed.platforms['windows-x86_64'].signature, 'windows-signature')
assert.match(feed.platforms['darwin-aarch64'].url, /^https:\/\/github\.com\/owner\/releases\/releases\/download\//)
assert.match(feed.rollcasters.updaterArtifacts.darwin.sha256, /^[a-f0-9]{64}$/)
console.log('Signed Tauri static update-feed contract passed.')
