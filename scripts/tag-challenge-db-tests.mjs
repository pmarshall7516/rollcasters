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

  const rows = (await client.query(`
    select c.name,ch.id,ch.challenge_type,ch.parameters
    from public.collectible_unlock_challenges ch
    join public.critters c on ch.collectible_type='critter' and c.id=ch.collectible_id
    where c.name in ('Solanta','Forttera','Shattera','Strixen')
      and ch.challenge_type in ('use_skill','take_damage','deal_damage')
  `)).rows;
  const byName = new Map(rows.map((row) => [row.name,row]));
  for (const name of ["Solanta","Forttera","Shattera","Strixen"]) check(byName.has(name), `${name}'s regression challenge is missing.`);

  for (const row of rows) {
    await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [row.id,JSON.stringify(row.parameters)]);
    for (const removed of ["source_side","target_side","mode","any","target_mode","any_target","target_ids"]) {
      check(!(removed in row.parameters), `${row.name} still contains legacy ${removed}.`);
    }
  }

  check(JSON.stringify(byName.get("Solanta").parameters.skill_ids) === JSON.stringify(["slipstream"]), "Solanta must preserve its specific Slipstream filter.");
  check(JSON.stringify(byName.get("Strixen").parameters.skill_ids) === JSON.stringify(["peck","swipe"]), "Strixen must preserve its specific Peck/Swipe filters.");

  const increment = async (row,eventType,source,target,skill,amount,payload={},sourceElements=[],targetElements=[]) => Number((await client.query(
    "select public.challenge_event_increment_v2($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb,$8::text[],$9::text[]) as amount",
    [row.id,eventType,source,target,skill,amount,JSON.stringify(payload),sourceElements,targetElements],
  )).rows[0].amount);

  check(await increment(byName.get("Solanta"),"skill_resolved","001",null,"slipstream",1,{ skill_element_id: "air" }) === 1, "Solanta must match Slipstream.");
  check(await increment(byName.get("Solanta"),"skill_resolved","001",null,"peck",1,{ skill_element_id: "air" }) === 0, "Solanta must reject a different Skill.");
  const solantaSkillTypeParameters = { ...byName.get("Solanta").parameters, skill_type: "attack" };
  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [byName.get("Solanta").id,JSON.stringify(solantaSkillTypeParameters)]);
  byName.get("Solanta").parameters = solantaSkillTypeParameters;
  check(await increment(byName.get("Solanta"),"skill_resolved","001",null,"slipstream",1,{ skill_element_id: "air", skill_type: "attack" }) === 1, "Use Skill must match the selected Attack Skill Type.");
  check(await increment(byName.get("Solanta"),"skill_resolved","001",null,"slipstream",1,{ skill_element_id: "air", skill_type: "support" }) === 0, "Use Skill must reject the opposite Skill Type.");
  check(await increment(byName.get("Strixen"),"skill_resolved","001",null,"peck",1,{ skill_element_id: "air" }) === 1, "Strixen must match Peck.");
  check(await increment(byName.get("Forttera"),"hp_damage_taken","001","020",null,77) === 77, "Take Damage must track enemy-to-user damage without authored side fields.");
  check(await increment(byName.get("Shattera"),"hp_damage_dealt","020","001",null,83) === 83, "Deal Damage must track user-to-enemy damage without authored side fields.");

  const tagged = (await client.query(`
    select
      (select critter_id from public.critter_tag_assignments where tag_id='first-stage' order by critter_id limit 1) as source_id,
      (select critter_id from public.critter_tag_assignments where tag_id='final-stage' order by critter_id limit 1) as target_id
  `)).rows[0];
  check(tagged.source_id && tagged.target_id, "Default stage tag assignments are required for the database matcher audit.");
  const shattera = byName.get("Shattera");
  const taggedParameters = { ...shattera.parameters, source_critter_tag_ids: ["first-stage"], target_critter_tag_ids: ["final-stage"] };
  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [shattera.id,JSON.stringify(taggedParameters)]);
  check(await increment(shattera,"hp_damage_dealt",tagged.source_id,tagged.target_id,null,31) === 31, "The database matcher must accept matching source and target Critter Tags.");
  check(await increment(shattera,"hp_damage_dealt",tagged.target_id,tagged.source_id,null,31) === 0, "The database matcher must reject reversed Critter Tag filters.");

  console.log("Tag challenge database tests passed; all fixture writes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
