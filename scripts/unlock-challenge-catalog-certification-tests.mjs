import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogDbClient, parseEnv } from "../../rollcaster-dev/scripts/db-utils.mjs";
import { buildGameCatalog, validateSnapshot } from "../../rollcaster-dev/scripts/catalog-release-core.mjs";
import {
  applyChallengeEventIncrement,
  challengeEventIncrement,
  derivedChallengeProgress,
} from "../src/lib/challenges.ts";

const RELEASE_ID = "2026.09.10.1";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}

function firstOr(value, fallback) {
  return strings(value)[0] ?? fallback;
}

function chooseDungeonId(parameters, catalog) {
  const specific = strings(parameters.dungeon_ids);
  if (specific.length) return specific[0];
  const minimum = firstOr(parameters.minimum_dungeon_ids, undefined);
  const maximum = firstOr(parameters.maximum_dungeon_ids, undefined);
  if (minimum || maximum) {
    const minimumIndex = Math.max(0, catalog.dungeons.findIndex((dungeon) => dungeon.id === minimum));
    const maximumIndex = Math.max(minimumIndex, catalog.dungeons.findIndex((dungeon) => dungeon.id === maximum));
    return catalog.dungeons[Math.floor((minimumIndex + maximumIndex) / 2)]?.id;
  }
  return catalog.dungeons[0]?.id;
}

async function readRelease() {
  const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../rollcaster-dev");
  const db = createCatalogDbClient({ ...parseEnv(path.join(devRoot, ".env")), ...process.env });
  await db.connect();
  try {
    const release = (await db.query("select id,status from public.content_releases where id=$1", [RELEASE_ID])).rows[0];
    check(release, `Catalog Release ${RELEASE_ID} does not exist in the local Content Studio database.`);
    check(release.status === "published", `Catalog Release ${RELEASE_ID} must be published before certification; found ${release.status}.`);
    const snapshot = (await db.query("select snapshot from public.content_release_snapshots where release_id=$1", [RELEASE_ID])).rows[0]?.snapshot;
    check(snapshot, `Catalog Release ${RELEASE_ID} has no immutable snapshot.`);
    return snapshot;
  } finally {
    await db.end();
  }
}

function makeProgressData(catalog) {
  const critters = catalog.critters.map((critter, index) => ({
    id: `challenge-critter-${index + 1}`,
    user_id: "challenge-certification",
    critter_id: critter.id,
    level: 99,
    xp: 0,
    skill_points: 0,
  }));
  const rollcasters = catalog.rollcasters.map((rollcaster, index) => ({
    id: `challenge-rollcaster-${index + 1}`,
    user_id: "challenge-certification",
    rollcaster_id: rollcaster.id,
    level: 99,
    xp: 0,
    ability_points: 0,
  }));
  const relicInventory = catalog.relics.map((relic) => ({
    user_id: "challenge-certification",
    relic_id: relic.id,
    quantity: 999,
    discovered_at: "challenge-certification",
  }));
  return {
    catalog,
    player: {
      profile: {
        user_id: "challenge-certification",
        username: "challenge-certification",
        coins: 0,
        starter_rollcaster_selected_at: "challenge-certification",
        starter_selected_at: "challenge-certification",
        active_rollcaster_id: rollcasters[0]?.id,
      },
      rollcasters,
      critters,
      relicInventory,
      squadSlots: critters.slice(0, 3).map((critter, index) => ({ user_id: "challenge-certification", slot_index: index + 1, user_critter_id: critter.id })),
      skillSlots: [],
      abilitySlots: [],
      relicSlots: [],
      unlockedSkillIdsByCritter: {},
      unlockedAbilityIdsByRollcaster: {},
      dungeonProgress: [],
      collectibleSnapshot: {
        currencies: [],
        shards: catalog.collectibleUnlockChallenges
          .filter((challenge) => challenge.challenge_type === "shop_shards")
          .map((challenge) => ({ collectible_type: challenge.collectible_type, collectible_id: challenge.collectible_id, quantity: "999" })),
        lootboxes: [],
        progress: [],
        tracked: [],
        unlock_events: [],
        unlocked_collectibles: [
          ...catalog.critters.map((row) => ({ collectible_type: "critter", collectible_id: row.id })),
          ...catalog.rollcasters.map((row) => ({ collectible_type: "rollcaster", collectible_id: row.id })),
          ...catalog.relics.map((row) => ({ collectible_type: "relic", collectible_id: row.id })),
        ],
      },
    },
  };
}

