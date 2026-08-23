import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const supabase = fs.readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
const migration = fs.readFileSync(new URL('../../rollcaster-docs/migrations/general/20260823193000_open_player_registration.sql', import.meta.url), 'utf8')

assert.doesNotMatch(app, /Player invite|inviteCode/)
assert.match(supabase, /signUp\(email: string, password: string, username: string\)/)
assert.doesNotMatch(supabase, /invite_code/)
assert.match(migration, /drop trigger if exists require_player_registration_invite on auth\.users/i)
console.log('Open player registration contract passed.')
