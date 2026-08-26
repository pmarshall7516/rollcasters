import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const fixture = await client.query(`
    select
      player.id as user_id,
      owned.critter_id as target_critter_id,
      challenge.id as challenge_id,
      challenge.collectible_type,
      challenge.collectible_id,
      dungeon.dungeon_id,
      deal_challenge.id as deal_challenge_id,
      deal_challenge.collectible_type as deal_collectible_type,
      deal_challenge.collectible_id as deal_collectible_id,
      deal_challenge.parameters as deal_challenge_parameters
    from auth.users player
    join lateral (
      select critter_id
      from public.user_critters
      where user_id=player.id
      order by critter_id
      limit 1
    ) owned on true
    join lateral (
      select c.id,c.collectible_type,c.collectible_id
      from public.collectible_unlock_challenges c
      left join public.user_collectible_challenge_progress progress
        on progress.user_id=player.id and progress.challenge_id=c.id
      where c.challenge_type='take_damage'
        and c.parameters->>'tracking_required'='true'
        and exists (
          select 1
          from public.collectible_challenge_states(player.id,c.collectible_type,c.collectible_id) state
          where state.challenge_id=c.id and state.eligible and not state.complete
        )
      order by c.collectible_type,c.collectible_id,c.sort_order,c.id
      limit 1
    ) challenge on true
    join lateral (
      select dungeon_id
      from public.user_dungeon_progress
      where user_id=player.id and is_unlocked
      order by dungeon_id
      limit 1
    ) dungeon on true
    join lateral (
      select c.id,c.collectible_type,c.collectible_id,c.parameters
      from public.collectible_unlock_challenges c
      where c.challenge_type='deal_damage'
        and c.collectible_type='relic'
        and c.collectible_id='017'
        and c.parameters->>'tracking_required'='true'
        and exists (
          select 1
          from public.collectible_challenge_states(player.id,c.collectible_type,c.collectible_id) state
          where state.challenge_id=c.id and state.eligible and not state.complete
        )
      order by c.collectible_type,c.collectible_id,c.sort_order,c.id
      limit 1
    ) deal_challenge on true
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs an unstarted tracked Receive Damage challenge with no stored progress.");

  const { user_id: userId, target_critter_id: targetCritterId, challenge_id: challengeId, collectible_type: collectibleType, collectible_id: collectibleId, dungeon_id: dungeonId, deal_challenge_id: dealChallengeId, deal_challenge_parameters: dealChallengeParameters } = fixture.rows[0];
  check(dealChallengeParameters?.damage_mode === "any", "Tiny Blade Deal Damage must author Any damage so HP and Shield damage both count.");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, challengeId]);
  await client.query(
    "insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order) values($1,$2,1)",
    [userId, challengeId],
  );

  const runId = (await client.query("select public.start_dungeon_run($1) as id", [dungeonId])).rows[0].id;
  const opponentId = (await client.query("select selected_opponents->0->>'critter_id' as id from public.dungeon_runs where id=$1", [runId])).rows[0].id;
  check(Boolean(opponentId), "The challenge-progress fixture dungeon must select an opponent.");

  const snapshot = (await client.query(
    "select public.submit_collectible_combat_events($1,1,$2::jsonb) as snapshot",
    [runId, JSON.stringify([{
      event_key: "receive-damage-regression",
      event_type: "hp_damage_taken",
      source_critter_id: opponentId,
      target_critter_id: targetCritterId,
      skill_id: null,
      amount: 7,
      payload: {},
    }])],
  )).rows[0].snapshot;
  const progress = snapshot.progress.find((row) => row.challenge_id === challengeId);
  check(progress?.current === "7", "A normalized hp_damage_taken event must create progress for a newly tracked Receive Damage challenge.");
  check((await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, challengeId],
  )).rows[0]?.progress === "7", "Receive Damage progress must persist after the combat event is submitted.");

  const state = (await client.query(
    "select raw_progress,eligible,complete,trackable from public.collectible_challenge_states($1,$2,$3) where challenge_id=$4",
    [userId, collectibleType, collectibleId, challengeId],
  )).rows[0];
  check(state?.raw_progress === "7" && state.eligible === true && state.complete === false && state.trackable === true,
    "A tracked challenge with no prior progress must project zero before the event and remain eligible after it.");

  const progressValue = async () => (await client.query(
    "select coalesce(progress,0)::text as progress from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, challengeId],
  )).rows[0]?.progress ?? "0";
  const setDamageMode = async (mode) => {
    await client.query(
      "update public.collectible_unlock_challenges set parameters=jsonb_set(parameters,'{damage_mode}',to_jsonb($1::text),true) where id=$2",
      [mode, challengeId],
    );
  };
  const submit = async (eventKey, eventType, sourceId, targetId, amount, payload) => client.query(
    "select public.submit_collectible_combat_events($1,1,$2::jsonb) as snapshot",
    [runId, JSON.stringify([{ event_key: eventKey, event_type: eventType, source_critter_id: sourceId, target_critter_id: targetId, skill_id: null, amount, payload }])],
  );

  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, challengeId]);
  await setDamageMode("hp_only");
  await submit("take-shield-hp-only", "hp_damage_taken", opponentId, targetCritterId, 7, { hp_damage: 0, shield_damage: 7 });
  check(await progressValue() === "0", "HP-only Take Damage must ignore Shield damage.");

  await setDamageMode("shield_only");
  await submit("take-shield-shield-only", "hp_damage_taken", opponentId, targetCritterId, 7, { hp_damage: 0, shield_damage: 7 });
  check(await progressValue() === "7", "Shield-only Take Damage must count actual Shield damage.");

  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, challengeId]);
  await setDamageMode("hp_only");
  await submit("take-hp-hp-only", "hp_damage_taken", opponentId, targetCritterId, 7, { hp_damage: 7, shield_damage: 0 });
  check(await progressValue() === "7", "HP-only Take Damage must count actual HP damage.");

  await client.query("savepoint malformed_damage");
  let malformedRejected = false;
  try {
    await submit("take-malformed-components", "hp_damage_taken", opponentId, targetCritterId, 7, { hp_damage: 3, shield_damage: 3 });
  } catch {
    malformedRejected = true;
    await client.query("rollback to savepoint malformed_damage");
  }
  check(malformedRejected, "Damage receipts must reject component totals that do not equal amount.");

  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, dealChallengeId]);
  await client.query(
    "insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order) values($1,$2,1)",
    [userId, dealChallengeId],
  );
  await client.query(
    "update public.collectible_unlock_challenges set parameters=jsonb_set(parameters,'{damage_mode}',to_jsonb('shield_only'::text),true) where id=$1",
    [dealChallengeId],
  );
  await submit("deal-shield-shield-only", "hp_damage_dealt", targetCritterId, opponentId, 6, { hp_damage: 0, shield_damage: 6 });
  const dealProgressValue = async () => (await client.query(
    "select coalesce(progress,0)::text as progress from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, dealChallengeId],
  )).rows[0]?.progress ?? "0";
  check(await dealProgressValue() === "6", "Shield-only Deal Damage must count actual enemy Shield damage.");

  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, dealChallengeId]);
  await client.query("update public.collectible_unlock_challenges set parameters=jsonb_set(parameters,'{damage_mode}',to_jsonb('hp_only'::text),true) where id=$1", [dealChallengeId]);
  await submit("deal-hp-hp-only", "hp_damage_dealt", targetCritterId, opponentId, 6, { hp_damage: 6, shield_damage: 0 });
  check(await dealProgressValue() === "6", "HP-only Deal Damage must count actual enemy HP damage.");
  await submit("deal-hp-hp-only", "hp_damage_dealt", targetCritterId, opponentId, 6, { hp_damage: 6, shield_damage: 0 });
  check(await dealProgressValue() === "6", "Duplicate damage event receipts must not double-count progress.");

  console.log(`Tiny Blade and Receive Damage challenge progress regression passed for ${dealChallengeId} and ${challengeId}; all fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
