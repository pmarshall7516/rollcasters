import {
  promoCodeErrorMessage,
  promoRewardOutcomeLabel,
  promoRewardTypeLabel,
} from "../src/lib/promo-codes.js";
import type { PromoCodeReward } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function reward(overrides: Partial<PromoCodeReward> = {}): PromoCodeReward {
  return {
    type: "currency",
    targetCategory: null,
    targetId: "coins",
    name: "Coins",
    assetPath: "ui/coins.png",
    quantity: "250",
    configuredQuantity: "250",
    discardedQuantity: "0",
    didUnlock: false,
    ...overrides,
  };
}

check(
  promoCodeErrorMessage(new Error("RPC context: AUTH_REQUIRED")) === "Sign in to claim a promo code.",
  "AUTH_REQUIRED must map to the sign-in copy.",
);
check(
  promoCodeErrorMessage({ message: "PROMO_CODE_INVALID_OR_INACTIVE" }) === "That promo code is invalid or no longer active.",
  "Missing, archived, and inactive codes must share non-enumerable error copy.",
);
check(
  promoCodeErrorMessage(new Error("PROMO_CODE_PLAYER_LIMIT_REACHED"))
    === "You’ve reached this promo code’s claim limit for your account.",
  "Finite per-player exhaustion must map to the account-limit copy.",
);
check(
  promoCodeErrorMessage(new Error("PROMO_CODE_ALREADY_REDEEMED")) === "You already claimed this promo code.",
  "The legacy one-use token must remain backward compatible.",
);
check(
  promoCodeErrorMessage(new Error("PROMO_CODE_LIMIT_REACHED")) === "This promo code has reached its redemption limit.",
  "Exhausted finite codes must map to the limit copy.",
);
check(
  promoCodeErrorMessage(new Error("Failed to fetch")).includes("Check your connection"),
  "Unknown and network errors must use the safe retry copy.",
);

check(promoRewardTypeLabel("currency") === "Currency", "Currency rewards need their type label.");
check(promoRewardOutcomeLabel(reward()) === "Currency", "A Currency grant must display its type.");
check(
  promoRewardOutcomeLabel(reward({
    type: "critter",
    targetCategory: "critter",
    quantity: "0",
    configuredQuantity: "1",
    discardedQuantity: "1",
  })) === "Already owned",
  "A duplicate Critter grant must display Already owned.",
);
check(
  promoRewardOutcomeLabel(reward({
    type: "rollcaster",
    targetCategory: "rollcaster",
    quantity: "0",
    configuredQuantity: "1",
    discardedQuantity: "1",
  })) === "Already owned",
  "A duplicate Rollcaster grant must display Already owned.",
);
check(
  promoRewardOutcomeLabel(reward({
    type: "relic",
    targetCategory: "relic",
    quantity: "0",
    configuredQuantity: "1",
    discardedQuantity: "1",
  })) === "At maximum",
  "A capped Relic grant must display At maximum.",
);
check(
  promoRewardOutcomeLabel(reward({
    type: "relic",
    targetCategory: "relic",
    quantity: "0",
    configuredQuantity: "1",
    discardedQuantity: "1",
    didUnlock: true,
  })) === "Unlocked",
  "A newly discovered Relic at maximum must prioritize Unlocked.",
);
check(
  promoRewardOutcomeLabel(reward({
    type: "shard",
    targetCategory: "critter",
    quantity: "3",
    configuredQuantity: "9007199254740995",
    discardedQuantity: "9007199254740992",
  })) === "Goal reached · 9,007,199,254,740,992 excess not added",
  "Shard overflow copy must preserve exact bigint quantities.",
);
check(
  promoRewardOutcomeLabel(reward({
    type: "relic",
    targetCategory: "relic",
    quantity: "1",
    configuredQuantity: "2",
    discardedQuantity: "1",
  })) === "1 above Maximum owned not added",
  "Partially capped Relics must explain the discarded quantity.",
);

console.log("Promo Code business-rule tests passed.");
