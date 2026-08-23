import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('.')
const base = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'))
const serialized = JSON.stringify(base)
if (!String(base.app?.security?.csp).includes("default-src 'self'")) throw new Error('Desktop CSP must default to self.')
if (/unsafe-eval|script-src[^;]*https?:/i.test(base.app.security.csp)) throw new Error('Desktop CSP permits remote executable script or unsafe eval.')
for (const endpoint of base.plugins?.updater?.endpoints ?? []) if (!String(endpoint).startsWith('https://')) throw new Error('Updater endpoints must use HTTPS.')
if (capability.windows?.length !== 1 || capability.windows[0] !== 'main') throw new Error('Native capabilities must be scoped to the main window.')
if (capability.permissions.some((permission) => /shell|filesystem|dialog|http|window-create/i.test(permission))) throw new Error('Desktop capability includes an unnecessary high-risk permission.')
if (/posthog|segment|sentry|mixpanel/i.test(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))) throw new Error('Initial Beta may not automatically upload telemetry.')
if (/service.?role|database.?password|signing.?private/i.test(serialized)) throw new Error('Desktop config contains a forbidden secret field.')

const scanRoots = [path.join(root, 'dist'), path.join(root, 'src-tauri/target/release/bundle')].filter(fs.existsSync)
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /TAURI_SIGNING_PRIVATE_KEY/,
]
for (const directory of scanRoots) {
  for (const file of walk(directory)) {
    const bytes = fs.readFileSync(file)
    if (bytes.byteLength > 80 * 1024 * 1024) continue
    const content = bytes.toString('latin1')
    for (const pattern of forbidden) if (pattern.test(content)) throw new Error(`Forbidden secret-like content found in ${path.relative(root, file)}.`)
  }
}
console.log(`Desktop security audit passed across ${scanRoots.length} build root${scanRoots.length === 1 ? '' : 's'}.`)

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) return []
    return entry.isDirectory() ? walk(target) : target
  })
}
