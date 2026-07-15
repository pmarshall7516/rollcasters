export type View = "auth" | "starter" | "home" | "collection" | "shop" | "play" | "combat" | "rewards";

export type CollectibleType = "critter" | "rollcaster" | "relic";
export type CollectibleChallengeType =
  | "own_collectible"
  | "level_up_critter"
  | "knock_out_critters"
  | "deal_damage"
  | "take_damage"
  | "use_skill"
  | "shop_shards"
  | "shop_relic";

export type CurrencyDef = {
  id: string;
  name: string;
  description: string;
  asset_path: string | null;
  text_color: string | null;
  is_default: boolean;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
  is_archived: boolean;
};

export type CollectibleUnlockRequirement = {
  collectible_type: CollectibleType;
  collectible_id: string;
  required_challenges: number;
};

export type CollectibleUnlockChallenge = {
  id: string;
  collectible_type: CollectibleType;
  collectible_id: string;
  challenge_type: CollectibleChallengeType;
  target_category: CollectibleType | null;
  target_id: string | null;
  target_mode: "species" | "element" | "skill" | null;
  any_target: boolean;
  target_ids: string[];
  required_amount: string | null;
  required_level: number | null;
  sort_order: number;
};

export type ShopEntry = {
  id: string;
  shop_type: "shard" | "relic";
  name: string;
  description: string;
  target_category: CollectibleType;
  target_id: string;
  quantity: number;
  currency_id: string;
  price: string;
  sort_order: number;
  is_active: boolean;
  is_archived: boolean;
};

export type UserCurrency = { currency_id: string; balance: string };
export type UserCollectibleShard = { collectible_type: CollectibleType; collectible_id: string; quantity: string };
export type UserCollectibleChallengeProgress = {
  challenge_id: string;
  current: string;
  goal: string;
  completed: boolean;
};
export type UserTrackedCollectibleChallenge = { challenge_id: string; slot_order: number };
export type CollectibleUnlockEvent = {
  id: string;
  collectible_type: CollectibleType;
  collectible_id: string;
  created_at: string;
};

export type CollectiblePlayerSnapshot = {
  currencies: UserCurrency[];
  shards: UserCollectibleShard[];
  progress: UserCollectibleChallengeProgress[];
  tracked: UserTrackedCollectibleChallenge[];
  unlock_events: CollectibleUnlockEvent[];
};

export type ShopPurchaseReceipt = {
  request_id: string;
  entry_id: string;
  shop_type: "shard" | "relic";
  target_category: CollectibleType;
  target_id: string;
  currency_id: string;
  price: string;
  balance: string;
  granted: string;
  discarded: string;
  unlock_event_id: string | null;
  created_at: string;
};

export type CombatProgressEvent = {
  event_key: string;
  event_type: "knock_out_critters" | "deal_damage" | "take_damage" | "use_skill";
  source_critter_id: string | null;
  target_critter_id: string | null;
  skill_id: string | null;
  amount: number;
};

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
  | "self"
  | "all_enemies"
  | "all_allies"
  | "all_friendlies"
  | "target_enemies"
  | "all_element_friendlies"
  | "all_element_enemies"
  | "equipped_critter"
  | "equipped_allies"
  | "equipped_friendlies"
  | "status_holder"
  | "status_holder_allies"
  | "status_holder_friendlies"
  | "status_holder_enemies";

export type CombatEffectRow = {
  owner_type: EffectOwnerType;
  owner_id: string;
  id: string;
  name: string;
  description: string;
  sort_order: number;
  template_id: string;
  runtime_kind: string;
  runtime_version: number;
  parameters: Record<string, unknown>;
};

export type ResolvedEffectRef = {
  id: string;
  name: string;
  description: string;
  ownerType: EffectOwnerType;
  ownerId: string;
  templateId: string;
  runtimeKind: string;
  runtimeVersion: number;
  parameters: Record<string, unknown>;
  sortOrder: number;
};

export type Status = {
  id: string;
  name: string;
  description: string;
  asset_path?: string | null;
  sort_order?: number;
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
  is_active?: boolean;
  is_archived?: boolean;
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
  is_active?: boolean;
  is_archived?: boolean;
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
  asset_path: string | null;
  sort_order: number;
  is_active?: boolean;
  is_archived?: boolean;
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
  category: "critter" | "rollcaster" | "relic" | "status" | "element" | "currency" | "mana" | "ui" | "other";
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
  currencies: CurrencyDef[];
  collectibleUnlockRequirements: CollectibleUnlockRequirement[];
  collectibleUnlockChallenges: CollectibleUnlockChallenge[];
  shopEntries: ShopEntry[];
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
  collectibleSnapshot: CollectiblePlayerSnapshot;
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
  targetSlotSide?: "player" | "opponent";
  targetSlotIndex?: number;
  cost: number;
};
