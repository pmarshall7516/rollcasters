import { challengeDescription, challengeGoal } from "../src/lib/collectibles.js";
import type { AppData, CollectibleUnlockChallenge } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const data = {
  catalog: {
    elements: [
      { id: "basic", name: "Basic" },
      { id: "vile", name: "Vile" },
      { id: "frost", name: "Frost" },
    ],
    critters: [
      { id: "001", name: "Ramber" },
      { id: "002", name: "Cragram" },
    ],
    rollcasters: [],
    relics: [
      { id: "004", name: "Polished Ivory" },
    ],
    skills: [{ id: "vile-injection", name: "Vile Injection" }],
    dungeons: [
      { id: "001", name: "Journey Begins" },
      { id: "002", name: "Creek Clash" },
    ],
    currencies: [{ id: "coins", name: "Coins" }],
  },
} as unknown as AppData;

function challenge(type: CollectibleUnlockChallenge["challenge_type"], parameters: Record<string, unknown>, display_text?: string): CollectibleUnlockChallenge {
  return {
    id: crypto.randomUUID(),
    collectible_type: "critter",
    collectible_id: "002",
    challenge_type: type,
    target_category: null,
    target_id: null,
    target_mode: null,
    any_target: false,
    target_ids: [],
    required_amount: null,
    required_level: null,
    sort_order: 0,
    parameters,
    display_text,
  };
}

const diversity = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 1,
  required_element_ids: ["basic", "vile", "frost"],
  required_distinct_types: 2,
});
check(challengeDescription(data, diversity) === "Own 1 Critter from each of: Basic, Vile, Frost.", "Specific diversity text must name every required Element.");
check(challengeGoal(diversity) === 3n, "Specific diversity goal must equal the number of required Elements.");

const override = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 1,
  required_element_ids: ["basic", "vile", "frost"],
}, "Own 1 Critter from each of: Basic, Vile, Frost.");
check(challengeDescription(data, override) === override.display_text, "Authored player-facing text must be used verbatim.");
check(challengeDescription(data, { ...diversity, display_text: "  " }) === "Own 1 Critter from each of: Basic, Vile, Frost.", "Blank overrides must fall back to the generated default.");

const cases: Array<[CollectibleUnlockChallenge, string]> = [
  [challenge("own_collectible", { collectible_category: "critter", collectible_ids: ["001"], required_amount: 1, require_unique_collectibles: true }), "Own Ramber."],
  [challenge("level_up_critter", { critter_id: "001", required_level: 20 }), "Unlock level 20 for Ramber (001)"],
  [challenge("knock_out_critters", { target_mode: "species", target_ids: ["001"], required_amount: 10 }), "Knock out Critters (Ramber)"],
  [challenge("deal_damage", { target_mode: "element", target_ids: ["vile"], required_amount: 1250 }), "Damage Critters (Vile)"],
  [challenge("take_damage", { target_mode: "species", any_target: true, target_ids: [], required_amount: 3000 }), "Receive Damage (Any Species)"],
  [challenge("use_skill", { target_mode: "skill", target_ids: ["vile-injection"], required_amount: 10 }), "Use Skill (Vile Injection)"],
  [challenge("squad_composition", { completion_event: "battle_win", required_completions: 2, required_critter_ids: ["001"], required_element_ids: ["vile"], require_survival: true }), "Win 2 battles with the configured squad."],
  [challenge("dungeon_clear", { dungeon_selection: "specific_dungeon", dungeon_ids: ["002"], required_clears: 1, has_relic_requirements: true, required_relic_ids: ["004"], require_relic_activation: true }), "Clear Creek Clash 1 time."],
  [challenge("resource_spending", { spending_context: "combat", resource_type: "currency", required_amount: 5, tracking_scope: "lifetime" }), "Spend 5 Currency in total."],
  [challenge("swap_action", { tracked_action: "unique_critters_swapped_in", required_amount: 2 }), "Unique Critters Swapped In 2 times."],
  [challenge("block_action", { tracked_action: "attacks_fully_blocked", required_amount: 2 }), "Attacks Fully Blocked: 2."],
  [challenge("dice_roll", { tracked_result: "maximum_die_result", comparison: "greater_than_or_equal", target_value: 6, required_occurrences: 2, die_types: ["d6"] }), "Maximum Die Result Greater Than Or Equal 6, 2 times."],
  [challenge("shop_shards", { required_amount: 20 }), "Unlock Cragram shards"],
  [challenge("shop_relic", { required_amount: 1 }), "Own Cragram"],
];

for (const [row, expected] of cases) check(challengeDescription(data, row) === expected, `${row.challenge_type} text differs from the dev default: ${challengeDescription(data, row)}`);

console.log(`Challenge text audit passed for ${cases.length + 2} representative definitions.`);
