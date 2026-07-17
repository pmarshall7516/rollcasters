import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { groupCombatEffectRows } from "./effects";
import type {
  AppData,
  Catalog,
  CollectiblePlayerSnapshot,
  CombatEffectRow,
  CombatProgressEvent,
  Critter,
  DungeonOpponent,
  ElementDef,
  PlayerState,
  ShopPurchaseReceipt,
  UserAbilitySlot,
  UserRelicSlot,
  UserSkillSlot,
} from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const GAME_ASSETS_BUCKET = "game-assets";
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  return supabase;
}

async function selectAll<T>(table: string, order = "sort_order"): Promise<T[]> {
  const client = requireClient();
  const { data, error } = await client.from(table).select("*").order(order, { ascending: true });
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

async function selectActiveAll<T>(table: string, order = "sort_order"): Promise<T[]> {
  const { data, error } = await requireClient()
    .from(table)
    .select("*")
    .eq("is_active", true)
    .eq("is_archived", false)
    .order(order, { ascending: true });
  if (error) throw error;
  return (data ?? []) as T[];
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
  return { currencies: [], shards: [], progress: [], tracked: [], unlock_events: [] };
}

type CollectibleShopCatalog = Pick<Catalog,
  "currencies" | "collectibleUnlockRequirements" | "collectibleUnlockChallenges" | "shopEntries"
>;

async function loadCollectibleShopCatalog(): Promise<CollectibleShopCatalog> {
  const { data, error } = await requireClient().rpc("get_collectible_shop_catalog");
  if (error) throw error;
  const payload = data as {
    currencies?: Catalog["currencies"];
    requirements?: Catalog["collectibleUnlockRequirements"];
    challenges?: Catalog["collectibleUnlockChallenges"];
    shop_entries?: Catalog["shopEntries"];
  } | null;
  return {
    currencies: payload?.currencies ?? [],
    collectibleUnlockRequirements: payload?.requirements ?? [],
    collectibleUnlockChallenges: payload?.challenges ?? [],
    shopEntries: payload?.shop_entries ?? [],
  };
}

export async function getCollectiblePlayerSnapshot(): Promise<CollectiblePlayerSnapshot> {
  const { data, error } = await requireClient().rpc("get_collectible_player_snapshot");
  if (error) throw error;
  return { ...emptyCollectibleSnapshot(), ...(data as Partial<CollectiblePlayerSnapshot> | null) };
}

async function loadCombatEffects(): Promise<CombatEffectRow[]> {
  const { data, error } = await requireClient()
    .from("combat_effects_v1")
    .select("owner_type,owner_id,id,name,description,sort_order,template_id,runtime_kind,runtime_version,parameters")
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
  return data.session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string, username: string): Promise<boolean> {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw error;
  return Boolean(data.session);
}

export async function signOut(): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
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
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const client = requireClient();
  return client.storage.from(GAME_ASSETS_BUCKET).getPublicUrl(assetPath).data.publicUrl;
}

export async function loadCatalog(): Promise<Catalog> {
  const [
    collectibleShopCatalog,
    elements,
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
    dungeonOpponents,
    starterRollcasterOptions,
    starterOptions,
    gameAssets,
    statuses,
    combatEffects,
    dungeonOpponentStatOverrides,
  ] = await Promise.all([
    loadCollectibleShopCatalog(),
    selectAll("elements"),
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
    selectAll("dungeon_opponents", "sequence_index"),
    selectAll("starter_rollcaster_options"),
    selectAll("starter_options"),
    selectAllOptional("game_assets"),
    selectAll("statuses"),
    loadCombatEffects(),
    selectAllOptional("dungeon_opponent_stat_overrides", "stat_key"),
  ]);

  const groupedEffects = groupCombatEffectRows(combatEffects);
  const critters = rawCritters.map(normalizeCritter);
  const elementIds = new Set((elements as ElementDef[]).map((element) => element.id));
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
    skills,
    critters,
    critterProgression,
    critterSkillUnlocks,
    rollcasters,
    rollcasterProgression,
    rollcasterAbilities,
    rollcasterAbilityUnlocks,
    relics,
    dungeons,
    dungeonOpponents,
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

export async function loadPlayerState(): Promise<PlayerState> {
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
  ] = await Promise.all([
    client.from("profiles").select("*").single(),
    client.from("user_rollcasters").select("*").order("unlocked_at", { ascending: true }),
    client.from("user_critters").select("*").order("unlocked_at", { ascending: true }),
    client.from("user_relic_inventory").select("*"),
    client.from("user_squad_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_critter_skill_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_rollcaster_ability_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_critter_relic_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_critter_skills").select("*"),
    client.from("user_rollcaster_abilities").select("*"),
    client.from("user_dungeon_progress").select("*"),
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
    collectibleSnapshot,
  } as PlayerState;
}

async function callLoadoutRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await requireClient().rpc(name, args);
  if (error) throw error;
}

