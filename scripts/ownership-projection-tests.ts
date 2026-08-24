import { progressFor } from "../src/lib/collectibles.js";
import type { AppData } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const challenge = (id: string, parameters: Record<string, unknown>) => ({
  id,
  collectible_type: "relic" as const,
  collectible_id: "owner",
  challenge_type: "own_collectible" as const,
  target_category: "relic" as const,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: String(parameters.required_amount ?? 1),
  required_level: null,
  sort_order: 0,
  parameters,
});

const data = {
  catalog: {
    collectibleUnlockRequirements: [
      { collectible_type: "relic", collectible_id: "owner", required_challenges: 3 },
    ],
    collectibleUnlockChallenges: [
      challenge("shield-projector", {
        collectible_category: "relic",
        collectible_ids: ["001", "005"],
        specific_collectible_mode: "all",
        require_unique_collectibles: true,
        required_amount: 2,
      }),
      challenge("ashkit", {
        collectible_category: "rollcaster",
        required_amount: 3,
        require_unique_collectibles: true,
      }),
      challenge("mech-core", {
        collectible_category: "relic",
        required_amount: 7,
        require_unique_collectibles: true,
      }),
      challenge("quantity-probe", {
        collectible_category: "relic",
        required_amount: 5,
        require_unique_collectibles: false,
        specific_collectible_mode: "quantity",
      }),
    ],
    relics: ["001", "005", "007", "008", "009", "010", "011"].map((id) => ({ id })),
    rollcasters: ["001", "002", "003"].map((id) => ({ id })),
  },
  player: {
    profile: { user_id: "user" },
    relicInventory: ["001", "007", "008", "009", "010"].map((relic_id, index) => ({
      relic_id,
      quantity: index === 4 ? 0 : index === 1 ? 3 : 1,
      discovered_at: "2026-08-24T00:00:00.000Z",
    })),
    rollcasters: [{ rollcaster_id: "001" }],
    collectibleSnapshot: {
      currencies: [], shards: [], lootboxes: [], tracked: [], unlock_events: [],
      unlocked_collectibles: ["001", "007", "008", "009", "010"].map((collectible_id) => ({ collectible_type: "relic" as const, collectible_id })),
      progress: [],
    },
  },
} as unknown as AppData;

check(progressFor(data, "shield-projector").current === "1", "One selected permanently unlocked Relic must display 1/2.");
check(progressFor(data, "shield-projector").goal === "2", "Selected-all ownership must derive a distinct-ID goal of 2.");
check(progressFor(data, "mech-core").current === "5", "Five permanently unlocked Relic IDs must display 5/7.");
check(progressFor(data, "quantity-probe").current === "5", "An explicitly quantity-counted Relic challenge must sum copies and clamp display at its goal.");
check(progressFor(data, "ashkit").current === "1", "One starter Rollcaster must display 1/3.");

const threeRollcasters = {
  ...data,
  player: {
    ...data.player!,
    rollcasters: [{ rollcaster_id: "001" }, { rollcaster_id: "002" }, { rollcaster_id: "003" }],
  },
} as AppData;
check(progressFor(threeRollcasters, "ashkit").current === "3", "Three distinct Rollcasters must complete the 3-item ownership goal.");
check(progressFor(data, "mech-core").current === "5", "A discovered Relic at quantity zero must remain in unique ownership progress.");

console.log("Ownership projection tests passed.");
