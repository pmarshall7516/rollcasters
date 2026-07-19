import { safeBigInt } from "./collectibles.js";
import type { PromoCodeReward, PromoCodeRewardType } from "./types.js";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

export function promoCodeErrorMessage(error: unknown): string {
  const raw = errorText(error);
  const messages: Array<[string, string]> = [
    ["AUTH_REQUIRED", "Sign in to claim a promo code."],
    ["PROMO_CODE_INVALID_OR_INACTIVE", "That promo code is invalid or no longer active."],
    ["PROMO_CODE_PLAYER_LIMIT_REACHED", "You’ve reached this promo code’s claim limit for your account."],
    ["PROMO_CODE_ALREADY_REDEEMED", "You already claimed this promo code."],
    ["PROMO_CODE_LIMIT_REACHED", "This promo code has reached its redemption limit."],
  ];
  return messages.find(([token]) => raw.includes(token))?.[1]
    ?? "We couldn’t claim the code. Check your connection and try again.";
}

export function promoRewardTypeLabel(type: PromoCodeRewardType): string {
  switch (type) {
    case "currency": return "Currency";
    case "shard": return "Shards";
    case "critter": return "Critter";
    case "rollcaster": return "Rollcaster";
    case "relic": return "Relic";
  }
}

export function promoRewardOutcomeLabel(reward: PromoCodeReward): string {
  const granted = safeBigInt(reward.quantity);
  const discarded = safeBigInt(reward.discardedQuantity);
  if (reward.didUnlock) return "Unlocked";
  if ((reward.type === "critter" || reward.type === "rollcaster") && granted === 0n) {
    return "Already owned";
  }
  if (reward.type === "relic" && granted === 0n) return "At maximum";
  if (reward.type === "shard" && discarded > 0n) {
    return `Goal reached · ${discarded.toLocaleString()} excess not added`;
  }
  if (reward.type === "relic" && discarded > 0n) {
    return `${discarded.toLocaleString()} above Maximum owned not added`;
  }
  return promoRewardTypeLabel(reward.type);
}
