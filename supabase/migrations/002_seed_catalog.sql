insert into public.elements (id, name, description, sort_order) values
  ('basic', 'Basic', 'Reliable neutral techniques.', 1),
  ('vile', 'Vile', 'Toxic and corrosive force.', 2),
  ('bloom', 'Bloom', 'Growth, spores, and natural recovery.', 3),
  ('aqua', 'Aqua', 'Flowing water pressure and control.', 4),
  ('metal', 'Metal', 'Equipment and reinforced defense.', 5)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.statuses (id, name, description, effect) values
  ('toxic', 'Toxic', 'Deals 8% max HP damage at the end of each turn.', '{"kind":"damage_over_time","timing":"end_of_turn","amount_type":"percent_max_hp","amount":0.08}'),
  ('paralysis', 'Paralysis', 'Has a 30% chance to prevent acting each turn.', '{"kind":"skip_chance","timing":"before_action","chance":0.30}')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  effect = excluded.effect;

insert into public.skills (id, name, element_id, skill_type, power, mana_cost, description, effect, sort_order) values
  ('slam', 'Slam', 'basic', 'attack', 40, 3, 'A clean physical hit with no secondary effect.', '{}', 1)
on conflict (id) do update set
  name = excluded.name,
  element_id = excluded.element_id,
  skill_type = excluded.skill_type,
  power = excluded.power,
  mana_cost = excluded.mana_cost,
  description = excluded.description,
  effect = excluded.effect,
  sort_order = excluded.sort_order;

insert into public.critters (
  id, name, element_id, base_hp, base_atk, base_def, base_spd,
  base_dice_min, base_dice_max, base_block_cost, base_swap_cost, description, sort_order
) values
  ('001', 'Toxichick', 'vile', 34, 17, 12, 18, 1, 6, 2, 2, 'Fast Vile starter with sharp early tempo.', 1),
  ('002', 'Spreagle', 'bloom', 40, 14, 16, 13, 1, 6, 2, 3, 'Balanced Bloom starter with sturdy growth potential.', 2),
  ('003', 'Congua', 'aqua', 44, 13, 18, 10, 1, 8, 3, 2, 'Durable Aqua starter with a larger mana die.', 3)
