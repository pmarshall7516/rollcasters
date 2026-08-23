export type DesktopUpdate = {
  version: string;
  installAndRestart(): Promise<void>;
};

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkForDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isTauriDesktop()) return null;
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process"),
  ]);
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    installAndRestart: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}