function eventFor(challenge, catalog) {
  const p = challenge.parameters ?? {};
  const sourceCritterId = firstOr(p.source_critter_ids, firstOr(p.critter_ids, catalog.critters[0]?.id));
  const targetCritterId = firstOr(p.target_critter_ids, catalog.critters[1]?.id ?? catalog.critters[0]?.id);
  const sourceElement = firstOr(p.source_element_ids, catalog.elements[0]?.id);
  const targetElement = firstOr(p.target_element_ids, catalog.elements[1]?.id ?? catalog.elements[0]?.id);
  const requiredSkillElement = firstOr(p.element_ids, undefined);
  const requiredSkillTags = strings(p.skill_tag_ids);
  const skillId = firstOr(
    p.skill_ids,
    catalog.skills.find((row) => (!requiredSkillElement || row.element_id === requiredSkillElement)
      && (!p.skill_type || p.skill_type === "any" || row.skill_type === p.skill_type)
      && (requiredSkillTags.length === 0 || requiredSkillTags.some((tag) => row.tag_ids.includes(tag))))?.id ?? catalog.skills[0]?.id,
  );
  const skill = catalog.skills.find((row) => row.id === skillId) ?? catalog.skills[0];
  const skillType = p.skill_type && p.skill_type !== "any" ? p.skill_type : skill?.skill_type ?? "attack";
  const sourceTags = strings(p.source_critter_tag_ids);
  const targetTags = strings(p.target_critter_tag_ids);
  const skillTags = strings(p.skill_tag_ids);
  const sourceElements = strings(p.source_element_ids).length ? strings(p.source_element_ids) : [sourceElement];
  const targetElements = strings(p.target_element_ids).length ? strings(p.target_element_ids) : [targetElement];
  const targetSide = p.target_side === "friendlies" ? "player" : "opponent";
  const targetContexts = [{
    critter_id: targetCritterId,
    side: targetSide,
    element_ids: targetElements,
    critter_tag_ids: targetTags,
  }];
  const amount = Math.max(1, Number(p.required_amount ?? p.required_completions ?? p.required_occurrences ?? 1));
  const base = {
    eventId: `challenge-cert:${challenge.id}`,
    catalogVersion: RELEASE_ID,
    battleId: "challenge-cert-battle",
    dungeonRunId: "challenge-cert-dungeon-run",
    dungeonId: chooseDungeonId(p, catalog),
    turn: 1,
    sourceCritterId,
    targetCritterId,
    sourceElementIds: sourceElements,
    targetElementIds: targetElements,
    sourceCritterTagIds: sourceTags,
    targetCritterTagIds: targetTags,
    skillTagIds: skillTags,
    skillType,
    skillId,
    amount: ["knock_out_critters", "use_skill", "skill_arsenal", "squad_composition", "dungeon_clear", "swap_action", "block_action", "dice_roll", "afflict_status", "stun_activation", "shields_shattered", "status_removal", "closing_move", "defeat_rollcaster_type"].includes(challenge.challenge_type) ? 1 : amount,
    payload: {
      source_element_ids: sourceElements,
      target_element_ids: targetElements,
      source_critter_tag_ids: sourceTags,
      target_critter_tag_ids: targetTags,
      skill_tag_ids: skillTags,
      target_critter_ids: [targetCritterId],
      target_contexts: targetContexts,
      skill_element_id: skill?.element_id ?? requiredSkillElement ?? sourceElement,
      skill_type: skillType,
    },
  };
  switch (challenge.challenge_type) {
    case "knock_out_critters": return { ...base, type: "critter_knocked_out" };
    case "deal_damage": return { ...base, type: "hp_damage_dealt", payload: { ...base.payload, hp_damage: p.damage_mode === "shield_only" ? 0 : amount, shield_damage: p.damage_mode === "shield_only" ? amount : 0 } };
    case "take_damage": return { ...base, type: "hp_damage_taken", payload: { ...base.payload, hp_damage: p.damage_mode === "shield_only" ? 0 : amount, shield_damage: p.damage_mode === "shield_only" ? amount : 0 } };
    case "use_skill": return { ...base, type: "skill_resolved" };
    case "skill_arsenal": return { ...base, type: "skill_resolved" };
    case "squad_composition": return {
      ...base,
      type: p.completion_event === "dungeon_clear" ? "dungeon_completed" : "battle_completed",
      payload: {
        ...base.payload,
        won: true,
        survivors_complete: true,
        squad: catalog.critters.map((critter) => ({ critter_id: critter.id, element_ids: [critter.element_1_id, critter.element_2_id].filter(Boolean) })),
      },
    };
    case "dungeon_clear": return {
      ...base,
      type: "dungeon_completed",
      payload: { ...base.payload, won: true, dungeon_order: catalog.dungeons.findIndex((dungeon) => dungeon.id === base.dungeonId) + 1, required_relics_activated: true },
    };
    case "resource_spending": return {
      ...base,
      type: "resource_spent",
      abilityId: firstOr(p.ability_ids, undefined),
      rollcasterId: firstOr(p.rollcaster_ids, undefined),
      shopId: firstOr(p.shop_ids, undefined),
      purchasedCollectibleCategory: firstOr(p.purchased_collectible_categories, undefined),
      payload: { ...base.payload, spending_context: p.spending_context, resource_type: p.resource_type, custom_currency_id: p.custom_currency_id, dungeon_id: base.dungeonId, ability_id: firstOr(p.ability_ids, undefined), rollcaster_id: firstOr(p.rollcaster_ids, undefined), critter_id: sourceCritterId },
    };
    case "swap_action": return { ...base, type: "swap_completed", payload: { ...base.payload, incoming_critter_id: targetCritterId, incoming_element_ids: targetElements, unique: true, damage_avoided: amount, knockout_after_swap: true, turns_since_swap: 0 } };
    case "block_action": return { ...base, type: "block_completed", payload: { ...base.payload, damage_prevented: amount, fully_blocked: true, survived: true, blocks_performed: true } };
    case "dice_roll": return { ...base, type: "dice_resolved", abilityId: firstOr(p.ability_ids, undefined), rollcasterId: firstOr(p.rollcaster_ids, undefined), payload: { ...base.payload, die_type: firstOr(p.die_types, "d20"), ability_ids: strings(p.ability_ids), rollcaster_id: firstOr(p.rollcaster_ids, undefined), natural_value: Number(p.target_value ?? 7), modified_value: Number(p.target_value ?? 7), natural_maximum: Number(p.target_value ?? 7), turn_mana_total: Number(p.target_value ?? 7), turn_mana_total_event: true, matching_count: Number(p.target_value ?? 1) } };
    case "heal_hp": return { ...base, type: "hp_healed", payload: { ...base.payload, source_side: "player", recipient_side: p.recipient_side ?? "friendly" } };
    case "afflict_status": return { ...base, type: p.affliction_mode === "afflicted_turns" ? "status_turn_completed" : "status_afflicted", payload: { ...base.payload, status_ids: strings(p.status_ids).length ? strings(p.status_ids) : [catalog.statuses[0]?.id], target_side: targetSide, fresh: true } };
    case "stun_activation": return { ...base, type: "stun_activated", payload: { ...base.payload, target_side: p.target_side === "friendlies" ? "player" : "opponent" } };
    case "shields_shattered": return { ...base, type: "shield_shattered", payload: { ...base.payload, shield_shattered: true, target_side: p.shield_side === "friendlies" ? "player" : "opponent" } };
    case "effectiveness_strike": {
      const effectivenessClass = firstOr(p.effectiveness_classes, "effective");
      const hit = { target_critter_id: targetCritterId, target_element_ids: targetElements, target_critter_tag_ids: targetTags, hp_damage: amount, shield_damage: 0, total_damage: amount, effectiveness_class: effectivenessClass, knocked_out: p.must_knock_out === true };
      const type = p.tracking_metric === "skills_hit" ? "effectiveness_skill_resolved" : "effectiveness_strike";
      return { ...base, type, payload: type === "effectiveness_skill_resolved" ? { ...base.payload, effectiveness_hits: [hit] } : { ...base.payload, ...hit } };
    }
    case "status_removal": return { ...base, type: "effect_removed", payload: { ...base.payload, removal_kind: p.removal_kind === "negative_stat_modifiers" ? "negative_stat_modifier" : "status", status_id: firstOr(p.status_ids, catalog.statuses[0]?.id), status_classification: p.status_classification === "any" ? "negative" : p.status_classification, removal_reason: p.removal_reason === "any" ? "skill" : p.removal_reason, target_side: targetSide, source_owner_type: "skill", source_owner_id: skillId, modifier_polarity: "negative" } };
    case "closing_move": return { ...base, type: "final_knockout_attribution", payload: { ...base.payload, battle_won: true, finisher_type: p.finisher_type === "any" ? "skill" : p.finisher_type, is_end_of_encounter: true, is_end_of_dungeon: true, status_id: firstOr(p.status_ids, undefined) } };
    case "defeat_rollcaster_type": return { ...base, type: "battle_completed", payload: { ...base.payload, won: true, enemy_rollcaster_type: firstOr(p.rollcaster_types, "adept") } };
    default: return null;
  }
}

