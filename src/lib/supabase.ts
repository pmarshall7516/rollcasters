import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { assertServerCatalogCompatibility, loadPublishedCatalog } from "./catalog-release";
import { groupCombatEffectRows } from "./effects";
import type {
  AppData,
  Catalog,
  CatalogReleaseInfo,
  ContentTag,
  CollectiblePlayerSnapshot,
  CombatEffectRow,
  CombatProgressEvent,
  Critter,
  DungeonCompletionDrop,
  DungeonBossEncounter,
  DungeonBattleResult,
  DungeonEnemyRollcaster,
  ActiveDungeonRun,
  DungeonDrop,
  DungeonOpponent,
  DungeonOpponentStatOverride,
  DungeonRegularEncounter,
  DungeonRunHistoryEntry,
  DungeonRunSnapshot,
  ElementDef,
  ElementEffectiveness,
  GameAsset,
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
import { parseBattleFormat, sortDungeonsNaturally } from "./dungeons";
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

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
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
// A player build is release-backed unless development explicitly opts into the
// live authoring catalog. This prevents an omitted env var from weakening the
// immutable-release boundary.
const gameCatalogMode = (import.meta.env.VITE_GAME_CATALOG_MODE as string | undefined) === "live" ? "live" : "release";
const playerBootstrapMode = (import.meta.env.VITE_GAME_PLAYER_BOOTSTRAP_MODE as string | undefined) === "v1" ? "v1" : "legacy";
const allowLegacyPlayerBootstrap = import.meta.env.VITE_ALLOW_LEGACY_PLAYER_BOOTSTRAP === "true";
// Both release-backed and explicitly local live-catalog development runs must
// provide their own asset base. There is intentionally no mutable remote
// fallback for artwork.
let activeGameAssetBaseUrl = configuredGameAssetBaseUrl;
const liveAssetVersions = new Map<string, string>();
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

const LIVE_CATALOG_COLUMNS: Record<string, string> = {
  elements: "id,name,description,asset_path,sort_order",
  content_tags: "id,name,description,tag_type,sort_order,is_active,is_archived,version",
  critter_tag_assignments: "critter_id,tag_id",
  skill_tag_assignments: "skill_id,tag_id",
  element_effectiveness: "attacking_element_id,defending_element_id,multiplier",
  skills: "id,name,element_id,skill_type,power,mana_cost,targeting,description,sort_order,priority",
  critters: "id,name,element_1_id,element_2_id,base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,base_block_cost,base_swap_cost,asset_path,description,sort_order,is_active,is_archived",
  critter_level_progression: "critter_id,level,total_required_xp,grant_skill_points,hp_delta,atk_delta,def_delta,spd_delta,dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,total_unlocked_relic_slots",
  critter_skill_unlocks: "critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order",
  rollcasters: "id,name,asset_path,description,sort_order,is_active,is_archived",
  rollcaster_level_progression: "rollcaster_id,level,total_required_xp,grant_ability_points,total_unlocked_ability_slots",
  rollcaster_abilities: "id,name,description,sort_order",
  rollcaster_ability_unlocks: "rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order",
  relics: "id,name,description,max_owned,asset_path,sort_order,is_active,is_archived",
  dungeons: "id,name,description,dungeon_type,difficulty,battle_format,battle_count,player_active_count,opponent_active_count,encounter_count,next_dungeon_id,regular_logo_path,boss_logo_path,sort_order,is_active,is_archived,version",
  dungeon_opponents: "id,dungeon_id,pool_type,sequence_index,probability,critter_id,critter_level,skill_ids,relic_ids,rollcaster_xp_reward,critter_xp_reward,currency_reward,drops",
  dungeon_enemy_rollcasters: "id,dungeon_id,sequence_index,name,eclipse_order_type,asset_path,selection_weight,policy_key,policy_revision,policy_artifact_id",
  dungeon_enemy_rollcaster_abilities: "enemy_rollcaster_id,rollcaster_ability_id,slot_index",
  dungeon_enemy_rollcaster_dialogue: "id,enemy_rollcaster_id,moment,line_text,sequence_index",
  dungeon_enemy_rollcaster_currency_drops: "id,enemy_rollcaster_id,currency_id,min_amount,max_amount,probability,sort_order",
  dungeon_enemy_rollcaster_item_drops: "id,enemy_rollcaster_id,drop_type,target_category,target_id,min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order",
  dungeon_regular_encounters: "id,dungeon_id,sequence_index,enemy_squad_size",
  dungeon_boss_encounters: "id,dungeon_id,sequence_index,enemy_rollcaster_id",
  dungeon_opponent_skills: "opponent_id,skill_id,slot_index",
  dungeon_opponent_relics: "opponent_id,relic_id,slot_index",
  dungeon_opponent_stat_overrides: "opponent_id,stat_key,value",
  dungeon_opponent_currency_drops: "id,opponent_id,currency_id,min_amount,max_amount,probability,sort_order",
  dungeon_opponent_item_drops: "id,opponent_id,drop_type,target_category,target_id,min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order",
  dungeon_completion_drops: "id,dungeon_id,completion_phase,drop_type,target_category,target_id,min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order",
  starter_rollcaster_options: "rollcaster_id,sort_order,is_active",
  starter_options: "critter_id,sort_order,is_active",
  game_assets: "id,path,category,owner_table,owner_id,variant,display_name,alt_text,content_type,width,height,checksum,metadata,is_active,sort_order,updated_at",
  statuses: "id,name,description,classification,asset_path,sort_order,is_active,is_archived,version",
};

async function selectAll<T>(table: string, order = "sort_order"): Promise<T[]> {
  const client = requireClient();
  const columns = LIVE_CATALOG_COLUMNS[table];
  if (!columns) throw new Error(`No explicit public catalog projection is defined for ${table}.`);
  const { data, error } = await client.from(table).select(columns).order(order, { ascending: true });
  if (error) throw error;
  return (data ?? []) as T[];
}

async function selectAllOptional<T>(table: string, order = "sort_order"): Promise<T[]> {
  try {
    return await selectAll<T>(table, order);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "42P01" || code === "PGRST205") return [];
    throw error;
  }
}

