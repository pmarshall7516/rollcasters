import { enqueueBannerNotification, type BannerNotification } from "../src/app/notifications.js";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function challenge(id: string): BannerNotification {
  return { id, kind: "challenge-completed", challengeId: id };
}

function reward(id: string): BannerNotification {
  return {
    id,
    kind: "shop-reward",
    targetCategory: "critter",
    targetId: "critter-id",
    shard: false,
    granted: "1",
    discarded: "0",
  };
}

const first = challenge("first");
const second = challenge("second");
const duplicate = enqueueBannerNotification([first], challenge("first"));
check(duplicate.length === 1 && duplicate[0] === first, "duplicate notifications should be ignored");

const appended = enqueueBannerNotification([first], second);
check(appended.map(({ id }) => id).join(",") === "first,second", "ordinary notifications should append FIFO");

const inserted = enqueueBannerNotification([first, reward("old-1"), reward("old-2"), second], reward("new"));
check(inserted.map(({ id }) => id).join(",") === "first,new,second", "shop rewards should replace older shop rewards at their first queue position");

const appendedReward = enqueueBannerNotification([first, second], reward("new"));
check(appendedReward.map(({ id }) => id).join(",") === "first,second,new", "shop rewards should append when no shop reward is queued");

console.log("Notification queue tests passed.");
