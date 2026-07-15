import {
  challengeGateBadge,
  challengeGateBlockMessage,
  challengeDescription,
  formatAmount,
  orderedCurrencies,
  safeBigInt,
  shopAvailability,
  shopErrorMessage,
} from "../src/lib/collectibles.js";
import type { AppData, CollectibleUnlockChallenge, ShopEntry } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shardChallenge: CollectibleUnlockChallenge = {
  id: "shard-challenge",
  collectible_type: "critter",
  collectible_id: "002",
  challenge_type: "shop_shards",
  required_amount: "10",
  required_level: null,
  target_category: null,
  target_id: null,
  target_mode: null,
  target_ids: [],
  any_target: false,
  sort_order: 1,
  gate_order: null,
};

const relicChallenge: CollectibleUnlockChallenge = {
  ...shardChallenge,
  id: "relic-challenge",
  collectible_type: "relic",
  collectible_id: "relic-001",
  challenge_type: "shop_relic",
  required_amount: "1",
};

const shardEntry: ShopEntry = {
  id: "shard-entry",
  shop_type: "shard",
  name: "Cragram Shards",
  description: "Two shards toward Cragram.",
  target_category: "critter",
  target_id: "002",
  currency_id: "coins",
  price: "9007199254740993",
  quantity: 2,
  is_active: true,
  is_archived: false,
  sort_order: 1,
};

const relicEntry: ShopEntry = {
  ...shardEntry,
  id: "relic-entry",
  shop_type: "relic",
  target_category: "relic",
  target_id: "relic-001",
  price: "25",
  quantity: 1,
};

function data(options: { balance?: string; shards?: string; ownsCritter?: boolean; relicQuantity?: number } = {}): AppData {
  return {
    catalog: {
      currencies: [
        { id: "prismite", name: "Prismite", description: "Prismatic currency.", asset_path: null, text_color: "#7DE8FF", is_default: false, is_system: false, is_active: true, is_archived: false, sort_order: 2 },
        { id: "coins", name: "Coins", description: "Standard currency.", asset_path: null, text_color: "#FFD65A", is_default: true, is_system: true, is_active: true, is_archived: false, sort_order: 99 },
        { id: "archived", name: "Archived", description: "Hidden currency.", asset_path: null, text_color: null, is_default: false, is_system: false, is_active: false, is_archived: true, sort_order: 0 },
      ],
      collectibleUnlockRequirements: [],
      collectibleUnlockChallenges: [shardChallenge, relicChallenge],
      shopEntries: [shardEntry, relicEntry],
      critters: [{ id: "002", name: "Cragram", is_active: true, is_archived: false }],
      rollcasters: [],
      relics: [{ id: "relic-001", name: "Moon Lens", max_owned: 2, is_active: true, is_archived: false }],
      elements: [],
      skills: [],
    } as AppData["catalog"],
    player: {
      profile: { user_id: "user", username: "Tester", coins: 0, starter_selected_at: "now", active_rollcaster_id: null },
      rollcasters: [],
      critters: options.ownsCritter ? [{ id: "owned", user_id: "user", critter_id: "002", level: 1, xp: 0, skill_points: 0 }] : [],
      relicInventory: options.relicQuantity === undefined ? [] : [{ user_id: "user", relic_id: "relic-001", quantity: options.relicQuantity, discovered_at: "now" }],
      squadSlots: [],
      skillSlots: [],
      abilitySlots: [],
      relicSlots: [],
      unlockedSkillIdsByCritter: {},
      unlockedAbilityIdsByRollcaster: {},
      dungeonProgress: [],
      collectibleSnapshot: {
        currencies: [{ currency_id: "coins", balance: options.balance ?? "9007199254740993" }],
        shards: [{ collectible_type: "critter", collectible_id: "002", quantity: options.shards ?? "4" }],
        progress: [],
        tracked: [],
        unlock_events: [],
      },
    },
  };
}

check(safeBigInt("900719925474099312345") === 900719925474099312345n, "Currency parsing must preserve values above Number.MAX_SAFE_INTEGER.");
check(formatAmount("9007199254740993") === "9,007,199,254,740,993", "Currency display must preserve exact bigint digits.");
check(
  orderedCurrencies(data()).map((currency) => currency.id).join(",") === "coins,prismite",
  "The header currency order must keep default Coins first, include zero-balance active currencies, and omit archived currencies.",
);

const shardReady = shopAvailability(data(), shardEntry);
check(shardReady.enabled && shardReady.current === 4n && shardReady.goal === 10n, "A funded shard offer must be purchasable and expose current/goal progress.");
check(shopAvailability(data({ balance: "1" }), shardEntry).code === "INSUFFICIENT_FUNDS", "Insufficient currency must disable the offer.");
check(shopAvailability(data({ ownsCritter: true }), shardEntry).code === "COLLECTIBLE_ALREADY_UNLOCKED", "Owned collectibles must disable shard purchases.");
check(shopAvailability(data({ shards: "10" }), shardEntry).code === "SHOP_SHARDS_CHALLENGE_COMPLETE", "Completed shard goals must disable further shard purchases.");
check(shopAvailability(data({ balance: "100", relicQuantity: 1 }), relicEntry).enabled, "A Relic below its ownership cap must be purchasable.");
check(shopAvailability(data({ balance: "100", relicQuantity: 2 }), relicEntry).code === "RELIC_MAX_OWNED_REACHED", "Relic purchases must respect max_owned.");
check(challengeDescription(data(), shardChallenge) === "Unlock Cragram shards", "Shard challenge copy must use the collectible name.");
const laterGate = { ...shardChallenge, gate_order: 2 };
check(challengeGateBadge(laterGate) === "Gate 2", "Gated rows must expose their authored Gate number.");
check(
  challengeGateBlockMessage(laterGate, {
    challenge_id: laterGate.id,
    current: "10",
    goal: "10",
    goal_reached: true,
    eligible: false,
    completed: false,
    blocked_by_gate_order: 1,
    trackable: false,
  }) === "Waiting for Gate 1",
  "A full-progress later gate must still explain which earlier gate blocks completion.",
);
check(
  challengeGateBlockMessage(shardChallenge, {
    challenge_id: shardChallenge.id,
    current: "10",
    goal: "10",
    goal_reached: true,
    eligible: false,
    completed: false,
    blocked_by_gate_order: 1,
    trackable: false,
  }) === "Complete all gates first",
  "A blocked ungated row must explain that the full gate sequence is required.",
);
check(shopErrorMessage(new Error("RPC failed: INSUFFICIENT_FUNDS")) === "You do not have enough currency for this purchase.", "RPC error codes must map to safe player-facing messages.");

console.log("Collectible and shop business-rule tests passed.");
