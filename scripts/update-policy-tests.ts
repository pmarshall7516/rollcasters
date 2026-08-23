import { evaluateUpdatePolicy, operationAllowed } from "../src/lib/update-policy.js";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

const startup = evaluateUpdatePolicy({ availableVersion: "1.2.0", activation: "active", boundary: "startup" });
check(startup.kind === "required" && !operationAllowed(startup, "bootstrap"), "An update available at startup must block bootstrap.");
const dungeon = evaluateUpdatePolicy({ availableVersion: "1.2.0", activation: "active", boundary: "dungeon" });
check(dungeon.kind === "deferred" && operationAllowed(dungeon, "dungeon-boundary") && !operationAllowed(dungeon, "new-mutation"), "A Dungeon may finish only its pinned safe boundary.");
const lootbox = evaluateUpdatePolicy({ availableVersion: "1.2.0", activation: "active", boundary: "lootbox" });
check(lootbox.kind === "deferred" && operationAllowed(lootbox, "lootbox-receipt") && !operationAllowed(lootbox, "new-mutation"), "A Lootbox may retrieve only its committed receipt.");
const maintenance = evaluateUpdatePolicy({ availableVersion: "1.2.0", activation: "active", maintenance: true, boundary: "dungeon" });
check(maintenance.kind === "required" && !operationAllowed(maintenance, "dungeon-boundary"), "Emergency maintenance blocks even safe-boundary mutations.");
const scheduled = evaluateUpdatePolicy({ availableVersion: "1.2.0", activation: "scheduled", activatesAt: "2026-08-22T12:00:00Z", boundary: "idle" });
check(scheduled.kind === "notice" && operationAllowed(scheduled, "new-mutation"), "A scheduled update remains a notice before activation.");
console.log("Desktop update safe-boundary policy tests passed.");

