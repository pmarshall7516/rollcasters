import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const source = path.resolve('../assets/ui/small-logo.png')
const target = path.resolve('src-tauri/icons/icon-source.png')
const metadata = await sharp(source).metadata()
if (metadata.width !== 300 || metadata.height !== 258) throw new Error('The approved Rollcasters icon source dimensions changed; review the new master before regenerating icons.')
fs.mkdirSync(path.dirname(target), { recursive: true })
await sharp(source)
  .resize({ width: 960, height: 960, fit: 'contain', withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 32, bottom: 32, left: 32, right: 32, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(target)
const output = await sharp(target).metadata()
if (output.width !== 1024 || output.height !== 1024 || !output.hasAlpha) throw new Error('Desktop icon generation did not produce a square transparent PNG.')
console.log(`Created deterministic desktop icon master at ${target}.`)