function normalizeCritter(row: Record<string, unknown>): Critter {
  const element1Id = typeof row.element_1_id === "string"
    ? row.element_1_id
    : typeof row.element_id === "string"
      ? row.element_id
      : "";
  if (!element1Id) {
    throw new Error(`Critter ${String(row.id ?? "(unknown)")} is missing Element 1.`);
  }
  const element2Id = typeof row.element_2_id === "string" && row.element_2_id
    ? row.element_2_id
    : null;
  if (element2Id === element1Id) {
    throw new Error(`Critter ${String(row.id ?? "(unknown)")} repeats Element 1 in Element 2.`);
  }
  const { element_id: _deprecatedElementId, ...canonicalRow } = row;
  return {
    ...canonicalRow,
    element_1_id: element1Id,
    element_2_id: element2Id,
  } as Critter;
}

function emptyCollectibleSnapshot(): CollectiblePlayerSnapshot {
  return { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] };
}

type RawDungeonOpponentSkill = { opponent_id: string; skill_id: string; slot_index: number };
type RawDungeonOpponentRelic = { opponent_id: string; relic_id: string; slot_index: number };
type RawDungeonCurrencyDrop = {
  id: string;
  opponent_id: string;
  currency_id: string;
  min_amount: number;
  max_amount: number;
  probability: number | string;
  sort_order: number;
};
type RawDungeonItemDrop = {
  id: string;
  opponent_id: string;
  drop_type: "shard" | "relic" | "lootbox";
  target_category: "critter" | "rollcaster" | "relic";
  target_id: string;
  min_amount: number;
  max_amount: number;
  probability: number | string;
  dupe_currency_id: string;
  dupe_currency_amount: number;
  sort_order: number;
};
type RawDungeonCompletionDrop = Omit<RawDungeonItemDrop, "opponent_id"> & {
  dungeon_id: string;
  completion_phase: "first_time" | "regular";
  drop_type: "currency" | "shard" | "relic";
  target_category: "critter" | "rollcaster" | "relic" | null;
  dupe_currency_id: string | null;
  dupe_currency_amount: number | null;
};

function normalizeDungeonDrop(
  row: RawDungeonCurrencyDrop | RawDungeonItemDrop,
): DungeonDrop {
  if ("currency_id" in row) {
    return {
      id: row.id,
      kind: "currency",
      targetId: row.currency_id,
      minAmount: row.min_amount,
      maxAmount: row.max_amount,
      probability: Number(row.probability),
    };
  }
  return {
    id: row.id,
    kind: row.drop_type,
    targetCategory: row.target_category,
    targetId: row.target_id,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    probability: Number(row.probability),
    dupeCurrencyId: row.dupe_currency_id,
    dupeCurrencyAmount: row.dupe_currency_amount,
  };
}

