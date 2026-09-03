import type { SecureCredentialStore } from "./account-center-storage.js";

export const ACCOUNT_CENTER_SETTINGS_VERSION = 1;
export const MAX_REMEMBERED_ACCOUNTS = 3;

export type RememberedAccount = {
  userId: string;
  email: string;
  username: string;
  addedAt: string;
  lastUsedAt: string;
  credentialVersion: number;
};

export type AccountCenterSettings = {
  version: typeof ACCOUNT_CENTER_SETTINGS_VERSION;
  accounts: RememberedAccount[];
};

export type AuthSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
};

export type AccountAuthClient = {
  auth: {
    setSession(credentials: { access_token: string; refresh_token: string }): Promise<{ data: { session: AuthSession | null }; error: unknown | null }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<{ data: { session: AuthSession | null }; error: unknown | null }>;
    signUp(credentials: { email: string; password: string; options?: { data?: Record<string, unknown> } }): Promise<{ data: { session: AuthSession | null }; error: unknown | null }>;
    refreshSession(credentials: { refresh_token: string }): Promise<{ data: { session: AuthSession | null }; error: unknown | null }>;
    signOut(options: { scope: "local" }): Promise<{ error: unknown | null }>;
    onAuthStateChange(callback: (event: string, session: AuthSession | null) => void): { data: { subscription: { unsubscribe(): void } } };
    dispose?(): void;
  };
};

export type AccountCenterSnapshot = {
  ready: boolean;
  accounts: RememberedAccount[];
  activeAccountId: string | null;
  busyAccountId: string | null;
  accountErrors: Record<string, string>;
};

export type AccountCenterManagerOptions = {
  credentialStore: SecureCredentialStore;
  clientFactory: () => AccountAuthClient;
  loadSettings: () => Promise<unknown>;
  saveSettings: (update: (current: Record<string, unknown>) => Record<string, unknown>) => Promise<void>;
  validateSession?: (client: AccountAuthClient, session: AuthSession) => Promise<void>;
  setActiveClient?: (client: AccountAuthClient | null, userId: string | null) => void;
};

export function createAccountCenterManager(options: AccountCenterManagerOptions): AccountCenterManager {
  return new AccountCenterManager(options);
}

export function emptyAccountCenterSettings(): AccountCenterSettings {
  return { version: ACCOUNT_CENTER_SETTINGS_VERSION, accounts: [] };
}

export function readAccountCenterSettings(value: unknown): AccountCenterSettings {
  if (!isRecord(value)) return emptyAccountCenterSettings();
  const section = isRecord(value.accountCenter) ? value.accountCenter : value;
  if (!Array.isArray(section.accounts)) return emptyAccountCenterSettings();

  const accounts = new Map<string, RememberedAccount>();
  for (const candidate of section.accounts) {
    const account = normalizeAccount(candidate);
    if (!account) continue;
    const existing = accounts.get(account.userId);
    if (!existing || account.lastUsedAt >= existing.lastUsedAt) accounts.set(account.userId, account);
  }
  return {
    version: ACCOUNT_CENTER_SETTINGS_VERSION,
    accounts: [...accounts.values()].sort(compareAccounts).slice(0, MAX_REMEMBERED_ACCOUNTS),
  };
}

export function upsertRememberedAccount(settings: AccountCenterSettings, account: RememberedAccount): AccountCenterSettings {
  const current = readAccountCenterSettings(settings);
  const exists = current.accounts.some(({ userId }) => userId === account.userId);
  if (!exists && current.accounts.length >= MAX_REMEMBERED_ACCOUNTS) {
    throw new Error("Account Center already has three remembered accounts. Remove an account before adding another.");
  }
  return readAccountCenterSettings({ accountCenter: { accounts: [...current.accounts.filter(({ userId }) => userId !== account.userId), account] } });
}

