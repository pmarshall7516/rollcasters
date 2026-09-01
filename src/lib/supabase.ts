import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { assertServerCatalogCompatibility, loadPublishedCatalog } from "./catalog-release";
import type {
  AppData,
  Catalog,
  CatalogReleaseInfo,
  CollectiblePlayerSnapshot,
  CombatProgressEvent,
  DungeonBattleResult,
  ActiveDungeonRun,
  DungeonOpponent,
  DungeonRunHistoryEntry,
  DungeonRunSnapshot,
  PlayerState,
  LootboxOpeningReceipt,
  PromoCodeRedemption,
  PromoCodeReward,
  ShopPurchaseReceipt,
  ShopPurchaseIntent,
  UserAbilitySlot,
  UserRelicSlot,
  UserSkillSlot,
} from "./types";
import { createRequestId } from "./uuid";
import { createPlayerMutationOutbox } from "./player-mutations";
import {
  aggregateShopPurchaseReceipts,
  indexedShopPurchaseRequestId,
  isAmbiguousShopPurchaseError,
  pendingShopPurchaseError,
  shopPurchaseRpcErrorDisposition,
} from "./shop";
import {
  applyLocalChallengeEvents,
  emptyLocalChallengePreviewState,
  mergeLocalChallengeSnapshot,
  readLocalChallengePreviewState,
  trackLocalChallenge,
  untrackLocalChallenge,
  writeLocalChallengePreviewState,
} from "./local-challenge-preview";
import { resolveDesktopProfile } from "./desktop-profile";
import {
  isLocalCatalogPreview,
  resolveLocalServerCompatibilityIdentity,
  shouldSyncLocalServerCompatibility,
  type LocalServerCompatibilityIdentity,
} from "./local-release-preview";
import { isTrackableChallenge } from "./collectibles";
import { recoverLootboxOpening } from "./lootbox";
import {
  normalizeDungeonDrop,
  type RawDungeonCurrencyDrop,
  type RawDungeonItemDrop,
} from "./catalog-normalization";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
const promoDefinitionUrl = (import.meta.env.VITE_PROMO_DEFINITION_SUPABASE_URL ?? supabaseUrl) as string | undefined;
const promoDefinitionKey = (import.meta.env.VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_PROMO_DEFINITION_SUPABASE_ANON_KEY ?? supabaseKey) as string | undefined;
const isSupabaseStorageUrl = (value: string | undefined) => Boolean(value && /supabase\.co\/storage\/v1/i.test(value));
const configuredGameAssetBaseCandidate = (import.meta.env.VITE_GAME_ASSET_BASE_URL as string | undefined)?.replace(/\/+$/, "");
const configuredGameAssetBaseUrl = isSupabaseStorageUrl(configuredGameAssetBaseCandidate) ? undefined : configuredGameAssetBaseCandidate;
const gameCatalogBaseCandidate = (import.meta.env.VITE_GAME_CATALOG_BASE_URL as string | undefined)?.replace(/\/+$/, "");
const gameCatalogBaseUrl = isSupabaseStorageUrl(gameCatalogBaseCandidate) ? undefined : gameCatalogBaseCandidate;
const gameVersion = (import.meta.env.VITE_GAME_VERSION as string | undefined) ?? "0.1.0";
export const currentGameVersion = gameVersion;
const gameCatalogReleaseId = (import.meta.env.VITE_GAME_CATALOG_RELEASE_ID as string | undefined) ?? "unversioned";
const gameClientProtocol = (import.meta.env.VITE_GAME_CLIENT_PROTOCOL_VERSION as string | undefined) ?? "1";
export const desktopProfile = resolveDesktopProfile(import.meta.env);
const desktopRuntime = typeof window !== "undefined"
  && ("__TAURI_INTERNALS__" in window || window.location.protocol === "tauri:");
const localCatalogPreview = isLocalCatalogPreview(
  desktopProfile.profile,
  import.meta.env.VITE_GAME_LOCAL_CATALOG_PREVIEW === "true",
);
// Every Game build is release-backed. Catalog authoring data is never a Game
// runtime dependency, including local development and browser previews.
const gameCatalogMode = "release";
const playerBootstrapMode = (import.meta.env.VITE_GAME_PLAYER_BOOTSTRAP_MODE as string | undefined) === "v1" ? "v1" : "legacy";
const allowLegacyPlayerBootstrap = import.meta.env.VITE_ALLOW_LEGACY_PLAYER_BOOTSTRAP === "true";
// Release-backed builds must provide their own asset base. There is no mutable
// remote fallback for artwork.
let activeGameAssetBaseUrl = configuredGameAssetBaseUrl;
const gameplaySessionId = createRequestId();
let activeGameplaySessionId: string | null = null;
let latestPlayerStateRevision: bigint | null = null;
let localPreviewUserId: string | null = null;
const playerMutationOutbox = createPlayerMutationOutbox<null>(null);

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);
const gameCompatibilityHeaders: Record<string, string> = {
  "x-rollcasters-version": gameVersion,
  "x-rollcasters-catalog-release": gameCatalogReleaseId,
  "x-rollcasters-protocol": gameClientProtocol,
};

// Supabase copies the global header object into its Auth and PostgREST
// clients during construction. The local browser preview updates these
// compatibility values after reading the active server policy, so inject the
// current values at request time instead of relying on a stale initial copy.
const compatibilityFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(gameCompatibilityHeaders)) {
    headers.set(name, value);
  }
  return globalThis.fetch(input, { ...init, headers });
};

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: !desktopRuntime,
        storageKey: desktopProfile.storageNamespace,
      },
      global: {
        headers: gameCompatibilityHeaders,
        fetch: compatibilityFetch,
      },
    })
  : null;

// Promo definitions are deliberately read through a separate, public-only
// Production client for Local builds. Claims and redemption history continue
// to use the profile's primary client, which points at the local player DB.
const promoDefinitionClient: SupabaseClient | null = promoDefinitionUrl && promoDefinitionKey
  ? createClient(promoDefinitionUrl, promoDefinitionKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

function applyServerCompatibilityIdentity(identity: LocalServerCompatibilityIdentity): void {
  Object.assign(gameCompatibilityHeaders, {
    "x-rollcasters-version": identity.version,
    "x-rollcasters-catalog-release": identity.catalogReleaseId,
    "x-rollcasters-protocol": identity.protocol,
  });

  // Supabase creates independent Auth and PostgREST header collections. Keep
  // those already-created clients aligned for the first request after the
  // local preview reads the active server policy.
  const client = supabase as unknown as {
    headers?: Record<string, string>;
    auth?: { headers?: Record<string, string> };
    rest?: { headers?: Headers };
  } | null;
  Object.assign(client?.headers ?? {}, gameCompatibilityHeaders);
  Object.assign(client?.auth?.headers ?? {}, gameCompatibilityHeaders);
  for (const [name, value] of Object.entries(gameCompatibilityHeaders)) {
    client?.rest?.headers?.set(name, value);
  }
}

function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  return supabase;
}