function normalizeCompletionDrop(row: RawDungeonCompletionDrop): DungeonCompletionDrop {
  return {
    id: `${row.dungeon_id}:${row.id}`,
    phase: row.completion_phase,
    kind: row.drop_type,
    targetCategory: row.target_category ?? undefined,
    targetId: row.target_id,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    probability: Number(row.probability),
    dupeCurrencyId: row.dupe_currency_id ?? undefined,
    dupeCurrencyAmount: row.dupe_currency_amount ?? undefined,
  };
}

type CollectibleShopCatalog = Pick<Catalog,
  "currencies" | "collectibleUnlockRequirements" | "collectibleUnlockChallenges" | "shopEntries" | "lootboxes" | "lootboxPoolEntries" | "unlockChallengeTemplates"
>;

async function loadCollectibleShopCatalog(): Promise<CollectibleShopCatalog> {
  const { data, error } = await requireClient().rpc("get_collectible_shop_catalog");
  if (error) throw error;
  const payload = data as {
    currencies?: Catalog["currencies"];
    requirements?: Catalog["collectibleUnlockRequirements"];
    challenges?: Catalog["collectibleUnlockChallenges"];
    shop_entries?: Catalog["shopEntries"];
    lootboxes?: Catalog["lootboxes"];
    lootbox_pool_entries?: Catalog["lootboxPoolEntries"];
    challenge_templates?: Catalog["unlockChallengeTemplates"];
  } | null;
  return {
    currencies: payload?.currencies ?? [],
    collectibleUnlockRequirements: payload?.requirements ?? [],
    collectibleUnlockChallenges: payload?.challenges ?? [],
    shopEntries: payload?.shop_entries ?? [],
    lootboxes: (payload?.lootboxes ?? []).map((lootbox) => ({ ...lootbox, sell_value: String(lootbox.sell_value) })),
    lootboxPoolEntries: (payload?.lootbox_pool_entries ?? []).map((entry) => ({
      ...entry,
      probability: Number(entry.probability),
      dupe_currency_amount: entry.dupe_currency_amount == null ? null : String(entry.dupe_currency_amount),
    })),
    unlockChallengeTemplates: payload?.challenge_templates ?? [],
  };
}

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

async function loadCombatEffects(): Promise<CombatEffectRow[]> {
  const { data, error } = await requireClient()
    .from("combat_effects_v1")
    .select("owner_type,owner_id,id,name,description,sort_order,template_id,runtime_kind,runtime_version,parameters,classification,execution")
    .order("owner_type", { ascending: true })
    .order("owner_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CombatEffectRow[];
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
  const version = gameCatalogMode === "live" ? liveAssetVersions.get(normalizedPath) : undefined;
  if (!query && !version) return publicUrl;
  // Local exact-catalog previews use Vite's relative `/@fs/...` asset root.
  // `URL` needs an absolute base when a cache-busting query is present.
  const url = new URL(publicUrl, typeof window === "undefined" ? undefined : window.location.href);
  if (query) url.search = query;
  if (version && !url.searchParams.has("v")) url.searchParams.set("v", version);
  return url.toString();
}

// Promo redemption artwork retains an immutable source catalog path. This
// resolver is the fallback when that reward no longer has an optimized variant
// in the current release registry.
export function getSnapshotGameAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  return getGameAssetUrl(assetPath);
}

