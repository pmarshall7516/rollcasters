import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AppData,
  Catalog,
  PlayerState,
  UserAbilitySlot,
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

export async function signUp(email: string, password: string, username: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) throw error;
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

export function getGameAssetUrl(assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const client = requireClient();
  return client.storage.from(GAME_ASSETS_BUCKET).getPublicUrl(assetPath).data.publicUrl;
}

export async function loadCatalog(): Promise<Catalog> {
  const [
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
    starterOptions,
    gameAssets,
  ] = await Promise.all([
    selectAll("elements"),
    selectAll("skills"),
    selectAll("critters"),
    selectAll("critter_level_progression", "level"),
    selectAll("critter_skill_unlocks"),
    selectAll("rollcasters"),
    selectAll("rollcaster_level_progression", "level"),
    selectAll("rollcaster_abilities"),
    selectAll("rollcaster_ability_unlocks"),
    selectAll("relics"),
    selectAll("dungeons"),
    selectAll("dungeon_opponents", "sequence_index"),
    selectAll("starter_options"),
    selectAllOptional("game_assets"),
  ]);

  return {
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
    starterOptions,
    gameAssets,
  } as Catalog;
}

export async function loadPlayerState(): Promise<PlayerState> {
  const client = requireClient();
  const [
    profile,
    rollcasters,
    critters,
    seen,
    relicInventory,
    squadSlots,
    skillSlots,
    abilitySlots,
    unlockedSkills,
    unlockedAbilities,
    dungeonProgress,
  ] = await Promise.all([
    client.from("profiles").select("*").single(),
    client.from("user_rollcasters").select("*").order("unlocked_at", { ascending: true }),
    client.from("user_critters").select("*").order("unlocked_at", { ascending: true }),
    client.from("user_seen_critters").select("critter_id"),
    client.from("user_relic_inventory").select("*"),
    client.from("user_squad_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_critter_skill_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_rollcaster_ability_slots").select("*").order("slot_index", { ascending: true }),
    client.from("user_critter_skills").select("*"),
    client.from("user_rollcaster_abilities").select("*"),
    client.from("user_dungeon_progress").select("*"),
  ]);

  for (const result of [
    profile,
    rollcasters,
    critters,
    seen,
    relicInventory,
    squadSlots,
    skillSlots,
    abilitySlots,
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
    seenCritterIds: (seen.data ?? []).map((row) => row.critter_id as string),
    relicInventory: relicInventory.data ?? [],
    squadSlots: squadSlots.data ?? [],
    skillSlots: (skillSlots.data ?? []) as UserSkillSlot[],
    abilitySlots: (abilitySlots.data ?? []) as UserAbilitySlot[],
    unlockedSkillIdsByCritter,
    unlockedAbilityIdsByRollcaster,
    dungeonProgress: dungeonProgress.data ?? [],
  } as PlayerState;
}

export async function loadAppData(): Promise<AppData> {
  const [catalog, player] = await Promise.all([loadCatalog(), loadPlayerState()]);
  return { catalog, player };
}

export async function startDungeonRun(dungeonId: string): Promise<string> {
  const client = requireClient();
  const { data, error } = await client.rpc("start_dungeon_run", { p_dungeon_id: dungeonId });
  if (error) throw error;
  return data as string;
}

export async function resolveDungeonRun(runId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("resolve_dungeon_run", { p_run_id: runId });
  if (error) throw error;
}
