import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [,, platform, version, outputArg] = process.argv
if (!['macos', 'windows'].includes(platform) || !version || !outputArg) throw new Error('Usage: node scripts/collect-desktop-artifacts.mjs <macos|windows> <version> <output-dir>')
const root = path.resolve('src-tauri/target/release/bundle')
const output = path.resolve(outputArg)
fs.mkdirSync(output, { recursive: true })
const allFiles = walk(root)
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const select = platform === 'macos'
  ? [find(new RegExp(`^Rollcasters_${escapedVersion}_aarch64\\.dmg$`)), find(/^Rollcasters\.app\.tar\.gz$/), find(/^Rollcasters\.app\.tar\.gz\.sig$/)]
  : [find(new RegExp(`^Rollcasters_${escapedVersion}_[^-]+-setup\\.exe$`)), find(new RegExp(`^Rollcasters_${escapedVersion}_[^-]+-setup\\.exe\\.sig$`))]
const names = platform === 'macos'
  ? [`Rollcasters-${version}-arm64.dmg`, `Rollcasters-${version}-arm64.app.tar.gz`, `Rollcasters-${version}-arm64.app.tar.gz.sig`]
  : [`Rollcasters-${version}-setup.exe`, `Rollcasters-${version}-setup.exe.sig`]
const artifacts = select.map((source, index) => {
  const target = path.join(output, names[index])
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  const bytes = fs.readFileSync(target)
  return { filename: names[index], byteSize: bytes.byteLength, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
})
fs.writeFileSync(path.join(output, `${platform}-artifacts.json`), `${JSON.stringify({ platform, version, artifacts }, null, 2)}\n`, { flag: 'wx' })

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : path.join(directory, entry.name))
}
function find(pattern) {
  const matches = allFiles.filter((file) => pattern.test(path.basename(file)))
  if (matches.length !== 1) throw new Error(`Expected exactly one artifact matching ${pattern}; found ${matches.length}.`)
  return matches[0]
}
