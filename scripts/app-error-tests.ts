import { dungeonEntryErrorMessage, errorMessage, loadoutErrorMessage, rawErrorMessage } from "../src/app/errors.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(rawErrorMessage(new Error("failed"), "fallback") === "failed", "Error messages should prefer Error.message");
check(rawErrorMessage({ message: "remote failure" }, "fallback") === "remote failure", "message-bearing error objects should remain readable");
check(errorMessage(new Error("canceling statement due to statement timeout"), "fallback") === "The save service is busy right now. Please try again.", "statement timeout should retain the existing user-facing message");
check(dungeonEntryErrorMessage(new Error("DUNGEON_ENTRY_TIMEOUT")) === "Dungeon entry is taking longer than expected. No combat was started; please try again.", "dungeon timeout should retain its safe recovery message");
check(loadoutErrorMessage(new Error("PLAYER_REVISION_CONFLICT: stale"), "fallback") === "Your loadout changed elsewhere. Reloading the latest state…", "published loadout error codes should retain their mapped messages");

console.log("App error tests passed.");
