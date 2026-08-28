import type {
  CollectibleType,
  CollectibleUnlockEvent,
  PromoCodeRedemption,
} from "../lib/types.js";

export type BannerNotification =
  | {
      id: string;
      kind: "collectible-unlock";
      event: CollectibleUnlockEvent;
    }
  | {
      id: string;
      kind: "challenge-completed";
      challengeId: string;
    }
  | {
      id: string;
      kind: "shop-reward";
      targetCategory: CollectibleType;
      targetId: string;
      shard: boolean;
      granted: string;
      discarded: string;
    }
  | {
      id: string;
      kind: "promo-reward";
      redemption: PromoCodeRedemption;
    }
  | {
      id: string;
      kind: "shop-error";
      message: string;
    }
  | {
      id: string;
      kind: "lootbox-error";
      message: string;
    };

export function enqueueBannerNotification(
  current: BannerNotification[],
  notification: BannerNotification,
): BannerNotification[] {
  if (current.some((queued) => queued.id === notification.id)) return current;
  if (notification.kind !== "shop-reward") return [...current, notification];

  const firstShopRewardIndex = current.findIndex((queued) => queued.kind === "shop-reward");
  if (firstShopRewardIndex === -1) return [...current, notification];

  const withoutOlderShopRewards = current.filter((queued) => queued.kind !== "shop-reward");
  const insertionIndex = Math.min(firstShopRewardIndex, withoutOlderShopRewards.length);
  return [
    ...withoutOlderShopRewards.slice(0, insertionIndex),
    notification,
    ...withoutOlderShopRewards.slice(insertionIndex),
  ];
}
