import { resolveDesktopUpdateGate, type DesktopUpdate } from "../src/lib/desktop-updater.js";
import type { DesktopServerUpdateStatus } from "../src/lib/desktop-updater.js";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const status = (overrides: Partial<DesktopServerUpdateStatus> & { scheduled?: unknown } = {}): DesktopServerUpdateStatus & { scheduled?: unknown } => ({
  maintenance: false, maintenanceReason: null, active: null, ...overrides,
});
const update: DesktopUpdate = { version: "1.1.0", installAndRestart: async () => undefined };

check(resolveDesktopUpdateGate(status({ scheduled: { id: "stable:1.1.0", version: "1.1.0", catalogReleaseId: "catalog", clientProtocolVersion: 1, activatesAt: "2030-01-01T00:00:00Z" } }), "1.0.0", update).kind === "ready", "Scheduled updates must not block before activation.");
check(resolveDesktopUpdateGate(status({ active: { version: "1.0.0" } }), "1.0.0", null).kind === "ready", "Current active version must enter the game.");
check(resolveDesktopUpdateGate(status({ active: { version: "1.1.0" } }), "1.0.0", update).kind === "required", "Active newer version must require its signed update.");
check(resolveDesktopUpdateGate(status({ active: { version: "1.1.0" } }), "1.0.0", null).kind === "error", "Missing active feed artifact must fail closed.");
check(resolveDesktopUpdateGate(status({ maintenance: true, maintenanceReason: "Emergency repair" }), "1.0.0", null).kind === "maintenance", "Maintenance must block entry.");
console.log("Server-gated desktop update tests passed.");