function requirePromoDefinitionClient(): SupabaseClient {
  if (!promoDefinitionClient) {
    throw new Error("Missing VITE_PROMO_DEFINITION_SUPABASE_URL or VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY.");
  }
  return promoDefinitionClient;
}

function localChallengePreviewStorage(): Storage | null {
  if (!localCatalogPreview || typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function localChallengePreviewStorageKey(): string {
  const userKey = localPreviewUserId ?? "anonymous";
  return `${desktopProfile.dataNamespace}.challenge-preview.${gameCatalogReleaseId}.${userKey}`;
}

function readLocalChallengeState() {
  return readLocalChallengePreviewState(localChallengePreviewStorage(), localChallengePreviewStorageKey());
}

function writeLocalChallengeState(state: ReturnType<typeof emptyLocalChallengePreviewState>): void {
  writeLocalChallengePreviewState(localChallengePreviewStorage(), localChallengePreviewStorageKey(), state);
}

export type GameUpdateStatus = {
  environment: "production";
  channel: "stable";
  maintenance: boolean;
  emergencyMaintenance: boolean;
  maintenanceReason: string | null;
  active: null | { id: string; version: string; catalogReleaseId: string; clientProtocolVersion: number; activatedAt: string };
  scheduled: null | { id: string; version: string; catalogReleaseId: string; clientProtocolVersion: number; activatesAt: string };
};

export async function getGameUpdateStatus(): Promise<GameUpdateStatus> {
  const { data, error } = await requireClient().rpc("get_game_update_status");
  if (error) throw error;
  return data as GameUpdateStatus;
}

let localServerCompatibilityPromise: Promise<GameUpdateStatus | null> | null = null;

/**
 * The browser harness is not an installed desktop client, so it cannot use
 * the Tauri updater to move its version forward. It still needs to satisfy
 * the Production RPC compatibility hook. Read the active identity through the
 * deliberately public status RPC, then update the same mutable header object
 * used by every Supabase request. Stable desktop builds never enter this path.
 */
export function syncLocalServerCompatibility(): Promise<GameUpdateStatus | null> {
  if (!supabase || !shouldSyncLocalServerCompatibility(desktopProfile.profile)) return Promise.resolve(null);
  if (!localServerCompatibilityPromise) {
    localServerCompatibilityPromise = (async () => {
      const status = await getGameUpdateStatus();
      if (status.active) {
        applyServerCompatibilityIdentity(
          resolveLocalServerCompatibilityIdentity(
            {
              version: gameCompatibilityHeaders["x-rollcasters-version"],
              catalogReleaseId: gameCompatibilityHeaders["x-rollcasters-catalog-release"],
              protocol: gameCompatibilityHeaders["x-rollcasters-protocol"],
            },
            status.active,
          ),
        );
      }
      return status;
    })().catch((error) => {
      localServerCompatibilityPromise = null;
      throw error;
    });
  }
  return localServerCompatibilityPromise;
}

function emptyCollectibleSnapshot(): CollectiblePlayerSnapshot {
  return { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] };
}

let catalogPromise: Promise<Catalog> | null = null;
let currentCatalogRelease: CatalogReleaseInfo | undefined;

async function getServerCollectiblePlayerSnapshot(): Promise<CollectiblePlayerSnapshot> {
  const client = requireClient();
  const [snapshotResult, lootboxResult] = await Promise.all([
    client.rpc("get_collectible_player_snapshot"),
    client.from("user_lootboxes").select("lootbox_id,quantity").gt("quantity", 0),
  ]);
  if (snapshotResult.error) throw snapshotResult.error;
  if (lootboxResult.error) throw lootboxResult.error;
  return {
    ...emptyCollectibleSnapshot(),
    ...(snapshotResult.data as Partial<CollectiblePlayerSnapshot> | null),
    // Keep this projection independent of the snapshot RPC so a deployed
    // function that predates Lootboxes cannot hide a successfully purchased
    // Bag item from the player.
    lootboxes: (lootboxResult.data ?? []).map((row) => ({
      lootbox_id: String(row.lootbox_id),
      quantity: String(row.quantity),
    })),
  };
}

export async function getCollectiblePlayerSnapshot(): Promise<CollectiblePlayerSnapshot> {
  const serverSnapshot = await getServerCollectiblePlayerSnapshot();
  return localCatalogPreview
    ? mergeLocalChallengeSnapshot(serverSnapshot, readLocalChallengeState())
    : serverSnapshot;
}

export async function getSession(): Promise<Session | null> {
  const client = requireClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  if (data.session && !(await isGameAccount(client))) {
    await client.auth.signOut({ scope: "local" });
    localPreviewUserId = null;
    throw new Error("This is a dev-tool account. Sign in with a dedicated Rollcasters game account.");
  }
  localPreviewUserId = data.session?.user.id ?? null;
  return data.session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!(await isGameAccount(client))) {
    await client.auth.signOut({ scope: "local" });
    localPreviewUserId = null;
    throw new Error("This is a dev-tool account. Sign in with a dedicated Rollcasters game account.");
  }
  localPreviewUserId = data.user?.id ?? data.session?.user.id ?? null;
}

async function isGameAccount(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("is_game_account");
  if (error) throw error;
  return data === true;
}

export async function signUp(email: string, password: string, username: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw error;
  localPreviewUserId = data.user?.id ?? data.session?.user.id ?? null;
  return Boolean(data.session);
}

export async function signOut(): Promise<void> {
  const client = requireClient();
  // Release the lease before waiting on any queued writes. A logout is a
  // session boundary: another device must be able to acquire the account even
  // if a best-effort mutation flush is slow or unavailable.
  await releaseGameplaySession().catch(() => undefined);
  await flushPlayerMutations().catch(() => undefined);
  const { error } = await client.auth.signOut();
  if (error) throw error;
  localPreviewUserId = null;
}

export type GameplaySessionResult = {
  outcome: "ACQUIRED" | "ACCOUNT_ONLINE";
  session_id?: string;
  active_session_id?: string;
  player_state_revision?: string | number;
  heartbeat_at?: string;
  expires_at?: string;
};

export function currentGameplaySessionId(): string | null {
  return activeGameplaySessionId;
}

export async function releaseGameplaySession(): Promise<void> {
  const sessionId = activeGameplaySessionId;
  activeGameplaySessionId = null;
  if (!sessionId) return;
  const { error } = await requireClient().rpc("release_gameplay_session", { p_session_id: sessionId });
  if (error) throw error;
}

