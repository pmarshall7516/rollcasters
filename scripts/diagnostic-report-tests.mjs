import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/lib/diagnostics.ts', import.meta.url), 'utf8')
assert.match(source, /schemaVersion: 1/)
assert.match(source, /rollcasters-diagnostics-/)
assert.doesNotMatch(source, /accessToken|refreshToken|email|userId|localStorage|sessionStorage/)
assert.match(source, /profile\.projectRef/)
console.log('Allowlisted redacted diagnostic report contract passed.')