export function removeRememberedAccount(settings: AccountCenterSettings, userId: string): AccountCenterSettings {
  const current = readAccountCenterSettings(settings);
  return { ...current, accounts: current.accounts.filter((account) => account.userId !== userId) };
}

export class AccountCenterManager {
  private settings: AccountCenterSettings = emptyAccountCenterSettings();
  private currentClient: AccountAuthClient | null = null;
  private currentGeneration = 0;
  private snapshotState: AccountCenterSnapshot = {
    ready: false,
    accounts: [],
    activeAccountId: null,
    busyAccountId: null,
    accountErrors: {},
  };
  private readonly listeners = new Set<() => void>();
  private transition = Promise.resolve();

  constructor(private readonly options: AccountCenterManagerOptions) {}

  snapshot(): AccountCenterSnapshot {
    return {
      ...this.snapshotState,
      accounts: [...this.snapshotState.accounts],
      accountErrors: { ...this.snapshotState.accountErrors },
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<AccountCenterSnapshot> {
    return this.enqueue(async () => {
      this.settings = readAccountCenterSettings(await this.options.loadSettings());
      this.publish({ ready: true, accounts: this.settings.accounts, activeAccountId: null, busyAccountId: null });
      return this.snapshot();
    });
  }

  async addAccount(account: RememberedAccount, refreshToken: string): Promise<void> {
    return this.enqueue(async () => {
      const next = upsertRememberedAccount(this.settings, account);
      await this.options.credentialStore.set(account.userId, refreshToken);
      await this.persist(next);
    });
  }

  async signInWithPassword(email: string, password: string): Promise<AuthSession> {
    return this.enqueue(async () => {
      const client = this.options.clientFactory();
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error || !result.data.session) {
        client.auth.dispose?.();
        throw result.error ?? new Error("Sign-in did not create a session.");
      }
      return this.rememberAndActivate(client, result.data.session);
    });
  }

  async signUp(email: string, password: string, username: string): Promise<AuthSession | null> {
    return this.enqueue(async () => {
      const client = this.options.clientFactory();
      const result = await client.auth.signUp({ email, password, options: { data: { username } } });
      if (result.error) {
        client.auth.dispose?.();
        throw result.error;
      }
      if (!result.data.session) {
        client.auth.dispose?.();
        return null;
      }
      return this.rememberAndActivate(client, result.data.session);
    });
  }

  async importSession(session: AuthSession): Promise<AuthSession> {
    return this.enqueue(async () => {
      const client = this.options.clientFactory();
      const result = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      if (result.error || !result.data.session) {
        client.auth.dispose?.();
        throw result.error ?? new Error("The existing session could not be imported.");
      }
      if (result.data.session.user.id !== session.user.id) {
        client.auth.dispose?.();
        throw new Error("The existing session belonged to a different account.");
      }
      return this.rememberAndActivate(client, result.data.session);
    });
  }

  async restoreAccount(userId: string): Promise<AuthSession> {
    return this.enqueue(async () => {
      const refreshToken = await this.options.credentialStore.get(userId);
      if (!refreshToken) {
        this.setAccountError(userId, "Sign in again to remember this account.");
        throw new Error("This account needs you to sign in again.");
      }
      const client = this.options.clientFactory();
      const result = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (result.error || !result.data.session) {
        client.auth.dispose?.();
        if (isInvalidCredentialError(result.error)) await this.options.credentialStore.delete(userId);
        this.setAccountError(userId, "This account needs you to sign in again.");
        throw result.error ?? new Error("Unable to restore this account.");
      }
      if (result.data.session.user.id !== userId) {
        client.auth.dispose?.();
        this.setAccountError(userId, "This saved account could not be verified.");
        throw new Error("The saved account did not match the selected account.");
      }
      return this.rememberAndActivate(client, result.data.session);
    });
  }

  async returnToAccountCenter(): Promise<void> {
    return this.enqueue(async () => {
      this.detachActiveClient();
      this.publish({ activeAccountId: null, busyAccountId: null });
    });
  }

  async removeAccount(userId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.snapshotState.activeAccountId === userId && this.currentClient) {
        const result = await this.currentClient.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
        this.detachActiveClient();
      }
      await this.options.credentialStore.delete(userId);
      const next = removeRememberedAccount(this.settings, userId);
      await this.persist(next);
      this.clearAccountError(userId);
      this.publish({ activeAccountId: null, busyAccountId: null });
    });
  }

  private async rememberAndActivate(client: AccountAuthClient, session: AuthSession): Promise<AuthSession> {
    const existing = this.settings.accounts.find((account) => account.userId === session.user.id);
    const now = new Date().toISOString();
    const metadata: RememberedAccount = {
      userId: session.user.id,
      email: session.user.email ?? "",
      username: stringValue(session.user.user_metadata?.username) || session.user.email?.split("@")[0] || "Player",
      addedAt: existing?.addedAt ?? now,
      lastUsedAt: now,
      credentialVersion: 1,
    };
    try {
      await this.options.validateSession?.(client, session);
      const next = upsertRememberedAccount(this.settings, metadata);
      await this.options.credentialStore.set(session.user.id, session.refresh_token);
      await this.persist(next);
      this.clearAccountError(session.user.id);
      this.activateClient(client, session.user.id);
      this.publish({ activeAccountId: session.user.id, busyAccountId: null });
      return session;
    } catch (error) {
      client.auth.dispose?.();
      throw error;
    }
  }

  private activateClient(client: AccountAuthClient, userId: string): void {
    this.detachActiveClient();
    const generation = ++this.currentGeneration;
    this.currentClient = client;
    client.auth.onAuthStateChange((event, session) => {
      if (generation !== this.currentGeneration || event !== "TOKEN_REFRESHED" || !session?.refresh_token) return;
      queueMicrotask(() => {
        if (generation !== this.currentGeneration) return;
        void this.options.credentialStore.set(userId, session.refresh_token).catch(() => {
          this.setAccountError(userId, "This account could not update its saved sign-in.");
        });
      });
    });
    this.options.setActiveClient?.(client, userId);
  }

  private detachActiveClient(): void {
    this.currentGeneration += 1;
    const client = this.currentClient;
    this.currentClient = null;
    this.options.setActiveClient?.(null, null);
    client?.auth.dispose?.();
  }

  private async persist(settings: AccountCenterSettings): Promise<void> {
    this.settings = settings;
    await this.options.saveSettings((current) => ({ ...current, accountCenter: settings }));
    this.publish({ accounts: settings.accounts });
  }

  private setAccountError(userId: string, message: string): void {
    this.publish({ accountErrors: { ...this.snapshotState.accountErrors, [userId]: message } });
  }

  private clearAccountError(userId: string): void {
    const errors = { ...this.snapshotState.accountErrors };
    delete errors[userId];
    this.publish({ accountErrors: errors });
  }

  private publish(next: Partial<AccountCenterSnapshot>): void {
    this.snapshotState = { ...this.snapshotState, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.transition.then(operation, operation);
    this.transition = next.then(() => undefined, () => undefined);
    return next;
  }
}

function isInvalidCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /refresh token|invalid token|session not found|invalid grant/i.test(message);
}

function normalizeAccount(value: unknown): RememberedAccount | null {
  if (!isRecord(value)) return null;
  const userId = stringValue(value.userId);
  const email = stringValue(value.email);
  const username = stringValue(value.username) || email;
  const addedAt = stringValue(value.addedAt);
  const lastUsedAt = stringValue(value.lastUsedAt);
  if (!userId || !email || !addedAt || !lastUsedAt) return null;
  return { userId, email, username, addedAt, lastUsedAt, credentialVersion: 1 };
}

function compareAccounts(left: RememberedAccount, right: RememberedAccount): number {
  return right.lastUsedAt.localeCompare(left.lastUsedAt) || right.addedAt.localeCompare(left.addedAt) || left.userId.localeCompare(right.userId);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
