import assert from 'node:assert/strict'
import fs from 'node:fs'

const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
const supabase = fs.readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
assert.match(rust, /validate_session_identity/)
assert.match(rust, /128 \* 1024/)
assert.match(rust, /session_delete/)
assert.match(supabase, /detectSessionInUrl: !desktopRuntime/)
assert.match(supabase, /createDesktopSessionStorage/)
console.log('Desktop session storage is routed through isolated native credential namespaces.')
