export type DesktopUpdate = {
  version: string;
  installAndRestart(): Promise<void>;
};

export type DesktopServerUpdateStatus = {
  maintenance: boolean;
  maintenanceReason: string | null;
  active: null | { version: string };
};

export type DesktopUpdateGateDecision =
  | { kind: "ready" }
  | { kind: "maintenance"; message: string }
  | { kind: "required"; update: DesktopUpdate }
  | { kind: "error"; message: string };

export function resolveDesktopUpdateGate(status: DesktopServerUpdateStatus, currentVersion: string, update: DesktopUpdate | null): DesktopUpdateGateDecision {
  if (status.maintenance) return { kind: "maintenance", message: status.maintenanceReason ?? "Rollcasters is temporarily under maintenance." };
  if (!status.active || status.active.version === currentVersion) return { kind: "ready" };
  if (!update || update.version !== status.active.version) return { kind: "error", message: "The active Game Update is not available from the signed update feed." };
  return { kind: "required", update };
}

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || window.location.protocol === "tauri:");
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