export async function acquireGameplaySession(takeover = false): Promise<GameplaySessionResult> {
  const { data, error } = await requireClient().rpc("acquire_gameplay_session", {
    p_session_id: gameplaySessionId,
    p_device_install_id: desktopProfile.storageNamespace,
    p_game_version: gameVersion,
    p_catalog_release_id: gameCatalogReleaseId,
    p_client_protocol_version: Number(gameClientProtocol) || 1,
    p_takeover: takeover,
  });
  if (error) throw error;
  const result = data as GameplaySessionResult;
  if (result.outcome === "ACQUIRED") activeGameplaySessionId = result.session_id ?? gameplaySessionId;
  return result;
}

export async function heartbeatGameplaySession(): Promise<GameplaySessionResult> {
  if (!activeGameplaySessionId) throw new Error("SESSION_DISPLACED");
  const { data, error } = await requireClient().rpc("heartbeat_gameplay_session", { p_session_id: activeGameplaySessionId });
  if (error) throw error;
  return data as GameplaySessionResult;
}

export function flushPlayerMutations(): Promise<void> {
  return playerMutationOutbox.flushPlayerMutations();
}

function enqueuePlayerMutation<T>(resourceKey: string, operation: () => Promise<T>): Promise<T> {
  let result: T;
  return playerMutationOutbox.mutatePlayer({
    requestId: createRequestId(),
    resourceKey,
    apply: (state) => state,
    send: async () => {
      result = await operation();
      return { requestId: createRequestId() };
    },
  }).then(() => result!);
}

function playerMutationResourceKey(name: string, args: Record<string, unknown>): string {
  if (name.includes("set_squad_critter_slot")) return `${name}:${args.p_slot_index ?? ""}`;
  if (name.includes("set_critter_skill_slot") || name.includes("set_critter_relic_slot")) {
    return `${name}:${args.p_user_critter_id ?? ""}:${args.p_slot_index ?? ""}`;
  }
  if (name.includes("set_rollcaster_ability_slot")) {
    return `${name}:${args.p_user_rollcaster_id ?? ""}:${args.p_slot_index ?? ""}`;
  }
  if (name.includes("unlock_critter_skill")) return `${name}:${args.p_user_critter_id ?? ""}:${args.p_skill_id ?? ""}`;
  if (name.includes("unlock_rollcaster_ability")) return `${name}:${args.p_user_rollcaster_id ?? ""}:${args.p_ability_id ?? ""}`;
  if (name.includes("active_rollcaster")) return name;
  if (name.includes("challenge")) return `${name}:${args.p_challenge_id ?? ""}`;
  return `${name}:${JSON.stringify(args)}`;
}

export async function ensureUserGameState(): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("ensure_user_game_state");
  if (error) throw error;
}

export async function selectStarterCritter(critterId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("select_starter_critter", { p_critter_id: critterId });
  if (error) throw error;
}

export async function selectStarterRollcaster(rollcasterId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("select_starter_rollcaster", { p_rollcaster_id: rollcasterId });
  if (error) throw error;
}

export function getGameAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  if (/^https?:\/\//i.test(assetPath)) {
    return isSupabaseStorageUrl(assetPath) ? null : assetPath;
  }
  const [objectPath, query = ""] = assetPath.split("?", 2);
  const normalizedPath = objectPath.replace(/^\/+/, "");
  if (!activeGameAssetBaseUrl) return null;
  const publicUrl = `${activeGameAssetBaseUrl}/${normalizedPath.split("/").map(encodeURIComponent).join("/")}`;
  if (!query) return publicUrl;
  // Local exact-catalog previews use Vite's relative `/@fs/...` asset root.
  // `URL` needs an absolute base when a cache-busting query is present.
  const url = new URL(publicUrl, typeof window === "undefined" ? undefined : window.location.href);
  if (query) url.search = query;
  return url.toString();
}

// Promo redemption artwork retains an immutable source catalog path. This
// resolver is the fallback when that reward no longer has an optimized variant
// in the current release registry.
export function getSnapshotGameAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  return getGameAssetUrl(assetPath);
}

