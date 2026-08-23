import { resolveBuildProfile, resolveDesktopProfile } from "../src/lib/desktop-profile.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(run: () => unknown, pattern: RegExp) {
  try {
    run();
  } catch (error) {
    check(pattern.test(error instanceof Error ? error.message : String(error)), `Unexpected error: ${String(error)}`);
    return;
  }
  throw new Error(`Expected error matching ${pattern}.`);
}

const local = resolveDesktopProfile({
  VITE_GAME_PROFILE: "local",
  VITE_GAME_ENVIRONMENT: "production",
  VITE_GAME_UPDATE_CHANNEL: "none",
  VITE_SUPABASE_URL: "https://production-project.supabase.co",
  VITE_EXPECTED_SUPABASE_PROJECT_REF: "production-project",
});
check(local.environment === "production" && local.channel === "none", "Local tools must use the one Production database without an updater channel.");
check(local.appId === "com.rollcasters.local" && local.badge === "LOCAL", "Local identity changed.");

const stable = resolveDesktopProfile({
  VITE_GAME_PROFILE: "stable",
  VITE_GAME_ENVIRONMENT: "production",
  VITE_GAME_UPDATE_CHANNEL: "stable",
  VITE_SUPABASE_URL: "https://production-project.supabase.co",
  VITE_EXPECTED_SUPABASE_PROJECT_REF: "production-project",
});
check(stable.appId === "com.rollcasters.game", "Stable app ID changed.");
check(stable.badge === "", "Stable must not display a non-production badge.");

expectThrow(() => resolveDesktopProfile({
  VITE_GAME_PROFILE: "stable",
  VITE_GAME_ENVIRONMENT: "production",
  VITE_GAME_UPDATE_CHANNEL: "none",
  VITE_SUPABASE_URL: "https://production-project.supabase.co",
  VITE_EXPECTED_SUPABASE_PROJECT_REF: "production-project",
}), /stable profile requires stable update channel/i);

expectThrow(() => resolveDesktopProfile({
  VITE_GAME_PROFILE: "stable",
  VITE_GAME_ENVIRONMENT: "production",
  VITE_GAME_UPDATE_CHANNEL: "stable",
  VITE_SUPABASE_URL: "https://wrong-project.supabase.co",
  VITE_EXPECTED_SUPABASE_PROJECT_REF: "staging-project",
}), /project reference/i);

expectThrow(() => resolveBuildProfile("stable", {
  VITE_SUPABASE_URL: "https://production-project.supabase.co",
}), /requires VITE_EXPECTED_SUPABASE_PROJECT_REF/i);

const stableBuildFromLocalDefaults = resolveBuildProfile("stable", {
  VITE_GAME_PROFILE: "local",
  VITE_GAME_ENVIRONMENT: "production",
  VITE_GAME_UPDATE_CHANNEL: "none",
  VITE_SUPABASE_URL: "https://production-project.supabase.co",
  VITE_EXPECTED_SUPABASE_PROJECT_REF: "production-project",
});
check(stableBuildFromLocalDefaults.profile === "stable" && stableBuildFromLocalDefaults.channel === "stable", "Explicit Stable build mode must override local workflow defaults.");

console.log("Desktop profile contract tests passed.");
