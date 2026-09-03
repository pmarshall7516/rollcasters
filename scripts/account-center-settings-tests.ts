import {
  MAX_REMEMBERED_ACCOUNTS,
  emptyAccountCenterSettings,
  readAccountCenterSettings,
  removeRememberedAccount,
  upsertRememberedAccount,
  type RememberedAccount,
} from "../src/lib/account-center.js";
import { updateLocalSettings } from "../src/lib/local-settings.js";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertRejects(run: () => unknown, pattern: RegExp) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`Unexpected error: ${message}`);
    return;
  }
  throw new Error(`Expected error matching ${pattern}.`);
}

const account = (userId: string, lastUsedAt: string): RememberedAccount => ({
  userId,
  email: `${userId}@example.com`,
  username: userId,
  addedAt: "2026-09-03T00:00:00.000Z",
  lastUsedAt,
  credentialVersion: 1,
});

assertEqual(readAccountCenterSettings(null), emptyAccountCenterSettings(), "Missing account settings must be empty.");
const duplicate = readAccountCenterSettings({
  version: 2,
  accountCenter: {
    version: 1,
    accounts: [account("a", "2026-09-01T00:00:00.000Z"), account("a", "2026-09-02T00:00:00.000Z")],
  },
});
assertEqual(duplicate.accounts.length, 1, "Duplicate user IDs must collapse.");
assertEqual(duplicate.accounts[0]?.lastUsedAt, "2026-09-02T00:00:00.000Z", "Duplicate resolution must keep the newest metadata.");

let settings = emptyAccountCenterSettings();
for (let index = 0; index < MAX_REMEMBERED_ACCOUNTS; index += 1) {
  settings = upsertRememberedAccount(settings, account(String(index), `2026-09-0${index + 1}T00:00:00.000Z`));
}
assertEqual(settings.accounts.length, 3, "Three accounts must be allowed.");
assertRejects(() => upsertRememberedAccount(settings, account("d", "2026-09-04T00:00:00.000Z")), /three|limit/i);
settings = upsertRememberedAccount(settings, account("1", "2026-09-05T00:00:00.000Z"));
assertEqual(settings.accounts.find(({ userId }) => userId === "1")?.lastUsedAt, "2026-09-05T00:00:00.000Z", "Re-adding must update an existing account.");
settings = removeRememberedAccount(settings, "1");
assertEqual(settings.accounts.some(({ userId }) => userId === "1"), false, "Removal must remove only selected metadata.");

assertEqual(
  updateLocalSettings(
    { version: 1, window: { mode: "windowed", width: 1400, height: 800 }, future: { enabled: true } },
    (current) => ({ ...current, accountCenter: { version: 1, accounts: [] } }),
  ),
  { version: 2, window: { mode: "windowed", width: 1400, height: 800 }, future: { enabled: true }, accountCenter: { version: 1, accounts: [] } },
  "Account settings writes must preserve existing window and future settings.",
);

console.log("Account-center settings contract passed.");