export function loadCatalog({ force = false }: { force?: boolean } = {}): Promise<Catalog> {
  if (force || !catalogPromise) {
    catalogPromise = (async () => {
      if (gameCatalogMode !== "release") throw new Error("Unsupported mutable Catalog runtime mode.");
      if (!gameCatalogBaseUrl) {
        throw new Error("VITE_GAME_CATALOG_BASE_URL is required for every Game build.");
      }
      const published = await loadPublishedCatalog(gameCatalogBaseUrl, gameVersion);
      currentCatalogRelease = published.release;
      activeGameAssetBaseUrl = configuredGameAssetBaseUrl ?? published.release.assetBaseUrl ?? undefined;
      return published.catalog;
    })().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function clearCatalogCache(): void {
  catalogPromise = null;
  currentCatalogRelease = undefined;
  activeGameAssetBaseUrl = configuredGameAssetBaseUrl;
}

export function getCurrentCatalogRelease(): CatalogReleaseInfo | undefined {
  return currentCatalogRelease;
}

type PlayerBootstrapPayload = {
  profile: PlayerState["profile"];
  rollcasters: PlayerState["rollcasters"];
  critters: PlayerState["critters"];
  relic_inventory: PlayerState["relicInventory"];
  squad_slots: PlayerState["squadSlots"];
  skill_slots: PlayerState["skillSlots"];
  ability_slots: PlayerState["abilitySlots"];
  relic_slots: PlayerState["relicSlots"];
  unlocked_skills: Array<{ user_critter_id: string; skill_id: string }>;
  unlocked_abilities: Array<{ user_rollcaster_id: string; ability_id: string }>;
  dungeon_progress: PlayerState["dungeonProgress"];
  dungeon_run_history?: PlayerState["dungeonRunHistory"];
  collectible_snapshot: CollectiblePlayerSnapshot;
  player_state_revision: string;
  server_catalog_version: string | null;
};

function playerStateFromBootstrap(payload: PlayerBootstrapPayload): PlayerState {
  const unlockedSkillIdsByCritter: Record<string, string[]> = {};
  for (const row of payload.unlocked_skills ?? []) {
    unlockedSkillIdsByCritter[row.user_critter_id] = [
      ...(unlockedSkillIdsByCritter[row.user_critter_id] ?? []),
      row.skill_id,
    ];
  }
  const unlockedAbilityIdsByRollcaster: Record<string, string[]> = {};
  for (const row of payload.unlocked_abilities ?? []) {
    unlockedAbilityIdsByRollcaster[row.user_rollcaster_id] = [
      ...(unlockedAbilityIdsByRollcaster[row.user_rollcaster_id] ?? []),
      row.ability_id,
    ];
  }
  return {
    profile: payload.profile,
    rollcasters: payload.rollcasters ?? [],
    critters: payload.critters ?? [],
    relicInventory: payload.relic_inventory ?? [],
    squadSlots: payload.squad_slots ?? [],
    skillSlots: payload.skill_slots ?? [],
    abilitySlots: payload.ability_slots ?? [],
    relicSlots: payload.relic_slots ?? [],
    unlockedSkillIdsByCritter,
    unlockedAbilityIdsByRollcaster,
    dungeonProgress: payload.dungeon_progress ?? [],
    dungeonRunHistory: payload.dungeon_run_history ?? [],
    collectibleSnapshot: localCatalogPreview
      ? mergeLocalChallengeSnapshot(
        { ...emptyCollectibleSnapshot(), ...(payload.collectible_snapshot ?? {}) },
        readLocalChallengeState(),
      )
      : { ...emptyCollectibleSnapshot(), ...(payload.collectible_snapshot ?? {}) },
    playerStateRevision: payload.player_state_revision,
    serverCatalogVersion: payload.server_catalog_version,
  };
}

async function loadPlayerBootstrapV1(): Promise<PlayerState> {
  const client = requireClient();
  const [{ data, error }, lootboxResult, dungeonRunHistoryResult] = await Promise.all([
    client.rpc("player_bootstrap_v1"),
    client.from("user_lootboxes").select("lootbox_id,quantity").gt("quantity", 0),
    client.from("dungeon_runs").select("dungeon_id,status").in("status", ["won", "lost"]),
  ]);
  if (error) throw error;
  if (lootboxResult.error) throw lootboxResult.error;
  if (dungeonRunHistoryResult.error) throw dungeonRunHistoryResult.error;
  if (!data || typeof data !== "object") throw new Error("Player bootstrap returned no state.");
  const payload = data as PlayerBootstrapPayload;
  return playerStateFromBootstrap({
    ...payload,
    dungeon_run_history: (dungeonRunHistoryResult.data ?? []) as DungeonRunHistoryEntry[],
    collectible_snapshot: {
      ...payload.collectible_snapshot,
      lootboxes: (lootboxResult.data ?? []).map((row) => ({
        lootbox_id: String(row.lootbox_id),
        quantity: String(row.quantity),
      })),
    },
  });
}

async function loadLegacyPlayerState(): Promise<PlayerState> {
  const client = requireClient();
  const collectibleSnapshot = await getCollectiblePlayerSnapshot();
  const [
    profile,
    rollcasters,
    critters,
    relicInventory,
    squadSlots,
    skillSlots,
    abilitySlots,
    relicSlots,
    unlockedSkills,
    unlockedAbilities,
    dungeonProgress,
    dungeonRunHistory,
  ] = await Promise.all([
    client.from("profiles").select("user_id,username,coins,starter_rollcaster_selected_at,starter_selected_at,active_rollcaster_id").single(),
    client.from("user_rollcasters").select("id,user_id,rollcaster_id,level,xp,ability_points").order("unlocked_at", { ascending: true }),
    client.from("user_critters").select("id,user_id,critter_id,level,xp,skill_points").order("unlocked_at", { ascending: true }),
    client.from("user_relic_inventory").select("user_id,relic_id,quantity,discovered_at"),
    client.from("user_squad_slots").select("user_id,slot_index,user_critter_id").order("slot_index", { ascending: true }),
    client.from("user_critter_skill_slots").select("user_critter_id,slot_index,skill_id").order("slot_index", { ascending: true }),
    client.from("user_rollcaster_ability_slots").select("user_rollcaster_id,slot_index,ability_id").order("slot_index", { ascending: true }),
    client.from("user_critter_relic_slots").select("user_critter_id,slot_index,relic_id").order("slot_index", { ascending: true }),
    client.from("user_critter_skills").select("user_critter_id,skill_id"),
    client.from("user_rollcaster_abilities").select("user_rollcaster_id,ability_id"),
    client.from("user_dungeon_progress").select("user_id,dungeon_id,is_unlocked,completed_at,clear_count"),
    client.from("dungeon_runs").select("dungeon_id,status").in("status", ["won", "lost"]),
  ]);

  for (const result of [
    profile,
    rollcasters,
    critters,
    relicInventory,
    squadSlots,
    skillSlots,
    abilitySlots,
    relicSlots,
    unlockedSkills,
    unlockedAbilities,
    dungeonProgress,
    dungeonRunHistory,
  ]) {
    if (result.error) throw result.error;
  }

  const unlockedSkillIdsByCritter: Record<string, string[]> = {};
  for (const row of unlockedSkills.data ?? []) {
    const key = row.user_critter_id as string;
    unlockedSkillIdsByCritter[key] = [...(unlockedSkillIdsByCritter[key] ?? []), row.skill_id as string];
  }

  const unlockedAbilityIdsByRollcaster: Record<string, string[]> = {};
  for (const row of unlockedAbilities.data ?? []) {
    const key = row.user_rollcaster_id as string;
    unlockedAbilityIdsByRollcaster[key] = [
      ...(unlockedAbilityIdsByRollcaster[key] ?? []),
      row.ability_id as string,
    ];
  }

  return {
    profile: profile.data,
    rollcasters: rollcasters.data ?? [],
    critters: critters.data ?? [],
    relicInventory: relicInventory.data ?? [],
    squadSlots: squadSlots.data ?? [],
    skillSlots: (skillSlots.data ?? []) as UserSkillSlot[],
    abilitySlots: (abilitySlots.data ?? []) as UserAbilitySlot[],
    relicSlots: (relicSlots.data ?? []) as UserRelicSlot[],
    unlockedSkillIdsByCritter,
    unlockedAbilityIdsByRollcaster,
    dungeonProgress: dungeonProgress.data ?? [],
    dungeonRunHistory: (dungeonRunHistory.data ?? []) as DungeonRunHistoryEntry[],
    collectibleSnapshot,
  } as PlayerState;
}

export async function loadPlayerState(): Promise<PlayerState> {
  if (playerBootstrapMode === "legacy") {
    const state = await loadLegacyPlayerState();
    latestPlayerStateRevision = state.playerStateRevision == null ? null : BigInt(state.playerStateRevision);
    return state;
  }
  try {
    const state = await loadPlayerBootstrapV1();
    latestPlayerStateRevision = state.playerStateRevision == null ? null : BigInt(state.playerStateRevision);
    return state;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const missingRpc = code === "42883" || code === "PGRST202";
    if (!allowLegacyPlayerBootstrap || !missingRpc) throw error;
    console.warn("player_bootstrap_v1 is not installed; using the explicitly enabled legacy Supabase fallback.");
    const state = await loadLegacyPlayerState();
    latestPlayerStateRevision = state.playerStateRevision == null ? null : BigInt(state.playerStateRevision);
    return state;
  }
}

async function callLoadoutRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await enqueuePlayerMutation(playerMutationResourceKey(name, args), async () => requireClient().rpc(name, args));
  if (error) throw error;
}

type VersionedPlayerMutationRpc =
  | "set_squad_critter_slot_v2"
  | "set_critter_skill_slot_v2"
  | "set_critter_relic_slot_v2"
  | "set_active_rollcaster_v2"
  | "set_rollcaster_ability_slot_v2"
  | "track_collectible_challenge_v2"
  | "untrack_collectible_challenge_v2"
  | "unlock_critter_skill_v2"
  | "unlock_rollcaster_ability_v2";

async function callVersionedPlayerMutationRpc(
  name: VersionedPlayerMutationRpc,
  args: Record<string, unknown>,
): Promise<void> {
  if (!activeGameplaySessionId || latestPlayerStateRevision === null) {
    throw new Error("SESSION_NOT_READY");
  }
  const sessionId = activeGameplaySessionId;
  const expectedRevision = latestPlayerStateRevision;
  const requestId = createRequestId();
  const { data, error } = await enqueuePlayerMutation(playerMutationResourceKey(name, args), async () => requireClient().rpc(name, {
      ...args,
      p_session_id: sessionId,
      p_expected_revision: expectedRevision.toString(),
      p_request_id: requestId,
    }));
  if (error) throw error;
  const receipt = data as { resulting_revision?: string | number };
  if (receipt?.resulting_revision != null) latestPlayerStateRevision = BigInt(receipt.resulting_revision);
}

const callVersionedLoadoutRpc = callVersionedPlayerMutationRpc;

export const setSquadSlot = async (slotIndex: number, userCritterId: string | null) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("set_squad_critter_slot_v2", { p_slot_index: slotIndex, p_user_critter_id: userCritterId });
    return;
  }
  await callLoadoutRpc("set_squad_critter_slot", { p_slot_index: slotIndex, p_user_critter_id: userCritterId });
};

