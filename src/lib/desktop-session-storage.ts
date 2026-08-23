import type { SupportedStorage } from "@supabase/supabase-js";

type Invoke = <T>(command: string, args: Record<string, string>) => Promise<T>;

async function tauriInvoke(): Promise<Invoke> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

export function createDesktopSessionStorage(service: string, account: string): SupportedStorage {
  const args = { service, account };
  return {
    async getItem(key) {
      if (key !== account) throw new Error("Unexpected desktop session-storage key.");
      return (await tauriInvoke())<string | null>("session_get", args);
    },
    async setItem(key, value) {
      if (key !== account) throw new Error("Unexpected desktop session-storage key.");
      await (await tauriInvoke())("session_set", { ...args, value });
    },
    async removeItem(key) {
      if (key !== account) throw new Error("Unexpected desktop session-storage key.");
      await (await tauriInvoke())("session_delete", args);
    },
  };
}
