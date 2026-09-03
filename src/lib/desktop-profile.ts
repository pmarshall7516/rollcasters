export type GameProfile = "local" | "stable";
export type GameEnvironment = "production";
export type GameUpdateChannel = "none" | "stable";

export type DesktopProfile = {
  profile: GameProfile;
  environment: GameEnvironment;
  channel: GameUpdateChannel;
  appName: "Rollcasters Local" | "Rollcasters";
  appId: "com.rollcasters.local" | "com.rollcasters.game";
  badge: "LOCAL" | "";
  storageNamespace: string;
  credentialNamespace: string;
  dataNamespace: string;
  logNamespace: string;
  updaterNamespace: string;
  projectRef: string;
};

type ProfileEnvironment = Record<string, string | boolean | undefined>;

const CONTRACT = {
  local: { environment: "production", channel: "none", appName: "Rollcasters Local", appId: "com.rollcasters.local", badge: "LOCAL" },
  stable: { environment: "production", channel: "stable", appName: "Rollcasters", appId: "com.rollcasters.game", badge: "" },
} as const satisfies Record<GameProfile, {
  environment: GameEnvironment;
  channel: GameUpdateChannel;
  appName: DesktopProfile["appName"];
  appId: DesktopProfile["appId"];
  badge: DesktopProfile["badge"];
}>;

function projectRef(url: string | undefined, profile: GameProfile): string {
  if (!url) return "not-configured";
  try {
    const parsed = new URL(url);
    if (profile === "local" && parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname) && parsed.port === "54321") {
      return "rollcasters-local-player";
    }
    const [ref, ...suffix] = parsed.hostname.split(".");
    if (!ref || suffix.join(".") !== "supabase.co") throw new Error();
    return ref;
  } catch {
    throw new Error("VITE_SUPABASE_URL must be an https://<project-ref>.supabase.co URL.");
  }
}

export function resolveDesktopProfile(env: ProfileEnvironment): DesktopProfile {
  const rawProfile = String(env.VITE_GAME_PROFILE ?? "local");
  if (!(rawProfile in CONTRACT)) throw new Error(`Unknown Rollcasters profile: ${rawProfile}.`);
  const profile = rawProfile as GameProfile;
  const expected = CONTRACT[profile];
  const environment = String(env.VITE_GAME_ENVIRONMENT ?? expected.environment);
  const channel = String(env.VITE_GAME_UPDATE_CHANNEL ?? expected.channel);
  if (environment !== expected.environment) {
    throw new Error(`${profile} profile requires ${expected.environment} environment.`);
  }
  if (channel !== expected.channel) {
    throw new Error(`${profile} profile requires ${expected.channel} update channel.`);
  }
  const actualProjectRef = projectRef(typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL : undefined, profile);
  const expectedProjectRef = String(env.VITE_EXPECTED_SUPABASE_PROJECT_REF ?? (profile === "local" ? actualProjectRef : "")).trim();
  if (!expectedProjectRef) {
    throw new Error(`${profile} profile requires VITE_EXPECTED_SUPABASE_PROJECT_REF.`);
  }
  if (expectedProjectRef && actualProjectRef !== expectedProjectRef) {
    throw new Error(`Configured Supabase project reference does not match the ${profile} profile.`);
  }
  return {
    profile,
    environment: expected.environment,
    channel: expected.channel,
    appName: expected.appName,
    appId: expected.appId,
    badge: expected.badge,
    storageNamespace: `${expected.appId}.auth`,
    credentialNamespace: `${expected.appId}.accounts.v1:${actualProjectRef}`,
    dataNamespace: `${expected.appId}.data`,
    logNamespace: `${expected.appId}.logs`,
    updaterNamespace: `${expected.appId}.updates`,
    projectRef: actualProjectRef,
  };
}

export function resolveBuildProfile(mode: string, env: ProfileEnvironment): DesktopProfile {
  const profile = mode === "development" || mode === "local" ? "local" : mode === "production" || mode === "stable" ? "stable" : undefined;
  if (!profile) throw new Error(`Rollcasters builds require local or stable mode; received ${mode}.`);
  const contract = CONTRACT[profile];
  return resolveDesktopProfile({
    ...env,
    VITE_GAME_PROFILE: profile,
    VITE_GAME_ENVIRONMENT: contract.environment,
    VITE_GAME_UPDATE_CHANNEL: contract.channel,
  });
}