export const setCritterSkillSlot = async (userCritterId: string, slotIndex: number, skillId: string | null) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedLoadoutRpc("set_critter_skill_slot_v2", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_skill_id: skillId });
    return;
  }
  await callLoadoutRpc("set_critter_skill_slot", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_skill_id: skillId });
};

export const setCritterRelicSlot = async (userCritterId: string, slotIndex: number, relicId: string | null) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("set_critter_relic_slot_v2", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_relic_id: relicId });
    return;
  }
  await callLoadoutRpc("set_critter_relic_slot", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_relic_id: relicId });
};

export const setRollcasterAbilitySlot = async (userRollcasterId: string, slotIndex: number, abilityId: string | null) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedLoadoutRpc("set_rollcaster_ability_slot_v2", { p_user_rollcaster_id: userRollcasterId, p_slot_index: slotIndex, p_ability_id: abilityId });
    return;
  }
  await callLoadoutRpc("set_rollcaster_ability_slot", { p_user_rollcaster_id: userRollcasterId, p_slot_index: slotIndex, p_ability_id: abilityId });
};

export const setActiveRollcaster = async (userRollcasterId: string) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("set_active_rollcaster_v2", { p_user_rollcaster_id: userRollcasterId });
    return;
  }
  await callLoadoutRpc("set_active_rollcaster", { p_user_rollcaster_id: userRollcasterId });
};

export const unlockCritterSkill = async (userCritterId: string, skillId: string) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("unlock_critter_skill_v2", { p_user_critter_id: userCritterId, p_skill_id: skillId });
    return;
  }
  await callLoadoutRpc("unlock_critter_skill", { p_user_critter_id: userCritterId, p_skill_id: skillId });
};

export const unlockRollcasterAbility = async (userRollcasterId: string, abilityId: string) => {
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("unlock_rollcaster_ability_v2", { p_user_rollcaster_id: userRollcasterId, p_ability_id: abilityId });
    return;
  }
  await callLoadoutRpc("unlock_rollcaster_ability", { p_user_rollcaster_id: userRollcasterId, p_ability_id: abilityId });
};

export async function loadAppData(): Promise<AppData> {
  const [catalog, player] = await Promise.all([loadCatalog(), loadPlayerState()]);
  const catalogRelease = getCurrentCatalogRelease();
  if (!localCatalogPreview) {
    assertServerCatalogCompatibility(catalogRelease, player.serverCatalogVersion, playerBootstrapMode === "v1");
  }
  return { catalog, player, catalogRelease };
}

function normalizeRuntimeOpponent(raw: Record<string, unknown>): DungeonRunSnapshot["selectedOpponents"][number] {
  const rawCurrencyDrops = Array.isArray(raw.currencyDrops) ? raw.currencyDrops as RawDungeonCurrencyDrop[] : [];
  const rawItemDrops = Array.isArray(raw.itemDrops) ? raw.itemDrops as RawDungeonItemDrop[] : [];
  const rawOverrides = raw.overrides && typeof raw.overrides === "object"
    ? raw.overrides as Record<string, number>
    : {};
  return {
    ...raw,
    id: String(raw.id),
    dungeon_id: String(raw.dungeon_id),
    pool_type: raw.pool_type as DungeonOpponent["pool_type"],
    sequence_index: raw.sequence_index == null ? null : Number(raw.sequence_index),
    probability: raw.probability == null ? null : Number(raw.probability),
    critter_id: String(raw.critter_id),
    critter_level: Number(raw.critter_level),
    skill_ids: Array.isArray(raw.skills) ? raw.skills.map(String) : Array.isArray(raw.skill_ids) ? raw.skill_ids.map(String) : [],
    relic_ids: Array.isArray(raw.relics) ? raw.relics.map(String) : Array.isArray(raw.relic_ids) ? raw.relic_ids.map(String) : [],
    rollcaster_xp_reward: Number(raw.rollcaster_xp_reward ?? 0),
    critter_xp_reward: Number(raw.critter_xp_reward ?? 0),
    currency_reward: Number(raw.currency_reward ?? 0),
    drops: Array.isArray(raw.drops) ? raw.drops as Array<Record<string, unknown>> : [],
    currencyDrops: rawCurrencyDrops.map(normalizeDungeonDrop),
    itemDrops: rawItemDrops.map(normalizeDungeonDrop),
    overrides: {
      hp: rawOverrides.hp,
      atk: rawOverrides.atk,
      def: rawOverrides.def,
      spd: rawOverrides.spd,
      diceMin: rawOverrides.dice_min,
      diceMax: rawOverrides.dice_max,
      block: rawOverrides.block_cost,
      swap: rawOverrides.swap_cost,
      relicSlots: rawOverrides.relic_slots,
    },
    instanceId: String(raw.instanceId),
    battleIndex: Number(raw.battleIndex),
    battlefieldSlot: Number(raw.battlefieldSlot),
  } as DungeonRunSnapshot["selectedOpponents"][number];
}

