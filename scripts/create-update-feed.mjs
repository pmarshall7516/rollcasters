import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [,, candidateArg, artifactsArg, outputArg] = process.argv
if (!candidateArg || !artifactsArg || !outputArg) throw new Error('Usage: node scripts/create-update-feed.mjs <candidate.json> <artifacts-dir> <output.json>')
const candidate = JSON.parse(fs.readFileSync(path.resolve(candidateArg), 'utf8'))
const root = path.resolve(artifactsArg)
const files = walk(root)
const named = (suffix) => {
  const matches = files.filter((file) => path.basename(file).endsWith(suffix))
  if (matches.length !== 1) throw new Error(`Expected exactly one ${suffix} artifact; found ${matches.length}.`)
  return matches[0]
}
const macUpdater = named('-arm64.app.tar.gz')
const windowsUpdater = named('-setup.exe')
const dmg = named('-arm64.dmg')
const signature = (file) => {
  const value = fs.readFileSync(`${file}.sig`, 'utf8').trim()
  if (!value) throw new Error(`Updater signature is empty: ${path.basename(file)}.sig`)
  return value
}
const releaseBase = `https://github.com/${candidate.distribution.repository}/releases/download/${encodeURIComponent(candidate.distribution.tag)}`
const descriptor = (file) => {
  const bytes = fs.readFileSync(file)
  return { filename: path.basename(file), byteSize: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), url: `${releaseBase}/${encodeURIComponent(path.basename(file))}` }
}
const mac = descriptor(macUpdater)
const windows = descriptor(windowsUpdater)
const fallback = descriptor(dmg)
const manifest = {
  version: candidate.version,
  notes: candidate.releaseNotes,
  pub_date: candidate.activation?.activatesAt ?? candidate.createdAt,
  platforms: {
    'darwin-aarch64': { signature: signature(macUpdater), url: mac.url },
    'windows-x86_64': { signature: signature(windowsUpdater), url: windows.url },
  },
  rollcasters: {
    schemaVersion: 1, channel: candidate.channel, sourceCommit: candidate.sourceCommit,
    catalogReleaseId: candidate.catalogRelease.id, catalogManifestSha256: candidate.catalogRelease.manifestSha256,
    updaterArtifacts: { darwin: mac, windows }, fallbackDownloads: { darwin: fallback },
  },
}
fs.writeFileSync(path.resolve(outputArg), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ version: candidate.version, platforms: Object.keys(manifest.platforms), output: path.resolve(outputArg) }))

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name))
}
