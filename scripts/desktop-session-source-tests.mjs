import assert from 'node:assert/strict'
import fs from 'node:fs'

const supabase = fs.readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
assert.match(supabase, /detectSessionInUrl: !desktopRuntime/)
assert.match(supabase, /storageKey: desktopProfile\.storageNamespace/)
assert.doesNotMatch(supabase, /createDesktopSessionStorage|session_get|session_set|session_delete/)
assert.doesNotMatch(fs.readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8'), /keyring/)
assert.doesNotMatch(fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'), /keyring|session_get|session_set|session_delete/)
console.log('Desktop sessions use app-local WebView storage without native keychain access.')