export const setSquadSlot = (slotIndex: number, userCritterId: string | null) =>
  callLoadoutRpc("set_squad_critter_slot", { p_slot_index: slotIndex, p_user_critter_id: userCritterId });

export const setCritterSkillSlot = (userCritterId: string, slotIndex: number, skillId: string | null) =>
  callLoadoutRpc("set_critter_skill_slot", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_skill_id: skillId });

export const setCritterRelicSlot = (userCritterId: string, slotIndex: number, relicId: string | null) =>
  callLoadoutRpc("set_critter_relic_slot", { p_user_critter_id: userCritterId, p_slot_index: slotIndex, p_relic_id: relicId });

export const setRollcasterAbilitySlot = (userRollcasterId: string, slotIndex: number, abilityId: string | null) =>
  callLoadoutRpc("set_rollcaster_ability_slot", { p_user_rollcaster_id: userRollcasterId, p_slot_index: slotIndex, p_ability_id: abilityId });

export const setActiveRollcaster = (userRollcasterId: string) =>
  callLoadoutRpc("set_active_rollcaster", { p_user_rollcaster_id: userRollcasterId });

export const unlockCritterSkill = (userCritterId: string, skillId: string) =>
  callLoadoutRpc("unlock_critter_skill", { p_user_critter_id: userCritterId, p_skill_id: skillId });

export const unlockRollcasterAbility = (userRollcasterId: string, abilityId: string) =>
  callLoadoutRpc("unlock_rollcaster_ability", { p_user_rollcaster_id: userRollcasterId, p_ability_id: abilityId });

export async function loadAppData(): Promise<AppData> {
  const [catalog, player] = await Promise.all([loadCatalog(), loadPlayerState()]);
  return { catalog, player };
}

export async function startDungeonRun(dungeonId: string): Promise<{ id: string; selectedOpponents: DungeonOpponent[] }> {
  const client = requireClient();
  const { data, error } = await client.rpc("start_dungeon_run", { p_dungeon_id: dungeonId });
  if (error) throw error;
  const runId = data as string;
  const run = await client
    .from("dungeon_runs")
    .select("selected_opponents")
    .eq("id", runId)
    .single();
  if (run.error) throw run.error;
  if (!Array.isArray(run.data.selected_opponents) || run.data.selected_opponents.length === 0) {
    throw new Error(`Dungeon run ${runId} has no selected opponents.`);
  }
  return { id: runId, selectedOpponents: run.data.selected_opponents as DungeonOpponent[] };
}

export async function snapshotDungeonRunEffects(runId: string, snapshot: unknown): Promise<void> {
  const { error } = await requireClient().rpc("snapshot_dungeon_run_effects", { p_run_id: runId, p_snapshot: snapshot });
  if (error) throw error;
}

export async function resolveDungeonRun(runId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("resolve_dungeon_run", { p_run_id: runId });
  if (error) throw error;
}

export async function trackCollectibleChallenge(challengeId: string): Promise<CollectiblePlayerSnapshot> {
  const { error } = await requireClient().rpc("track_collectible_challenge", { p_challenge_id: challengeId });
  if (error) throw error;
  return getCollectiblePlayerSnapshot();
}

export async function untrackCollectibleChallenge(challengeId: string): Promise<CollectiblePlayerSnapshot> {
  const { error } = await requireClient().rpc("untrack_collectible_challenge", { p_challenge_id: challengeId });
  if (error) throw error;
  return getCollectiblePlayerSnapshot();
}

export async function acknowledgeCollectibleUnlockEvent(eventId: string): Promise<void> {
  const { error } = await requireClient().rpc("acknowledge_collectible_unlock_event", { p_event_id: eventId });
  if (error) throw error;
}

export async function purchaseShopEntry(entryId: string, requestId: string): Promise<ShopPurchaseReceipt> {
  const { data, error } = await requireClient().rpc("purchase_shop_entry", {
    p_entry_id: entryId,
    p_request_id: requestId,
  });
  if (error) throw error;
  return data as ShopPurchaseReceipt;
}

export async function submitCollectibleCombatEvents(
  runId: string,
  turnNumber: number,
  events: CombatProgressEvent[],
): Promise<CollectiblePlayerSnapshot> {
  if (events.length === 0) return getCollectiblePlayerSnapshot();
  const { data, error } = await requireClient().rpc("submit_collectible_combat_events", {
    p_run_id: runId,
    p_turn_number: turnNumber,
    p_events: events,
  });
  if (error) throw error;
  return { ...emptyCollectibleSnapshot(), ...(data as Partial<CollectiblePlayerSnapshot> | null) };
}
