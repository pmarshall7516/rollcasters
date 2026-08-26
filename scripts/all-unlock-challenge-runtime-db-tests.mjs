import { createDbClient } from "./db-utils.mjs";

const TRACKED_TYPES = new Set([
  "knock_out_critters", "deal_damage", "take_damage", "use_skill",
  "squad_composition", "dungeon_clear", "resource_spending", "swap_action",
  "block_action", "dice_roll", "heal_hp", "defeat_rollcaster_type",
  "afflict_status", "stun_activation", "shields_shattered",
]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function arrayOf(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

function firstOr(value, fallback) {
  return arrayOf(value)[0] ?? fallback;
}

function chooseCritter(critters, ids, elements, tags, label) {
  const idFilter = new Set(arrayOf(ids));
  const elementFilter = new Set(arrayOf(elements));
  const tagFilter = new Set(arrayOf(tags));
  const row = critters.find((candidate) => {
    if (idFilter.size > 0 && !idFilter.has(candidate.id)) return false;
    if (elementFilter.size > 0 && !candidate.element_ids.some((id) => elementFilter.has(id))) return false;
    if (tagFilter.size > 0 && !candidate.tag_ids.some((id) => tagFilter.has(id))) return false;
    return true;
  });
  check(row, `${label} has no matching Critter in the published catalog.`);
  return row;
}

function chooseSkill(skills, ids, elements, tags, skillType, label) {
  const idFilter = new Set(arrayOf(ids));
  const elementFilter = new Set(arrayOf(elements));
  const tagFilter = new Set(arrayOf(tags));
  const row = skills.find((candidate) => {
    if (idFilter.size > 0 && !idFilter.has(candidate.id)) return false;
    if (elementFilter.size > 0 && !elementFilter.has(candidate.element_id)) return false;
    if (tagFilter.size > 0 && !candidate.tag_ids.some((id) => tagFilter.has(id))) return false;
    if (skillType && skillType !== "any" && candidate.skill_type !== skillType) return false;
    return true;
  });
  check(row, `${label} has no matching Skill in the published catalog.`);
  return row;
}

function squadFor(parameters, critters) {
  const requiredCritters = arrayOf(parameters.required_critter_ids);
  const requiredElements = arrayOf(parameters.required_element_ids);
  const selected = [];
  const add = (critter) => {
    if (critter && !selected.some((row) => row.critter_id === critter.id)) {
      selected.push({ critter_id: critter.id, element_ids: critter.element_ids, survived: true });
    }
  };
  requiredCritters.forEach((id) => add(critters.find((row) => row.id === id)));
  requiredElements.forEach((element) => add(critters.find((row) => row.element_ids.includes(element))));
  if (selected.length === 0) add(critters[0]);
  for (const element of requiredElements) {
    if (!selected.some((row) => row.element_ids.includes(element))) {
      add(critters.find((row) => row.element_ids.includes(element)));
    }
  }
  return selected;
}

function eventFor(row, critters, skills, dungeons) {
  const p = row.parameters ?? {};
  const source = chooseCritter(critters, p.source_critter_ids ?? p.critter_ids, p.source_element_ids, p.source_critter_tag_ids, `${row.id} source`);
  const target = chooseCritter(critters, p.target_critter_ids ?? p.enemy_critter_ids, p.target_element_ids ?? p.enemy_element_ids, p.target_critter_tag_ids, `${row.id} target`);
  const sourceElements = source.element_ids;
  const targetElements = target.element_ids;
  const basePayload = {
    source_element_ids: sourceElements,
    target_element_ids: targetElements,
    source_critter_tag_ids: source.tag_ids,
    target_critter_tag_ids: target.tag_ids,
  };

  if (["deal_damage", "take_damage"].includes(row.challenge_type)) {
    const skill = (arrayOf(p.source_skill_tag_ids).length > 0)
      ? chooseSkill(skills, [], [], p.source_skill_tag_ids, undefined, `${row.id} source Skill`)
      : null;
    const mode = p.damage_mode ?? "any";
    const payload = { ...basePayload, hp_damage: mode === "shield_only" ? 0 : 1, shield_damage: mode === "hp_only" ? 0 : 1 };
    return { eventType: row.challenge_type === "deal_damage" ? "hp_damage_dealt" : "hp_damage_taken", sourceId: source.id, targetId: target.id, skillId: skill?.id ?? null, amount: 1, payload };
  }

  if (row.challenge_type === "knock_out_critters") {
    return { eventType: "critter_knocked_out", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: basePayload };
  }

  if (row.challenge_type === "use_skill") {
    const skill = chooseSkill(skills, p.skill_ids, p.element_ids, p.skill_tag_ids ?? p.source_skill_tag_ids, p.skill_type, `${row.id} Skill`);
    return { eventType: "skill_resolved", sourceId: source.id, targetId: target.id, skillId: skill.id, amount: 1, payload: { ...basePayload, skill_type: skill.skill_type, skill_element_id: skill.element_id, skill_tag_ids: skill.tag_ids } };
  }

  if (row.challenge_type === "heal_hp") {
    return { eventType: "hp_healed", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: { ...basePayload, source_side: "player", recipient_side: p.recipient_side === "enemy" ? "enemy" : "friendly" } };
  }

  if (row.challenge_type === "defeat_rollcaster_type") {
    return { eventType: "battle_completed", sourceId: null, targetId: null, skillId: null, amount: 1, payload: { won: true, enemy_rollcaster_type: firstOr(p.rollcaster_types, "acolyte") } };
  }

  if (row.challenge_type === "afflict_status") {
    const mode = p.affliction_mode ?? "fresh_afflictions";
    return { eventType: mode === "afflicted_turns" ? "status_turn_completed" : "status_afflicted", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: { ...basePayload, status_ids: arrayOf(p.status_ids), target_side: p.target_side === "enemies" ? "opponent" : p.target_side === "friendlies" ? "player" : "player", fresh: true } };
  }

  if (row.challenge_type === "stun_activation") {
    return { eventType: "stun_activated", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: { ...basePayload, target_side: p.target_side === "enemies" ? "opponent" : p.target_side === "friendlies" ? "player" : "player", stun_activated: true } };
  }

  if (row.challenge_type === "shields_shattered") {
    return { eventType: "shield_shattered", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: { ...basePayload, target_side: p.shield_side === "enemies" ? "opponent" : p.shield_side === "friendlies" ? "player" : "player", shield_shattered: true } };
  }

  if (row.challenge_type === "resource_spending") {
    const sourceId = firstOr(p.critter_ids, source.id);
    const payload = {
      spending_context: p.spending_context,
      resource_type: p.resource_type,
      custom_currency_id: p.custom_currency_id,
      dungeon_id: firstOr(p.dungeon_ids, ""),
      ability_id: firstOr(p.ability_ids, ""),
      rollcaster_id: firstOr(p.rollcaster_ids, ""),
      shop_id: firstOr(p.shop_ids, ""),
      purchased_collectible_category: firstOr(p.purchased_collectible_categories, ""),
    };
    return { eventType: "resource_spent", sourceId, targetId: null, skillId: null, amount: 1, payload };
  }

  if (row.challenge_type === "swap_action") {
    const action = p.tracked_action;
    const payload = { ...basePayload, dungeon_id: firstOr(p.dungeon_ids, ""), incoming_critter_id: source.id, incoming_element_ids: sourceElements, unique: true, damage_avoided: 1, knockout_after_swap: true };
    return { eventType: "swap_completed", sourceId: source.id, targetId: null, skillId: null, amount: 1, payload: { ...payload, tracked_action: action } };
  }

  if (row.challenge_type === "block_action") {
    return { eventType: "block_completed", sourceId: source.id, targetId: target.id, skillId: null, amount: 1, payload: { ...basePayload, dungeon_id: firstOr(p.dungeon_ids, ""), damage_prevented: 1, fully_blocked: true, survived: true } };
  }

  if (row.challenge_type === "dice_roll") {
    const trackedResult = p.tracked_result;
    const targetValue = Number(p.target_value ?? 0);
    const payload = { die_type: firstOr(p.die_types, "d6"), ability_id: firstOr(p.ability_ids, ""), dungeon_id: firstOr(p.dungeon_ids, ""), turn_mana_total: targetValue, modified_value: targetValue, natural_value: targetValue, natural_maximum: targetValue, matching_count: targetValue };
    if (trackedResult === "maximum_die_result") payload.natural_value = payload.natural_maximum = 6;
    if (trackedResult === "matching_dice") payload.matching_count = targetValue;
    return { eventType: "dice_resolved", sourceId: source.id, targetId: null, skillId: null, amount: 1, payload };
  }

  if (row.challenge_type === "squad_composition") {
    const squad = squadFor(p, critters);
    const eventType = p.completion_event === "dungeon_clear" ? "dungeon_completed" : "battle_completed";
    return { eventType, sourceId: null, targetId: null, skillId: null, amount: 1, payload: { won: true, squad, survivors_complete: true } };
  }

  if (row.challenge_type === "dungeon_clear") {
    const dungeonId = p.dungeon_selection === "specific_dungeon"
      ? firstOr(p.dungeon_ids, dungeons[0].id)
      : firstOr(p.minimum_dungeon_ids, dungeons[0].id);
    const dungeon = dungeons.find((candidate) => candidate.id === dungeonId) ?? dungeons[0];
    return { eventType: "dungeon_completed", sourceId: null, targetId: null, skillId: null, amount: 1, payload: { won: true, dungeon_id: dungeon.id, dungeon_order: dungeon.sort_order, required_relics_activated: p.require_relic_activation === true } };
  }

  throw new Error(`No event fixture for ${row.challenge_type}`);
}

const client = createDbClient();
try {
  await client.connect();
  const releaseId = (await client.query("select public.current_game_catalog_release_id() as id")).rows[0].id;
  const rows = (await client.query(`
    select id, challenge_type, parameters
    from public.release_collectible_challenges($1)
    where challenge_type = any($2::text[])
    order by challenge_type, id
  `, [releaseId, [...TRACKED_TYPES]])).rows;
  const critterRows = (await client.query("select id,element_1_id,element_2_id from public.release_critters($1)", [releaseId])).rows;
  const tagRows = (await client.query("select critter_id,tag_id from public.critter_tag_assignments")).rows;
  const tagsByCritter = new Map();
  for (const row of tagRows) tagsByCritter.set(row.critter_id, [...(tagsByCritter.get(row.critter_id) ?? []), row.tag_id]);
  const critters = critterRows.map((row) => ({ id: row.id, element_ids: [row.element_1_id, row.element_2_id].filter(Boolean), tag_ids: tagsByCritter.get(row.id) ?? [] }));
  const skillRows = (await client.query("select id,element_id,skill_type from public.release_skills($1)", [releaseId])).rows;
  const skillTagRows = (await client.query("select skill_id,tag_id from public.skill_tag_assignments")).rows;
  const tagsBySkill = new Map();
  for (const row of skillTagRows) tagsBySkill.set(row.skill_id, [...(tagsBySkill.get(row.skill_id) ?? []), row.tag_id]);
  const skills = skillRows.map((row) => ({ ...row, tag_ids: tagsBySkill.get(row.id) ?? [] }));
  const dungeons = (await client.query("select id,sort_order from public.release_dungeons($1)", [releaseId])).rows;
  check(rows.length > 0, "The published catalog has no tracked unlock challenges to audit.");

  const counts = {};
  for (const row of rows) {
    const event = eventFor(row, critters, skills, dungeons);
    const increment = (await client.query(
      "select public.challenge_event_increment_v2($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::bigint,$7::jsonb,$8::text[],$9::text[]) as increment",
      [row.id, event.eventType, event.sourceId, event.targetId, event.skillId, event.amount, JSON.stringify(event.payload), event.payload.source_element_ids ?? [], event.payload.target_element_ids ?? []],
    )).rows[0].increment;
    check(BigInt(increment) > 0n, `${row.id} (${row.challenge_type}) did not match its authored event fixture.`);
    counts[row.challenge_type] = (counts[row.challenge_type] ?? 0) + 1;
  }

  console.log(`Published unlock challenge matcher matrix passed for ${rows.length} tracked rows: ${JSON.stringify(counts)}.`);
} finally {
  await client.end().catch(() => undefined);
}
