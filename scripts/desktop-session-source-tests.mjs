import assert from 'node:assert/strict'
import fs from 'node:fs'

const supabase = fs.readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
assert.match(supabase, /detectSessionInUrl: !desktopRuntime/)
assert.match(supabase, /legacySupabase = createGameClient\(true, desktopProfile\.storageNamespace\)/)
assert.match(supabase, /createAccountSupabaseClient[\s\S]*createGameClient\(false\)/)
assert.doesNotMatch(supabase, /createDesktopSessionStorage|session_get|session_set|session_delete/)
assert.match(fs.readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8'), /keyring/)
assert.match(fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'), /secure_credential_get|secure_credential_set|secure_credential_delete/)
console.log('Desktop sessions use isolated Supabase clients with native secure credential storage.')