function normalizeDungeonRunSnapshot(payload: DungeonRunSnapshot): DungeonRunSnapshot {
  return {
    ...payload,
    battleCount: Number(payload.battleCount),
    battleIndex: Number(payload.battleIndex),
    randomCursor: Number(payload.randomCursor),
    version: Number(payload.version),
    selectedOpponents: (payload.selectedOpponents ?? [])
      .map((opponent) => normalizeRuntimeOpponent(opponent as unknown as Record<string, unknown>)),
    selectedEnemyEncounters: payload.selectedEnemyEncounters ?? [],
    rewards: {
      entries: payload.rewards?.entries ?? [],
      defeatedOpponentInstanceIds: payload.rewards?.defeatedOpponentInstanceIds ?? [],
      critterXp: payload.rewards?.critterXp ?? {},
      rollcasterXp: Number(payload.rewards?.rollcasterXp ?? 0),
      completionPhase: payload.rewards?.completionPhase,
    },
  };
}

export async function startDungeonRun(
  dungeonId: string,
  requestId = createRequestId(),
): Promise<DungeonRunSnapshot> {
  const client = requireClient();
  let { data, error } = await client.rpc("start_dungeon_run_v3", {
    p_dungeon_id: dungeonId,
    p_request_id: requestId,
  });
  const v3Unavailable = error && (
    error.code === "42883"
    || error.message.includes("DUNGEON_ROLLCASTERS_MISSING")
    || error.message.includes("DUNGEON_ENCOUNTERS_MISSING")
  );
  if (v3Unavailable) {
    const legacy = await client.rpc("start_dungeon_run_v2", {
      p_dungeon_id: dungeonId,
      p_request_id: requestId,
    });
    data = legacy.data;
    error = legacy.error;
  }
  if (error) throw error;
  const run = normalizeDungeonRunSnapshot(data as DungeonRunSnapshot);
  if (!run.id || run.selectedOpponents.length === 0) {
    throw new Error("The Dungeon run has no selected opponents.");
  }
  return run;
}

type DungeonEntryAttempt = {
  phase: "starting" | "recovering" | "confirming";
  attempt: number;
  maxAttempts: number;
};

function dungeonEntryErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error ?? "");
}

function isRetryableDungeonEntryError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
  const text = dungeonEntryErrorText(error).toLowerCase();
  return code === "408"
    || code === "429"
    || code === "57014"
    || code.startsWith("5")
    || text.includes("timeout")
    || text.includes("timed out")
    || text.includes("network")
    || text.includes("fetch")
    || text.includes("failed to fetch")
    || text.includes("connection reset")
    || text.includes("connection closed");
}

function dungeonEntryDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function withDungeonEntryTimeout<T>(operation: Promise<T>, step: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`DUNGEON_ENTRY_TIMEOUT:${step}`)), 12_000);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

export function flushPlayerMutationsWithTimeout(): Promise<void> {
  return withDungeonEntryTimeout(flushPlayerMutations(), "flush");
}

async function activeDungeonRunForRecovery(): Promise<ActiveDungeonRun | null> {
  try {
    return await withDungeonEntryTimeout(getActiveDungeonRun(), "resume");
  } catch {
    // A recovery read is best effort. The original typed or timeout error is
    // more useful than replacing it with a second network failure.
    return null;
  }
}