on conflict (id) do update set
  name = excluded.name,
  element_id = excluded.element_id,
  base_hp = excluded.base_hp,
  base_atk = excluded.base_atk,
  base_def = excluded.base_def,
  base_spd = excluded.base_spd,
  base_dice_min = excluded.base_dice_min,
  base_dice_max = excluded.base_dice_max,
  base_block_cost = excluded.base_block_cost,
  base_swap_cost = excluded.base_swap_cost,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.critter_level_progression (
  critter_id, level, total_required_xp, grant_skill_points, hp_delta, atk_delta, def_delta,
  spd_delta, dice_min_delta, dice_max_delta, block_cost_delta, swap_cost_delta, total_unlocked_relic_slots
) values
  ('001', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
  ('001', 2, 80, 1, 4, 2, 1, 2, 0, 0, 0, 0, 1),
  ('001', 3, 180, 2, 4, 2, 2, 1, 0, 0, 0, 0, 1),
  ('001', 4, 340, 2, 5, 2, 2, 2, 0, 0, 0, 0, 2),
  ('001', 5, 560, 3, 5, 3, 2, 2, 0, 1, 0, 0, 2),
  ('002', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
  ('002', 2, 80, 1, 5, 1, 2, 1, 0, 0, 0, 0, 1),
  ('002', 3, 180, 2, 5, 2, 2, 1, 0, 0, 0, 0, 1),
  ('002', 4, 340, 2, 6, 2, 2, 1, 0, 0, 0, -1, 2),
  ('002', 5, 560, 3, 6, 2, 3, 2, 0, 1, 0, 0, 2),
  ('003', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
  ('003', 2, 80, 1, 6, 1, 2, 1, 0, 0, 0, 0, 1),
  ('003', 3, 180, 2, 6, 2, 3, 1, 0, 0, 0, 0, 1),
  ('003', 4, 340, 2, 6, 2, 3, 1, 0, 0, -1, 0, 2),
  ('003', 5, 560, 3, 7, 2, 3, 1, 0, 1, 0, 0, 2)
on conflict (critter_id, level) do update set
  total_required_xp = excluded.total_required_xp,
  grant_skill_points = excluded.grant_skill_points,
  hp_delta = excluded.hp_delta,
  atk_delta = excluded.atk_delta,
  def_delta = excluded.def_delta,
  spd_delta = excluded.spd_delta,
  dice_min_delta = excluded.dice_min_delta,
  dice_max_delta = excluded.dice_max_delta,
  block_cost_delta = excluded.block_cost_delta,
  swap_cost_delta = excluded.swap_cost_delta,
  total_unlocked_relic_slots = excluded.total_unlocked_relic_slots;

insert into public.critter_skill_unlocks (critter_id, skill_id, unlock_level, unlock_cost, is_default, sort_order) values
  ('001', 'slam', 1, 0, true, 1),
  ('002', 'slam', 1, 0, true, 1),
  ('003', 'slam', 1, 0, true, 1)
on conflict (critter_id, skill_id) do update set
  unlock_level = excluded.unlock_level,
  unlock_cost = excluded.unlock_cost,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order;

insert into public.rollcasters (id, name, description, sort_order) values
  ('001', 'Shanks', 'Default Rollcaster who sharpens the squad for direct offense.', 1)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.rollcaster_level_progression (
  rollcaster_id, level, total_required_xp, grant_ability_points, total_unlocked_ability_slots
) values
  ('001', 1, 0, 0, 1),
  ('001', 2, 120, 2, 1),
  ('001', 3, 260, 2, 1),
  ('001', 4, 460, 3, 2),
  ('001', 5, 720, 3, 2)
on conflict (rollcaster_id, level) do update set
  total_required_xp = excluded.total_required_xp,
  grant_ability_points = excluded.grant_ability_points,
  total_unlocked_ability_slots = excluded.total_unlocked_ability_slots;

insert into public.rollcaster_abilities (id, name, description, effect, sort_order) values
  ('sharpen', 'Sharpen', 'Each critter in your squad has +3 ATK.', '{"kind":"team_stat_bonus","target":"all_friendly_critters","stat":"atk","amount_type":"flat","amount":3}', 1)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  effect = excluded.effect,
  sort_order = excluded.sort_order;

insert into public.rollcaster_ability_unlocks (
  rollcaster_id, ability_id, unlock_level, unlock_cost, is_default, sort_order
) values
  ('001', 'sharpen', 1, 0, true, 1)
on conflict (rollcaster_id, ability_id) do update set
  unlock_level = excluded.unlock_level,
  unlock_cost = excluded.unlock_cost,
  is_default = excluded.is_default,
  sort_order = excluded.sort_order;

insert into public.relics (id, name, description, max_owned, effect, sort_order) values
  ('001', 'Copper Shield', 'Equipped critter gains +5 DEF.', 10, '{"kind":"equipped_critter_stat_bonus","stat":"def","amount_type":"flat","amount":5}', 1)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  max_owned = excluded.max_owned,
  effect = excluded.effect,
  sort_order = excluded.sort_order;

insert into public.dungeons (
  id, name, dungeon_type, difficulty, battle_format,
  player_active_count, opponent_active_count, encounter_count, next_dungeon_id, sort_order
) values
  ('001', 'Journey Begins', 'regular', 1, '1v1', 1, 1, 1, '002', 1),
  ('002', 'Creek Clash', 'regular', 2, '2v1', 2, 1, 2, '003', 2),
  ('003', 'Triad Trial', 'boss', 4, '3v3', 3, 3, 1, null, 3)
on conflict (id) do update set
  name = excluded.name,
  dungeon_type = excluded.dungeon_type,
  difficulty = excluded.difficulty,
  battle_format = excluded.battle_format,
  player_active_count = excluded.player_active_count,
  opponent_active_count = excluded.opponent_active_count,
  encounter_count = excluded.encounter_count,
  next_dungeon_id = excluded.next_dungeon_id,
  sort_order = excluded.sort_order;

delete from public.dungeon_opponents;

insert into public.dungeon_opponents (
  dungeon_id, pool_type, sequence_index, probability, critter_id, critter_level,
  skill_ids, rollcaster_xp_reward, critter_xp_reward, currency_reward, drops
) values
  ('001', 'regular_pool', 1, 0.55, '001', 1, array['slam'], 50, 35, 8, '[{"kind":"relic","relic_id":"001","chance":0.25,"quantity":1}]'),
  ('001', 'regular_pool', 2, 0.25, '002', 1, array['slam'], 55, 35, 9, '[]'),
  ('001', 'regular_pool', 3, 0.20, '003', 1, array['slam'], 60, 40, 10, '[{"kind":"relic","relic_id":"001","chance":0.10,"quantity":1}]'),
  ('002', 'regular_pool', 1, 0.40, '003', 2, array['slam'], 75, 60, 15, '[]'),
  ('002', 'regular_pool', 2, 0.35, '002', 2, array['slam'], 75, 60, 15, '[{"kind":"relic","relic_id":"001","chance":0.30,"quantity":1}]'),
  ('002', 'regular_pool', 3, 0.25, '001', 3, array['slam'], 90, 75, 18, '[]'),
  ('003', 'boss_order', 1, null, '001', 3, array['slam'], 120, 100, 25, '[{"kind":"relic","relic_id":"001","chance":0.45,"quantity":1}]'),
  ('003', 'boss_order', 2, null, '002', 3, array['slam'], 120, 100, 25, '[]'),
  ('003', 'boss_order', 3, null, '003', 3, array['slam'], 120, 100, 25, '[]');

insert into public.starter_options (critter_id, sort_order, is_active) values
  ('001', 1, true),
  ('002', 2, true),
  ('003', 3, true)
on conflict (critter_id) do update set
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
