import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { assertEffectContract } from "./effects";
import type {
  AppData,
  AbilityEffectAttachment,
  Catalog,
  EffectDefinition,
  EffectOwnerType,
  DungeonOpponent,
  PlayerState,
  RelicEffectAttachment,
  ResolvedEffectRef,
  SkillEffectAttachment,
  StatusEffectAttachment,
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

async function loadPublishedEffects(): Promise<EffectDefinition[]> {
  const { data, error } = await requireClient()
    .from("effect_definitions")
    .select(`
      id, name, description, owner_type, parameters, version, is_active, is_archived,
      template:effect_templates!effect_definitions_template_id_fkey!inner(
        id, effect_category, runtime_kind, runtime_version, is_runtime_supported,
        is_active, is_archived, version
      )
    `)
    .eq("is_active", true)
    .eq("is_archived", false)
    .eq("template.is_runtime_supported", true)
    .eq("template.is_active", true)
    .eq("template.is_archived", false);
  if (error) throw error;
  return (data ?? []) as unknown as EffectDefinition[];
}

function resolveAttachmentMap<T extends { effect_id: string; sort_order: number }>(
  rows: T[],
  ownerKey: keyof T,
  expectedOwner: EffectOwnerType,
  effects: EffectDefinition[],
): Record<string, ResolvedEffectRef[]> {
  const definitions = new Map(effects.map((effect) => [effect.id, effect]));
  const result: Record<string, ResolvedEffectRef[]> = {};

  for (const attachment of rows) {
    const ownerId = String(attachment[ownerKey]);
    const definition = definitions.get(attachment.effect_id);
    if (!definition) {
      throw new Error(`Invalid ${expectedOwner} effect attachment: ${attachment.effect_id} is missing, inactive, archived, or unsupported.`);
    }
    if (definition.owner_type !== expectedOwner) {
      throw new Error(`Effect owner mismatch: ${definition.id} belongs to ${definition.owner_type}, not ${expectedOwner}.`);
    }
    const template = Array.isArray(definition.template) ? definition.template[0] : definition.template;
    if (!template?.is_runtime_supported || !template.is_active || template.is_archived) {
      throw new Error(`Unsupported effect runtime for ${definition.id}.`);
    }
    if (template.effect_category !== definition.owner_type) {
      throw new Error(`Effect category mismatch: ${definition.id} is ${definition.owner_type}, but template ${template.id} is ${template.effect_category}.`);
    }
    const ref: ResolvedEffectRef = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      ownerType: definition.owner_type,
      runtimeKind: template.runtime_kind,
      runtimeVersion: template.runtime_version,
      parameters: definition.parameters,
      sortOrder: attachment.sort_order,
      definitionVersion: definition.version,
      templateVersion: template.version,
    };
    assertEffectContract(ref, expectedOwner);
    result[ownerId] = [...(result[ownerId] ?? []), ref];
  }

  for (const refs of Object.values(result)) {
    refs.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }
  return result;
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
    statuses,
    effects,
    skillEffectAttachments,
    abilityEffectAttachments,
    relicEffectAttachments,
    statusEffectAttachments,
    dungeonOpponentStatOverrides,
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
    selectAll("statuses"),
    loadPublishedEffects(),
    selectAll<SkillEffectAttachment>("skill_effect_attachments"),
    selectAll<AbilityEffectAttachment>("ability_effect_attachments"),
    selectAll<RelicEffectAttachment>("relic_effect_attachments"),
    selectAll<StatusEffectAttachment>("status_effect_attachments"),
    selectAllOptional("dungeon_opponent_stat_overrides", "stat_key"),
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
    statuses,
    effects,
    effectsBySkill: resolveAttachmentMap(skillEffectAttachments, "skill_id", "skill", effects),
    effectsByAbility: resolveAttachmentMap(abilityEffectAttachments, "ability_id", "ability", effects),
    effectsByRelic: resolveAttachmentMap(relicEffectAttachments, "relic_id", "relic", effects),
    effectsByStatus: resolveAttachmentMap(statusEffectAttachments, "status_id", "status", effects),
    dungeonOpponentStatOverrides,
  } as Catalog;
}

export async function loadPlayerState(): Promise<PlayerState> {
  const client = requireClient();
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
