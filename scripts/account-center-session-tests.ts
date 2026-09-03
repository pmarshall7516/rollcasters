import {
  createAccountCenterManager,
  emptyAccountCenterSettings,
  type AccountAuthClient,
  type AccountCenterManager,
  type AuthSession,
  type RememberedAccount,
} from "../src/lib/account-center.js";
import type { SecureCredentialStore } from "../src/lib/account-center-storage.js";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

async function assertRejects(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`Unexpected error: ${message}`);
    return;
  }
  throw new Error(`Expected error matching ${pattern}.`);
}

const account = (userId: string): RememberedAccount => ({
  userId,
  email: `${userId}@example.com`,
  username: userId,
  addedAt: "2026-09-03T00:00:00.000Z",
  lastUsedAt: "2026-09-03T00:00:00.000Z",
  credentialVersion: 1,
});

const session = (userId: string, refreshToken: string): AuthSession => ({
  access_token: `${userId}-access`,
  refresh_token: refreshToken,
  user: { id: userId, email: `${userId}@example.com`, user_metadata: { username: userId } },
});

class FakeCredentialStore implements SecureCredentialStore {
  values = new Map<string, string>();
  deleted: string[] = [];
  async get(userId: string) { return this.values.get(userId) ?? null; }
  async set(userId: string, token: string) { this.values.set(userId, token); }
  async delete(userId: string) { this.deleted.push(userId); this.values.delete(userId); }
}

class FakeClient implements AccountAuthClient {
  refreshTokens: string[] = [];
  signOutScopes: string[] = [];
  disposed = false;
  readonly auth = {
    setSession: async () => ({ data: { session: session("alice", "alice-imported") }, error: null }),
    signInWithPassword: async () => ({ data: { session: null }, error: new Error("unused") }),
    signUp: async () => ({ data: { session: null }, error: new Error("unused") }),
    refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
      this.refreshTokens.push(refresh_token);
      return { data: { session: session("alice", "alice-rotated") }, error: null };
    },
    signOut: async ({ scope }: { scope: "local" }) => {
      this.signOutScopes.push(scope);
      return { error: null };
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    dispose: () => { this.disposed = true; },
  };
}

function createFakeManager() {
  const credentialStore = new FakeCredentialStore();
  const client = new FakeClient();
  let settings: unknown = emptyAccountCenterSettings();
  const manager = createAccountCenterManager({
    credentialStore,
    clientFactory: () => client,
    loadSettings: async () => settings,
    saveSettings: async (update) => { settings = update(settings as Record<string, unknown>); },
  });
  return { manager, credentialStore, client };
}

const { manager, credentialStore, client } = createFakeManager();
await manager.initialize();
const initialSnapshot = manager.snapshot();
if (manager.snapshot() !== initialSnapshot) throw new Error("External-store snapshots must be referentially stable between updates.");
await manager.addAccount(account("alice"), "alice-refresh");
const restored = await manager.restoreAccount("alice");
assertEqual(restored.user.id, "alice", "Restore must return the selected user.");
assertEqual(client.refreshTokens, ["alice-refresh"], "Restore must use the selected account token.");
assertEqual(manager.snapshot().activeAccountId, "alice", "Restore must activate the selected account.");
assertEqual(credentialStore.values.get("alice"), "alice-rotated", "Refresh rotation must update secure storage.");

await manager.returnToAccountCenter();
assertEqual(client.disposed, true, "Returning to the chooser must dispose the old client.");
assertEqual(credentialStore.deleted, [], "Switching must retain the remembered credential.");

const imported = createFakeManager();
await imported.manager.initialize();
await imported.manager.importSession(session("alice", "legacy-refresh"));
assertEqual(imported.credentialStore.values.get("alice"), "alice-imported", "Legacy sessions must be moved into secure account storage.");
assertEqual(imported.manager.snapshot().activeAccountId, "alice", "Imported sessions must activate the account.");

const active = createFakeManager();
await active.manager.initialize();
await active.manager.addAccount(account("alice"), "alice-refresh");
await active.manager.restoreAccount("alice");
await active.manager.removeAccount("alice");
assertEqual(active.client.signOutScopes, ["local"], "Removal must revoke only the local session.");
assertEqual(active.credentialStore.deleted, ["alice"], "Removal must delete the secure credential.");

const capped = createFakeManager();
await capped.manager.initialize();
await capped.manager.addAccount(account("a"), "a-refresh");
await capped.manager.addAccount(account("b"), "b-refresh");
await capped.manager.addAccount(account("c"), "c-refresh");
await assertRejects(() => capped.manager.addAccount(account("d"), "d-refresh"), /three|limit/i);

console.log("Account-center session contract passed.");
