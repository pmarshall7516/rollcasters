export type View = "auth" | "starter" | "home" | "collection" | "play" | "combat" | "rewards";

export type ElementDef = {
  id: string;
  name: string;
  description: string | null;
  asset_path: string | null;
  sort_order: number;
};

export type SkillTargeting =
  | "single_enemy"
  | "all_enemies"
  | "all_others"
  | "single_any"
  | "self_only"
  | "all_allies"
  | "all_friendlies";

export type EffectOwnerType = "skill" | "ability" | "relic" | "status";
export type EffectTarget =
  | "skill_user"
  | "selected_target"
  | "all_enemies"
  | "all_allies"
  | "all_friendlies"
  | "all_friendly_critters"
  | "active_friendly_critter"
  | "equipped_critter"
  | "status_holder";

export type EffectTemplate = {
  id: string;
  effect_category: EffectOwnerType;
  runtime_kind: string;
  runtime_version: number;
  is_runtime_supported: boolean;
  is_active: boolean;
  is_archived: boolean;
  version: number;
};

export type EffectDefinition = {
  id: string;
  name: string;
  description: string;
  owner_type: EffectOwnerType;
  parameters: Record<string, unknown>;
  version: number;
  is_active: boolean;
  is_archived: boolean;
  template: EffectTemplate;
};

export type ResolvedEffectRef = {
  id: string;
  name: string;
  description: string;
  ownerType: EffectOwnerType;
  runtimeKind: string;
  runtimeVersion: number;
  parameters: Record<string, unknown>;
  sortOrder: number;
  definitionVersion: number;
  templateVersion: number;
};

export type EffectAttachment = {
  effect_id: string;
  sort_order: number;
};

export type SkillEffectAttachment = EffectAttachment & { skill_id: string; role: "primary" | "secondary" };
export type AbilityEffectAttachment = EffectAttachment & { ability_id: string };
export type RelicEffectAttachment = EffectAttachment & { relic_id: string };
export type StatusEffectAttachment = EffectAttachment & { status_id: string };

export type Status = {
  id: string;
  name: string;
  description: string;
  stacking_policy?: "refresh" | "extend" | "stack" | "ignore";
  default_duration?: number;
  max_stacks?: number;
  is_active?: boolean;
  is_archived?: boolean;
  version?: number;
};

export type Skill = {
  id: string;
  name: string;
  element_id: string;
  skill_type: "attack" | "support";
  power: number;
  mana_cost: number;
  targeting: SkillTargeting;
  description: string;
  effect: Record<string, unknown>;
  sort_order: number;
};

export type Critter = {
  id: string;
  name: string;
  element_id: string;
  base_hp: number;
  base_atk: number;
  base_def: number;
  base_spd: number;
  base_dice_min: number;
  base_dice_max: number;
  base_block_cost: number;
  base_swap_cost: number;
  asset_path: string | null;
  description: string | null;
  sort_order: number;
};

export type CritterProgression = {
  critter_id: string;
  level: number;
  total_required_xp: number;
  grant_skill_points: number;
  hp_delta: number;
  atk_delta: number;
  def_delta: number;
  spd_delta: number;
  dice_min_delta: number;
  dice_max_delta: number;
  block_cost_delta: number;
  swap_cost_delta: number;
  total_unlocked_relic_slots: number;
};

export type CritterSkillUnlock = {
  critter_id: string;
  skill_id: string;
  unlock_level: number;
  unlock_cost: number;
  is_default: boolean;
  sort_order: number;
};

export type Rollcaster = {
  id: string;
  name: string;
  asset_path: string | null;
  description: string | null;
  sort_order: number;
};

export type RollcasterProgression = {
  rollcaster_id: string;
  level: number;
  total_required_xp: number;
  grant_ability_points: number;
  total_unlocked_ability_slots: number;
};

export type RollcasterAbility = {
  id: string;
  name: string;
  description: string;
  effect: Record<string, unknown>;
  sort_order: number;
};

export type RollcasterAbilityUnlock = {
  rollcaster_id: string;
  ability_id: string;
  unlock_level: number;
  unlock_cost: number;
  is_default: boolean;
  sort_order: number;
};

export type Relic = {
  id: string;
  name: string;
  description: string;
  max_owned: number;
  effect: Record<string, unknown>;
  asset_path: string | null;
  sort_order: number;
};

