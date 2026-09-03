import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktop } from "./desktop-updater.js";
import type { DesktopProfile } from "./desktop-profile.js";

export class SecureCredentialStoreUnavailableError extends Error {
  constructor() {
    super("Remembered account storage is unavailable in this build.");
    this.name = "SecureCredentialStoreUnavailableError";
  }
}

export interface SecureCredentialStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, refreshToken: string): Promise<void>;
  delete(userId: string): Promise<void>;
}

class NativeCredentialStore implements SecureCredentialStore {
  get(userId: string): Promise<string | null> {
    return invoke<string | null>("secure_credential_get", { userId });
  }

  async set(userId: string, refreshToken: string): Promise<void> {
    await invoke("secure_credential_set", { userId, refreshToken });
  }

  async delete(userId: string): Promise<void> {
    await invoke("secure_credential_delete", { userId });
  }
}

class BrowserDevelopmentCredentialStore implements SecureCredentialStore {
  constructor(private readonly profile: DesktopProfile) {}

  get(userId: string): Promise<string | null> {
    return Promise.resolve(this.storage()?.getItem(this.key(userId)) ?? null);
  }

  set(userId: string, refreshToken: string): Promise<void> {
    this.storage()?.setItem(this.key(userId), refreshToken);
    return Promise.resolve();
  }

  delete(userId: string): Promise<void> {
    this.storage()?.removeItem(this.key(userId));
    return Promise.resolve();
  }

  private storage(): Storage | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  private key(userId: string): string {
    return `${this.profile.dataNamespace}.account-center.credential.${userId}`;
  }
}

class UnavailableCredentialStore implements SecureCredentialStore {
  get(): Promise<string | null> { return Promise.reject(new SecureCredentialStoreUnavailableError()); }
  set(): Promise<void> { return Promise.reject(new SecureCredentialStoreUnavailableError()); }
  delete(): Promise<void> { return Promise.reject(new SecureCredentialStoreUnavailableError()); }
}

export function createSecureCredentialStore(profile: DesktopProfile, browserFallbackAllowed = false): SecureCredentialStore {
  if (isTauriDesktop()) return new NativeCredentialStore();
  if (profile.profile === "local" && browserFallbackAllowed) {
    return new BrowserDevelopmentCredentialStore(profile);
  }
  return new UnavailableCredentialStore();
}
