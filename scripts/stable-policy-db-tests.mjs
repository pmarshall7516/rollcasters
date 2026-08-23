import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDbClient } from './db-utils.mjs'

const client = createDbClient()
async function expectPolicyError(code) {
  await client.query('savepoint expected_policy_error')
  try {
    await client.query('select private.enforce_game_client_policy()')
    assert.fail(`Expected ${code}.`)
  } catch (error) {
    assert.equal(error.code, 'PGRST')
    assert.match(error.message, new RegExp(code))
  } finally {
    await client.query('rollback to savepoint expected_policy_error')
    await client.query('release savepoint expected_policy_error')
  }
}
await client.connect()
try {
  await client.query('begin')
  const userId = randomUUID()
  const updateId = 'stable:999.999.999'
  await client.query(
    `insert into public.game_updates(
      id,version,source_tag,source_commit,ai_lab_commit,catalog_release_id,catalog_manifest_sha256,
      asset_git_revision,client_protocol_version,content_schema_version,combat_runtime_version,
      release_notes,manifest,manifest_sha256)
     values($1,'999.999.999','policy-test',$2,$2,'2026.08.22.1',$3,$2,1,1,1,'Transactional policy test','{}',$3)`,
    [updateId, 'a'.repeat(40), 'b'.repeat(64)],
  )
  await client.query('update public.game_update_policy set active_update_id=$1 where singleton', [updateId])
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'authenticated', sub: userId })])
  await client.query("select set_config('request.path','/rpc/player_bootstrap_v1',true)")

  await client.query("select set_config('request.headers',$1,true)", [JSON.stringify({
    'x-rollcasters-version': '999.999.999',
    'x-rollcasters-catalog-release': '2026.08.22.1',
    'x-rollcasters-protocol': '1',
  })])
  await client.query('select private.enforce_game_client_policy()')

  await client.query("select set_config('request.headers',$1,true)", [JSON.stringify({
    'x-rollcasters-version': '999.999.999',
    'x-rollcasters-catalog-release': 'forged-catalog',
    'x-rollcasters-protocol': '1',
  })])
  await expectPolicyError('GAME_UPDATE_REQUIRED')

  await client.query('update public.game_update_policy set maintenance_mode=true,maintenance_reason=$1 where singleton', ['Transactional maintenance test'])
  await expectPolicyError('GAME_MAINTENANCE')
  await client.query('rollback')
  console.log('Stable server policy transactional tests passed; no policy or player data committed.')
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