function groupBy<T>(rows: readonly T[], keyFor: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

let catalogPromise: Promise<Catalog> | null = null;
let currentCatalogRelease: CatalogReleaseInfo | undefined;

async function fetchLiveCatalog(): Promise<Catalog> {
  const [
    collectibleShopCatalog,
    elements,
    tags,
    critterTagAssignments,
    skillTagAssignments,
    elementEffectiveness,
    skills,
    rawCritters,
    critterProgression,
    critterSkillUnlocks,
    rollcasters,
    rollcasterProgression,
    rollcasterAbilities,
    rollcasterAbilityUnlocks,
    relics,
    dungeons,
    rawDungeonOpponents,
    rawEnemyRollcasters,
    enemyRollcasterAbilities,
    enemyRollcasterDialogue,
    enemyRollcasterCurrencyDrops,
    enemyRollcasterItemDrops,
    dungeonRegularEncounters,
    dungeonBossEncounters,
    dungeonOpponentSkills,
    dungeonOpponentRelics,
    dungeonOpponentStatOverrides,
    dungeonOpponentCurrencyDrops,
    dungeonOpponentItemDrops,
    rawDungeonCompletionDrops,
    starterRollcasterOptions,
    starterOptions,
    gameAssets,
    statuses,
    combatEffects,
  ] = await Promise.all([
    loadCollectibleShopCatalog(),
    selectAll("elements"),
    selectAll<ContentTag>("content_tags"),
    selectAll<{ critter_id: string; tag_id: string }>("critter_tag_assignments", "critter_id"),
    selectAll<{ skill_id: string; tag_id: string }>("skill_tag_assignments", "skill_id"),
    selectAll<ElementEffectiveness>("element_effectiveness", "attacking_element_id"),
    selectAll("skills"),
    selectAll<Record<string, unknown>>("critters"),
    selectAll("critter_level_progression", "level"),
    selectAll("critter_skill_unlocks"),
    selectAll("rollcasters"),
    selectAll("rollcaster_level_progression", "level"),
    selectAll("rollcaster_abilities"),
    selectAll("rollcaster_ability_unlocks"),
    selectAll("relics"),
    selectAll("dungeons"),
    selectAll<DungeonOpponent>("dungeon_opponents", "sequence_index"),
    selectAllOptional<Record<string, unknown>>("dungeon_enemy_rollcasters", "sequence_index"),
    selectAllOptional<Record<string, unknown>>("dungeon_enemy_rollcaster_abilities", "slot_index"),
    selectAllOptional<Record<string, unknown>>("dungeon_enemy_rollcaster_dialogue", "sequence_index"),
    selectAllOptional<Record<string, unknown>>("dungeon_enemy_rollcaster_currency_drops", "sort_order"),
    selectAllOptional<Record<string, unknown>>("dungeon_enemy_rollcaster_item_drops", "sort_order"),
    selectAllOptional<DungeonRegularEncounter>("dungeon_regular_encounters", "sequence_index"),
    selectAllOptional<DungeonBossEncounter>("dungeon_boss_encounters", "sequence_index"),
    selectAll<RawDungeonOpponentSkill>("dungeon_opponent_skills", "slot_index"),
    selectAll<RawDungeonOpponentRelic>("dungeon_opponent_relics", "slot_index"),
    selectAllOptional<DungeonOpponentStatOverride>("dungeon_opponent_stat_overrides", "stat_key"),
    selectAll<RawDungeonCurrencyDrop>("dungeon_opponent_currency_drops"),
    selectAll<RawDungeonItemDrop>("dungeon_opponent_item_drops"),
    selectAll<RawDungeonCompletionDrop>("dungeon_completion_drops"),
    selectAll("starter_rollcaster_options"),
    selectAll("starter_options"),
    selectAllOptional("game_assets"),
    selectAll("statuses"),
    loadCombatEffects(),
  ]);

  liveAssetVersions.clear();
  for (const asset of gameAssets as GameAsset[]) {
    const updatedAt = asset.metadata?.sourceUpdatedAt?.trim() || asset.updated_at?.trim() || "";
    const byteSize = asset.metadata?.byteSize;
    const size = typeof byteSize === "number" && Number.isFinite(byteSize) ? String(byteSize) : "";
    if (updatedAt || size) liveAssetVersions.set(asset.path.replace(/^\/+/, ""), `${updatedAt}:${size}`);
  }

  const groupedEffects = groupCombatEffectRows(combatEffects);
  const critterTags = groupBy(critterTagAssignments, (row) => row.critter_id);
  const skillTags = groupBy(skillTagAssignments, (row) => row.skill_id);
  const critters = rawCritters.map((row) => ({ ...normalizeCritter(row), tag_ids: (critterTags.get(String(row.id)) ?? []).map((item) => String(item.tag_id)) }));
  const normalizedSkills = (skills as Array<Record<string, unknown>>).map((skill) => ({ ...skill, priority: Number(skill.priority ?? 0), tag_ids: (skillTags.get(String(skill.id)) ?? []).map((item) => String(item.tag_id)) }));
  const skillsByOpponent = groupBy(dungeonOpponentSkills, (row) => row.opponent_id);
  const relicsByOpponent = groupBy(dungeonOpponentRelics, (row) => row.opponent_id);
  const overridesByOpponent = groupBy(dungeonOpponentStatOverrides, (row) => row.opponent_id);
  const currencyDropsByOpponent = groupBy(dungeonOpponentCurrencyDrops, (row) => row.opponent_id);
  const itemDropsByOpponent = groupBy(dungeonOpponentItemDrops, (row) => row.opponent_id);
  const abilitiesByEnemyRollcaster = groupBy(enemyRollcasterAbilities, (row) => String(row.enemy_rollcaster_id));
  const dialogueByEnemyRollcaster = groupBy(enemyRollcasterDialogue, (row) => String(row.enemy_rollcaster_id));
  const currencyByEnemyRollcaster = groupBy(enemyRollcasterCurrencyDrops, (row) => String(row.enemy_rollcaster_id));
  const itemsByEnemyRollcaster = groupBy(enemyRollcasterItemDrops, (row) => String(row.enemy_rollcaster_id));
  const dungeonEnemyRollcasters: DungeonEnemyRollcaster[] = rawEnemyRollcasters.map((row) => ({
    id: String(row.id),
    dungeon_id: String(row.dungeon_id),
    sequence_index: Number(row.sequence_index),
    name: String(row.name),
    eclipse_order_type: String(row.eclipse_order_type) as DungeonEnemyRollcaster["eclipse_order_type"],
    asset_path: String(row.asset_path),
    selection_weight: Number(row.selection_weight),
    policy_key: String(row.policy_key) as DungeonEnemyRollcaster["policy_key"],
    policy_revision: Number(row.policy_revision ?? 1),
    policy_artifact_id: row.policy_artifact_id ? String(row.policy_artifact_id) : null,
    ability_ids: (abilitiesByEnemyRollcaster.get(String(row.id)) ?? []).sort((a, b) => Number(a.slot_index) - Number(b.slot_index)).map((item) => String(item.rollcaster_ability_id)),
    dialogue_lines: (dialogueByEnemyRollcaster.get(String(row.id)) ?? []).sort((a, b) => Number(a.sequence_index) - Number(b.sequence_index)).map((item) => ({
      id: String(item.id), enemy_rollcaster_id: String(item.enemy_rollcaster_id),
      moment: String(item.moment) as DungeonEnemyRollcaster["dialogue_lines"][number]["moment"],
      line_text: String(item.line_text), sequence_index: Number(item.sequence_index),
    })),
    currencyDrops: (currencyByEnemyRollcaster.get(String(row.id)) ?? []).map((item) => normalizeDungeonDrop(item as unknown as RawDungeonCurrencyDrop)),
    itemDrops: (itemsByEnemyRollcaster.get(String(row.id)) ?? []).map((item) => normalizeDungeonDrop(item as unknown as RawDungeonItemDrop)),
  }));
  const dungeonOpponents = rawDungeonOpponents.map((opponent) => {
    const skills = (skillsByOpponent.get(opponent.id) ?? [])
      .sort((left, right) => left.slot_index - right.slot_index)
      .map((row) => row.skill_id);
    const relics = (relicsByOpponent.get(opponent.id) ?? [])
      .sort((left, right) => left.slot_index - right.slot_index)
      .map((row) => row.relic_id);
    const overrideRows = overridesByOpponent.get(opponent.id) ?? [];
    const overrides: DungeonOpponent["overrides"] = {};
    for (const row of overrideRows) {
      const key = {
        hp: "hp",
        atk: "atk",
        def: "def",
        spd: "spd",
        dice_min: "diceMin",
        dice_max: "diceMax",
        block_cost: "block",
        swap_cost: "swap",
        relic_slots: "relicSlots",
      }[row.stat_key] as keyof DungeonOpponent["overrides"];
      overrides[key] = row.value;
    }
    return {
      ...opponent,
      probability: opponent.probability == null ? null : Number(opponent.probability),
      skill_ids: skills.length ? skills : opponent.skill_ids,
      relic_ids: relics.length ? relics : opponent.relic_ids,
      currencyDrops: (currencyDropsByOpponent.get(opponent.id) ?? [])
        .sort((left, right) => left.sort_order - right.sort_order)
        .map(normalizeDungeonDrop),
      itemDrops: (itemDropsByOpponent.get(opponent.id) ?? [])
        .sort((left, right) => left.sort_order - right.sort_order)
        .map(normalizeDungeonDrop),
      overrides,
    };
  });
  const normalizedDungeons = sortDungeonsNaturally((dungeons as Catalog["dungeons"]).map((dungeon) => {
    const format = parseBattleFormat(dungeon.battle_format);
    return {
      ...dungeon,
      description: dungeon.description ?? "",
      battle_count: dungeon.battle_count ?? dungeon.encounter_count,
      player_active_count: format.playerActiveCount,
      opponent_active_count: format.opponentActiveCount,
      regular_logo_path: dungeon.regular_logo_path ?? null,
      boss_logo_path: dungeon.boss_logo_path ?? null,
      is_active: dungeon.is_active !== false,
      is_archived: dungeon.is_archived === true,
      version: dungeon.version ?? 1,
    };
  }));
  const elementIds = new Set((elements as ElementDef[]).map((element) => element.id));
  const matrixPairs = new Set((elementEffectiveness as ElementEffectiveness[])
    .map((row) => `${row.attacking_element_id}\u0000${row.defending_element_id}`));
  for (const attackingElementId of elementIds) {
    for (const defendingElementId of elementIds) {
      if (!matrixPairs.has(`${attackingElementId}\u0000${defendingElementId}`)) {
        throw new Error(`Element Chart is incomplete: ${attackingElementId} attacking ${defendingElementId}.`);
      }
    }
  }
  for (const critter of critters) {
    for (const elementId of [critter.element_1_id, critter.element_2_id]) {
      if (elementId && !elementIds.has(elementId)) {
        throw new Error(`Unknown Critter Element: ${elementId} (${critter.id}).`);
      }
    }
  }
  return {
    ...collectibleShopCatalog,
    elements,
    elementEffectiveness: (elementEffectiveness as ElementEffectiveness[]).map((row) => ({
      ...row,
      multiplier: Number(row.multiplier),
    })),
    tags,
    skills: normalizedSkills,
    critters,
    critterProgression,
    critterSkillUnlocks,
    rollcasters,
    rollcasterProgression,
    rollcasterAbilities,
    rollcasterAbilityUnlocks,
    relics,
    dungeons: normalizedDungeons,
    dungeonOpponents,
    dungeonEnemyRollcasters,
    dungeonRegularEncounters,
    dungeonBossEncounters,
    dungeonCompletionDrops: rawDungeonCompletionDrops.map(normalizeCompletionDrop),
    starterRollcasterOptions,
    starterOptions,
    gameAssets,
    statuses,
    effectsBySkill: groupedEffects.skill,
    effectsByAbility: groupedEffects.ability,
    effectsByRelic: groupedEffects.relic,
    effectsByStatus: groupedEffects.status,
    dungeonOpponentStatOverrides,
  } as Catalog;
}

export function loadCatalog({ force = false }: { force?: boolean } = {}): Promise<Catalog> {
  if (force || !catalogPromise) {
    catalogPromise = (async () => {
      if (gameCatalogMode === "release") {
        if (!gameCatalogBaseUrl) {
          throw new Error("VITE_GAME_CATALOG_BASE_URL is required when VITE_GAME_CATALOG_MODE=release.");
        }
        const published = await loadPublishedCatalog(gameCatalogBaseUrl, gameVersion);
        currentCatalogRelease = published.release;
        activeGameAssetBaseUrl = configuredGameAssetBaseUrl ?? published.release.assetBaseUrl ?? undefined;
        return published.catalog;
      }
      // Live catalog rows contain source-master paths. This branch is reserved
      // for an explicitly configured development build.
      activeGameAssetBaseUrl = configuredGameAssetBaseUrl;
      const catalog = await fetchLiveCatalog();
      currentCatalogRelease = {
        schemaVersion: 0,
        catalogVersion: "live-development",
        publishedAt: new Date().toISOString(),
        manifestUrl: "",
        assetBaseUrl: activeGameAssetBaseUrl ?? null,
        source: "live-development",
      };
      return catalog;
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
  liveAssetVersions.clear();
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
  const { data, error } = await requireClient().rpc("open_lootbox", {
    p_lootbox_id: lootboxId,
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as LootboxOpeningReceipt;
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
  const { data, error } = await requireClient().rpc("redeem_promo_code", {
    p_code: code.trim(),
  });
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