const snapshot = await readRelease();
const releaseValidation = validateSnapshot(snapshot);
check(releaseValidation.errors.length === 0, `Catalog Release ${RELEASE_ID} has validation errors: ${releaseValidation.errors.join(" | ")}`);
const catalog = buildGameCatalog(snapshot, { entries: [] }, new Date().toISOString());
const progressData = makeProgressData(catalog);
const emptyData = { catalog, player: null };
const dungeonOrders = new Map(catalog.dungeons.map((dungeon, index) => [dungeon.id, index + 1]));
const failures = [];
const counts = {};

for (const challenge of catalog.collectibleUnlockChallenges) {
  try {
    const derived = ["own_collectible", "level_up_critter", "level_up_rollcaster", "collection_diversity", "shop_shards", "shop_relic"].includes(challenge.challenge_type);
    if (derived) {
      check(derivedChallengeProgress(emptyData, challenge) === 0n, `Challenge ${challenge.id} must start at zero without player state.`);
      check(derivedChallengeProgress(progressData, challenge) > 0n, `Challenge ${challenge.id} did not derive positive progress from a qualifying player state.`);
    } else {
      const event = eventFor(challenge, catalog);
      check(event, `Challenge ${challenge.id} has no certification event builder.`);
      const increment = challengeEventIncrement(challenge, event, dungeonOrders);
      check(increment > 0, `Challenge ${challenge.id} did not increment from its qualifying event.`);
      const goal = Math.max(1, Number(challenge.required_amount ?? challenge.parameters?.required_completions ?? challenge.parameters?.required_occurrences ?? 1));
      const persisted = applyChallengeEventIncrement(0, goal, challenge, event, dungeonOrders);
      check(persisted > 0n, `Challenge ${challenge.id} did not persist positive progress from its qualifying event. Event=${JSON.stringify(event)} goal=${goal} increment=${increment} persisted=${persisted}`);
      const wrongType = { ...event, type: event.type === "battle_completed" ? "dungeon_completed" : "battle_completed" };
      check(challengeEventIncrement(challenge, wrongType, dungeonOrders) === 0, `Challenge ${challenge.id} incremented for an unrelated event type.`);
    }
    counts[challenge.challenge_type] = (counts[challenge.challenge_type] ?? 0) + 1;
  } catch (error) {
    failures.push(`${challenge.id} (${challenge.challenge_type}, ${challenge.collectible_type}:${challenge.collectible_id}): ${String(error)}`);
  }
}

check(failures.length === 0, `Catalog Release ${RELEASE_ID} Unlock Challenge certification failed (${failures.length}):\n${failures.join("\n")}`);
console.log(`Catalog ${RELEASE_ID} Unlock Challenges certified: ${catalog.collectibleUnlockChallenges.length} rows across ${Object.entries(counts).map(([type, count]) => `${type}=${count}`).join(", ")}.`);