export async function startDungeonRunWithRecovery(
  dungeonId: string,
  requestId = createRequestId(),
  onAttempt?: (attempt: DungeonEntryAttempt & { requestId: string }) => void,
): Promise<DungeonRunSnapshot> {
  const maxAttempts = 3;
  let lastError: unknown = new Error("Dungeon entry failed.");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const phase = attempt === 1 ? "starting" : "recovering";
    onAttempt?.({ phase, attempt, maxAttempts, requestId });
    if (attempt > 1) await dungeonEntryDelay(250 * 2 ** (attempt - 2));
    try {
      return await withDungeonEntryTimeout(startDungeonRun(dungeonId, requestId), "start");
    } catch (error) {
      lastError = error;
      const active = await activeDungeonRunForRecovery();
      if (active?.run.dungeonId === dungeonId) return active.run;
      if (!isRetryableDungeonEntryError(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

export async function recordDungeonBattleResult(
  run: DungeonRunSnapshot,
  submission: {
    outcome: "won" | "lost";
    defeatedOpponentInstanceIds: string[];
    participantUserCritterIds: string[];
    squadHp: Record<string, number>;
  },
  requestId = createRequestId(),
): Promise<DungeonBattleResult> {
  const { data, error } = await requireClient().rpc("record_dungeon_battle_result_v2", {
    p_run_id: run.id,
    p_expected_battle_index: run.battleIndex,
    p_outcome: submission.outcome,
    p_defeated_instance_ids: submission.defeatedOpponentInstanceIds,
    p_participant_user_critter_ids: submission.participantUserCritterIds,
    p_squad_hp: submission.squadHp,
    p_request_id: requestId,
  });
  if (error) throw error;
  const result = data as DungeonBattleResult;
  return {
    ...result,
    run: normalizeDungeonRunSnapshot(result.run),
  };
}

type DungeonResultAttempt = {
  attempt: number;
  maxAttempts: number;
};

export async function recordDungeonBattleResultWithRecovery(
  run: DungeonRunSnapshot,
  submission: Parameters<typeof recordDungeonBattleResult>[1],
  requestId = createRequestId(),
  onAttempt?: (attempt: DungeonResultAttempt) => void,
): Promise<DungeonBattleResult> {
  const maxAttempts = 3;
  let lastError: unknown = new Error("Encounter result could not be saved.");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt?.({ attempt, maxAttempts });
    if (attempt > 1) await dungeonEntryDelay(400 * 2 ** (attempt - 2));
    try {
      // Keep the request ID stable. If the server committed before a timeout
      // or lost response, the retry returns the original result instead of
      // applying rewards twice.
      return await withDungeonEntryTimeout(
        recordDungeonBattleResult(run, submission, requestId),
        "result",
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableDungeonEntryError(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}

export async function getActiveDungeonRun(): Promise<ActiveDungeonRun | null> {
  const { data, error } = await requireClient().rpc("get_active_dungeon_run_v2");
  if (error) throw error;
  if (!data) return null;
  const active = data as ActiveDungeonRun;
  return {
    ...active,
    run: normalizeDungeonRunSnapshot(active.run),
  };
}

export function getActiveDungeonRunWithTimeout(): Promise<ActiveDungeonRun | null> {
  return withDungeonEntryTimeout(getActiveDungeonRun(), "resume");
}

export async function saveDungeonRunState(
  run: DungeonRunSnapshot,
  combatState: Record<string, unknown>,
  requestId = createRequestId(),
): Promise<{ run: DungeonRunSnapshot; combatState: unknown }> {
  const { data, error } = await requireClient().rpc("save_dungeon_run_state", {
    p_run_id: run.id,
    p_expected_version: run.version,
    p_state: combatState,
    p_request_id: requestId,
  });
  if (error) throw error;
  const response = data as { run: DungeonRunSnapshot; combatState: unknown };
  return {
    ...response,
    run: normalizeDungeonRunSnapshot(response.run),
  };
}

export function saveDungeonRunStateWithTimeout(
  run: DungeonRunSnapshot,
  combatState: Record<string, unknown>,
  requestId = createRequestId(),
): Promise<{ run: DungeonRunSnapshot; combatState: unknown }> {
  return withDungeonEntryTimeout(saveDungeonRunState(run, combatState, requestId), "save");
}

export async function snapshotDungeonRunEffects(runId: string, snapshot: unknown): Promise<void> {
  const { error } = await requireClient().rpc("snapshot_dungeon_run_effects", { p_run_id: runId, p_snapshot: snapshot });
  if (error) throw error;
}

export async function snapshotDungeonRunEffectsWithRecovery(
  runId: string,
  snapshot: unknown,
  onAttempt?: (attempt: DungeonEntryAttempt) => void,
): Promise<unknown> {
  const maxAttempts = 3;
  let lastError: unknown = new Error("Dungeon effect snapshot failed.");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt?.({ phase: attempt === 1 ? "confirming" : "recovering", attempt, maxAttempts });
    if (attempt > 1) await dungeonEntryDelay(250 * 2 ** (attempt - 2));
    try {
      await withDungeonEntryTimeout(snapshotDungeonRunEffects(runId, snapshot), "effects");
      return snapshot;
    } catch (error) {
      lastError = error;
      const active = await activeDungeonRunForRecovery();
      if (active?.run.id === runId && active.effectSnapshot != null) {
        // A previous request may have committed a different client snapshot
        // before its response was lost. The server snapshot is authoritative;
        // adopting it keeps the run resumable without overwriting it.
        return active.effectSnapshot;
      }
      if (!isRetryableDungeonEntryError(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function resolveDungeonRun(runId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("resolve_dungeon_run", { p_run_id: runId });
  if (error) throw error;
}

export function resolveDungeonRunWithTimeout(runId: string): Promise<void> {
  return withDungeonEntryTimeout(resolveDungeonRun(runId), "abandon");
}

export async function trackCollectibleChallenge(challengeId: string): Promise<void> {
  if (localCatalogPreview) {
    const catalog = await loadCatalog();
    const challenge = catalog.collectibleUnlockChallenges.find((row) => row.id === challengeId);
    if (!challenge || !isTrackableChallenge(challenge, catalog.unlockChallengeTemplates)) {
      throw new Error("LOCAL_PREVIEW_CHALLENGE_NOT_TRACKABLE");
    }
    writeLocalChallengeState(trackLocalChallenge(readLocalChallengeState(), challenge));
    return;
  }
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("track_collectible_challenge_v2", { p_challenge_id: challengeId });
    return;
  }
  const { error } = await enqueuePlayerMutation(`rpc:track_collectible_challenge:${challengeId}`, async () => requireClient().rpc("track_collectible_challenge", { p_challenge_id: challengeId }));
  if (error) throw error;
}

export async function untrackCollectibleChallenge(challengeId: string): Promise<void> {
  if (localCatalogPreview) {
    writeLocalChallengeState(untrackLocalChallenge(readLocalChallengeState(), challengeId));
    return;
  }
  if (activeGameplaySessionId && latestPlayerStateRevision !== null) {
    await callVersionedPlayerMutationRpc("untrack_collectible_challenge_v2", { p_challenge_id: challengeId });
    return;
  }
  const { error } = await enqueuePlayerMutation(`rpc:untrack_collectible_challenge:${challengeId}`, async () => requireClient().rpc("untrack_collectible_challenge", { p_challenge_id: challengeId }));
  if (error) throw error;
}

export async function acknowledgeCollectibleUnlockEvent(eventId: string): Promise<void> {
  const { error } = await requireClient().rpc("acknowledge_collectible_unlock_event", { p_event_id: eventId });
  if (error) throw error;
}

async function getShopPurchaseReceipt(requestId: string): Promise<ShopPurchaseReceipt | null> {
  const { data, error } = await requireClient().rpc("get_shop_purchase_receipt", { p_request_id: requestId });
  if (error) throw error;
  return data ? data as ShopPurchaseReceipt : null;
}

function waitForShopPurchaseConfirmation(delayMs: number): Promise<void> {
  return delayMs > 0 ? new Promise((resolve) => window.setTimeout(resolve, delayMs)) : Promise.resolve();
}

async function recoverAmbiguousShopPurchase(
  entryId: string,
  requestId: string,
  quantity: number,
  firstError: unknown,
): Promise<ShopPurchaseReceipt> {
  const client = requireClient();
  // The first lookup is immediate. If the transaction is still in flight, one
  // replay with the same idempotency key is safe; later passes only look up the
  // exact receipt. The full window stays bounded so the UI can honestly move
  // into a durable pending state instead of claiming failure.
  const confirmationDelays = [0, 250, 750, 1500, 2500, 3500, 750];
  let lastError: unknown = firstError;
  for (let index = 0; index < confirmationDelays.length; index += 1) {
    await waitForShopPurchaseConfirmation(confirmationDelays[index]);
    if (index === 1) {
      const retried = await client.rpc("purchase_shop_entry", {
        p_entry_id: entryId,
        p_request_id: requestId,
        p_quantity: quantity,
      });
      if (!retried.error) return retried.data as ShopPurchaseReceipt;
      lastError = retried.error;
      if (!isAmbiguousShopPurchaseError(retried.error)) {
        try {
          const recovered = await getShopPurchaseReceipt(requestId);
          if (recovered) return recovered;
        } catch (receiptError) {
          lastError = receiptError;
        }
        throw retried.error;
      }
    }
    try {
      const receipt = await getShopPurchaseReceipt(requestId);
      if (receipt) return receipt;
    } catch (receiptError) {
      lastError = receiptError;
    }
  }
  const pending = pendingShopPurchaseError(requestId);
  Object.assign(pending, { cause: lastError });
  throw pending;
}

export async function purchaseShopEntry(entryId: string, requestId: string, quantity = 1): Promise<ShopPurchaseReceipt> {
  const client = requireClient();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) {
    throw new Error("Shop purchase quantity must be a positive integer between 1 and 9999.");
  }
  const { data, error } = await client.rpc("purchase_shop_entry", {
    p_entry_id: entryId,
    p_request_id: requestId,
    p_quantity: quantity,
  });
  const errorDisposition = shopPurchaseRpcErrorDisposition(error, quantity);
  if (error && isAmbiguousShopPurchaseError(error)) {
    return recoverAmbiguousShopPurchase(entryId, requestId, quantity, error);
  }
  if (errorDisposition === "throw") throw error;
  if (errorDisposition === "legacy") {
    const purchaseLegacyUnit = async (unitRequestId: string): Promise<ShopPurchaseReceipt> => {
      const legacy = await client.rpc("purchase_shop_entry", {
        p_entry_id: entryId,
        p_request_id: unitRequestId,
      });
      if (legacy.error) throw legacy.error;
      return legacy.data as ShopPurchaseReceipt;
    };
    if (quantity === 1) return purchaseLegacyUnit(requestId);

    const receipts: ShopPurchaseReceipt[] = [];
    for (let index = 0; index < quantity; index += 1) {
      try {
        receipts.push(await purchaseLegacyUnit(indexedShopPurchaseRequestId(requestId, index)));
      } catch (legacyError) {
        if (receipts.length === 0) throw legacyError;
        const partialError = legacyError instanceof Error ? legacyError : new Error(String(legacyError));
        Object.assign(partialError, { partialReceipt: aggregateShopPurchaseReceipts(receipts, requestId) });
        throw partialError;
      }
    }
    return aggregateShopPurchaseReceipts(receipts, requestId);
  }
  return data as ShopPurchaseReceipt;
}

export async function purchaseShopEntries(purchases: ShopPurchaseIntent[]): Promise<ShopPurchaseReceipt[]> {
  if (purchases.length === 0) return [];
  if (purchases.length > 512) throw new Error("A Shop session cannot contain more than 512 purchase lines.");
  // A single bulk purchase does not need the session wrapper. Going straight
  // to the idempotent quantity RPC keeps Open Now compatible with deployments
  // that have the original Shop function but not purchase_shop_entries yet.
  if (purchases.length === 1) {
    const [purchase] = purchases;
    return [await purchaseShopEntry(purchase.entry_id, purchase.request_id, purchase.quantity)];
  }
  const client = requireClient();
  const { data, error } = await client.rpc("purchase_shop_entries", {
    p_purchases: purchases,
  });
  const errorDisposition = shopPurchaseRpcErrorDisposition(error, 1);
  if (errorDisposition === "throw") throw error;
  if (errorDisposition === "legacy") {
    // Older deployments do not have the session-batch RPC yet. Reuse the
    // idempotent quantity entry point so a bulk Lootbox purchase can still be
    // flushed before Open Now calls the opening RPC. The request IDs remain
    // stable across retries, so a committed purchase is never charged twice.
    const receipts: ShopPurchaseReceipt[] = [];
    for (const purchase of purchases) {
      try {
        receipts.push(await purchaseShopEntry(purchase.entry_id, purchase.request_id, purchase.quantity));
      } catch (legacyError) {
        if (receipts.length === 0) throw legacyError;
        const partialError = legacyError instanceof Error ? legacyError : new Error(String(legacyError));
        Object.assign(partialError, { partialReceipts: receipts });
        throw partialError;
      }
    }
    return receipts;
  }
  const receipts = data && typeof data === "object" && "receipts" in data
    ? (data as { receipts?: unknown }).receipts
    : null;
  if (!Array.isArray(receipts)) throw new Error("The Shop sync returned an invalid receipt list.");
  return receipts as ShopPurchaseReceipt[];
}

export async function openLootbox(lootboxId: string, requestId: string): Promise<LootboxOpeningReceipt> {
  return recoverLootboxOpening(async (requestedLootboxId, requestedRequestId) => {
    const { data, error } = await requireClient().rpc("open_lootbox", {
      p_lootbox_id: requestedLootboxId,
      p_request_id: requestedRequestId,
    });
    if (error) throw error;
    return data as LootboxOpeningReceipt;
  }, lootboxId, requestId);
}

function normalizePromoCodeReward(value: unknown): PromoCodeReward {
  const reward = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    type: reward.type as PromoCodeReward["type"],
    targetCategory: typeof reward.targetCategory === "string"
      ? reward.targetCategory as PromoCodeReward["targetCategory"]
      : null,
    targetId: String(reward.targetId ?? ""),
    name: String(reward.name ?? reward.targetId ?? "Reward"),
    assetPath: typeof reward.assetPath === "string" && reward.assetPath ? reward.assetPath : null,
    quantity: String(reward.quantity ?? 0),
    configuredQuantity: String(reward.configuredQuantity ?? 0),
    discardedQuantity: String(reward.discardedQuantity ?? 0),
    didUnlock: reward.didUnlock === true,
  };
}

function normalizePromoCodeRedemption(value: unknown): PromoCodeRedemption {
  const redemption = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalizedCount = (count: unknown) => (
    typeof count === "string" || typeof count === "number" ? String(count) : null
  );
  return {
    redemptionId: String(redemption.redemptionId ?? ""),
    code: String(redemption.code ?? ""),
    redeemedAt: String(redemption.redeemedAt ?? ""),
    playerUses: normalizedCount(redemption.playerUses),
    playerUsesRemaining: normalizedCount(redemption.playerUsesRemaining),
    globalUsesRemaining: normalizedCount(redemption.globalUsesRemaining),
    rewards: Array.isArray(redemption.rewards)
      ? redemption.rewards.map(normalizePromoCodeReward)
      : [],
  };
}

export async function redeemPromoCode(code: string): Promise<PromoCodeRedemption> {
  const client = requireClient();
  let data: unknown;
  let error: { message: string } | null;
  if (desktopProfile.profile === "local") {
    const definition = await requirePromoDefinitionClient().rpc("get_promo_code_definition", {
      p_code: code.trim(),
    });
    if (definition.error) throw definition.error;
    if (!definition.data) throw new Error("PROMO_CODE_INVALID_OR_INACTIVE");
    const localRedemption = await client.rpc("redeem_promo_code_from_definition", {
      p_definition: definition.data,
    });
    data = localRedemption.data;
    error = localRedemption.error;
  } else {
    const redemption = await client.rpc("redeem_promo_code", {
      p_code: code.trim(),
    });
    data = redemption.data;
    error = redemption.error;
  }
  if (error) throw error;
  return normalizePromoCodeRedemption(data);
}

export async function getPromoCodeRedemptionHistory(): Promise<PromoCodeRedemption[]> {
  const { data, error } = await requireClient().rpc("promo_code_redemption_history");
  if (error) throw error;
  return Array.isArray(data) ? data.map(normalizePromoCodeRedemption) : [];
}

export async function submitCollectibleCombatEvents(
  runId: string,
  turnNumber: number,
  events: CombatProgressEvent[],
): Promise<CollectiblePlayerSnapshot> {
  if (events.length === 0) return getCollectiblePlayerSnapshot();
  if (localCatalogPreview) {
    const [catalog, serverSnapshot] = await Promise.all([
      loadCatalog(),
      getServerCollectiblePlayerSnapshot(),
    ]);
    const nextState = applyLocalChallengeEvents(
      readLocalChallengeState(),
      catalog.collectibleUnlockChallenges,
      events,
      catalog.dungeons,
    );
    writeLocalChallengeState(nextState);
    return mergeLocalChallengeSnapshot(serverSnapshot, nextState);
  }
  const { data, error } = await requireClient().rpc("submit_collectible_combat_events", {
    p_run_id: runId,
    p_turn_number: turnNumber,
    p_events: events,
  });
  if (error) throw error;
  return { ...emptyCollectibleSnapshot(), ...(data as Partial<CollectiblePlayerSnapshot> | null) };
}