export type Dungeon = {
  id: string;
  name: string;
  dungeon_type: "regular" | "boss";
  difficulty: number;
  battle_format: "1v1" | "2v1" | "3v1" | "2v2" | "3v3";
  player_active_count: number;
  opponent_active_count: number;
  encounter_count: number;
  next_dungeon_id: string | null;
  sort_order: number;
};

export type DungeonOpponent = {
  id: string;
  dungeon_id: string;
  pool_type: "regular_pool" | "boss_order";
  sequence_index: number | null;
  probability: number | null;
  critter_id: string;
  critter_level: number;
  skill_ids: string[];
  relic_ids: string[];
  rollcaster_xp_reward: number;
  critter_xp_reward: number;
  currency_reward: number;
  drops: Array<Record<string, unknown>>;
};

export type DungeonOpponentStatOverride = {
  opponent_id: string;
  stat_key: "hp" | "atk" | "def" | "spd" | "dice_min" | "dice_max" | "block_cost" | "swap_cost";
  value: number;
};

export type StarterOption = {
  critter_id: string;
  sort_order: number;
  is_active: boolean;
};

export type GameAsset = {
  id: string;
  bucket_id: string;
  path: string;
  category: "critter" | "rollcaster" | "relic" | "element" | "currency" | "mana" | "ui" | "other";
  owner_table: string | null;
  owner_id: string | null;
  variant: string;
  display_name: string | null;
  alt_text: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  is_active: boolean;
  sort_order: number;
};

export type Profile = {
  user_id: string;
  username: string;
  coins: number;
  starter_selected_at: string | null;
  active_rollcaster_id: string | null;
};

export type UserRollcaster = {
  id: string;
  user_id: string;
  rollcaster_id: string;
  level: number;
  xp: number;
  ability_points: number;
};

export type UserCritter = {
  id: string;
  user_id: string;
  critter_id: string;
  level: number;
  xp: number;
  skill_points: number;
};

export type UserDungeonProgress = {
  user_id: string;
  dungeon_id: string;
  is_unlocked: boolean;
  completed_at: string | null;
  clear_count: number;
};

export type UserRelicInventory = {
  user_id: string;
  relic_id: string;
  quantity: number;
  discovered_at: string | null;
};

export type UserSquadSlot = {
  user_id: string;
  slot_index: number;
  user_critter_id: string | null;
};

export type UserSkillSlot = {
  user_critter_id: string;
  slot_index: number;
  skill_id: string | null;
};

export type UserAbilitySlot = {
  user_rollcaster_id: string;
  slot_index: number;
  ability_id: string | null;
};

export type UserRelicSlot = {
  user_critter_id: string;
  slot_index: number;
  relic_id: string | null;
};

export type Catalog = {
  elements: ElementDef[];
  skills: Skill[];
  critters: Critter[];
  critterProgression: CritterProgression[];
  critterSkillUnlocks: CritterSkillUnlock[];
  rollcasters: Rollcaster[];
  rollcasterProgression: RollcasterProgression[];
  rollcasterAbilities: RollcasterAbility[];
  rollcasterAbilityUnlocks: RollcasterAbilityUnlock[];
  relics: Relic[];
  dungeons: Dungeon[];
  dungeonOpponents: DungeonOpponent[];
  starterOptions: StarterOption[];
  gameAssets: GameAsset[];
  statuses: Status[];
  effects: EffectDefinition[];
  effectsBySkill: Record<string, ResolvedEffectRef[]>;
  effectsByAbility: Record<string, ResolvedEffectRef[]>;
  effectsByRelic: Record<string, ResolvedEffectRef[]>;
  effectsByStatus: Record<string, ResolvedEffectRef[]>;
  dungeonOpponentStatOverrides: DungeonOpponentStatOverride[];
};

export type PlayerState = {
  profile: Profile;
  rollcasters: UserRollcaster[];
  critters: UserCritter[];
  relicInventory: UserRelicInventory[];
  squadSlots: UserSquadSlot[];
  skillSlots: UserSkillSlot[];
  abilitySlots: UserAbilitySlot[];
  relicSlots: UserRelicSlot[];
  unlockedSkillIdsByCritter: Record<string, string[]>;
  unlockedAbilityIdsByRollcaster: Record<string, string[]>;
  dungeonProgress: UserDungeonProgress[];
};

export type AppData = {
  catalog: Catalog;
  player: PlayerState | null;
};

export type CombatActionType = "swap" | "block" | "skill" | "skip";

export type CombatAction = {
  actorKey: string;
  type: CombatActionType;
  skillId?: string;
  targetKey?: string;
  swapToId?: string;
  cost: number;
};
