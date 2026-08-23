import type { SupportedStorage } from "@supabase/supabase-js";

type Invoke = <T>(command: string, args: Record<string, string>) => Promise<T>;

async function tauriInvoke(): Promise<Invoke> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

export function createDesktopSessionStorage(service: string, account: string): SupportedStorage {
  const args = { service, account };
  const auxiliaryKeys = new Set([
    `${account}-code-verifier`,
    `${account}-user`,
  ]);
  const auxiliaryStorage = new Map<string, string>();

  function assertStorageKey(key: string): boolean {
    if (key === account) return true;
    if (auxiliaryKeys.has(key)) return false;
    throw new Error("Unexpected desktop session-storage key.");
  }

  return {
    async getItem(key) {
      if (!assertStorageKey(key)) return auxiliaryStorage.get(key) ?? null;
      return (await tauriInvoke())<string | null>("session_get", args);
    },
    async setItem(key, value) {
      if (!assertStorageKey(key)) {
        auxiliaryStorage.set(key, value);
        return;
      }
      await (await tauriInvoke())("session_set", { ...args, value });
    },
    async removeItem(key) {
      if (!assertStorageKey(key)) {
        auxiliaryStorage.delete(key);
        return;
      }
      await (await tauriInvoke())("session_delete", args);
    },
  };
}
