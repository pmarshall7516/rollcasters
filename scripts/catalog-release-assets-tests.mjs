import { applyReleaseAssetPaths, createPacks } from "./catalog-release-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const enemyRollcaster = {
  id: "enemy-001",
  dungeon_id: "001",
  sequence_index: 0,
  name: "Acolyte Rook",
  eclipse_order_type: "acolyte",
  asset_path: "eclipse-order/acolyte-001.png",
  selection_weight: 1,
  policy_key: "random_action_v1",
  policy_revision: 1,
  policy_artifact_id: null,
  ability_ids: [],
  dialogue_lines: [],
  currencyDrops: [],
  itemDrops: [],
};

const packs = createPacks({
  currencies: [],
  elements: [],
  elementEffectiveness: [],
  starterRollcasterOptions: [],
  starterOptions: [],
  gameAssets: [],
  skills: [],
  rollcasterAbilities: [],
  relics: [],
  statuses: [],
  effectsBySkill: {},
  effectsByAbility: {},
  effectsByRelic: {},
  effectsByStatus: {},
  unlockChallengetemplates: [],
  collectibleUnlockRequirements: [],
  collectibleUnlockChallenges: [],
  shopEntries: [],
  lootboxes: [],
  lootboxPoolEntries: [],
  critters: [],
  critterProgression: [],
  critterSkillUnlocks: [],
  rollcasters: [],
  rollcasterProgression: [],
  rollcasterAbilityUnlocks: [],
  dungeons: [],
  dungeonOpponents: [],
  dungeonEnemyRollcasters: [enemyRollcaster],
  dungeonRegularEncounters: [],
  dungeonBossEncounters: [],
  dungeonCompletionDrops: [],
  dungeonOpponentStatOverrides: [],
}, "2026.08.10.1");

check(packs.dungeons.dungeonEnemyRollcasters?.[0]?.asset_path === enemyRollcaster.asset_path,
  "Published dungeon packs must retain enemy Rollcaster records so their snapshot art can be resolved.");
check(packs.dungeons.dungeonRegularEncounters, "Published dungeon packs must retain regular encounter definitions.");
check(packs.dungeons.dungeonBossEncounters, "Published dungeon packs must retain boss encounter definitions.");

const rewritten = applyReleaseAssetPaths({
  currencies: [],
  elements: [],
  critters: [],
  rollcasters: [],
  relics: [],
  statuses: [],
  lootboxes: [],
  dungeons: [],
  dungeonEnemyRollcasters: [enemyRollcaster],
}, new Map([[enemyrollcaster-asset-path-eclipse-order/acolyte-001-default-abc123-webp]]));
check(rewritten.dungeonEnemyRollcasters[0].asset_path === "eclipse-order/acolyte-001.default.abc123.webp",
  "Published asset paths must rewrite dungeon enemy Rollcaster art to the hashed release object.");

console.log("Catalog release dungeon asset test passed.");
