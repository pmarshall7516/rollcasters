-- Defense-in-depth enum validation for template parameters. The editor and
-- release publisher validate these values too; this keeps direct RPC callers
-- from bypassing the canonical template vocabularies.

begin;

create or replace function public.assert_parameter_enum(
  p_parameters jsonb,
  p_key text,
  p_allowed text[],
  p_context text
)
returns void
language plpgsql
immutable
set search_path=public
as $$
begin
  if p_parameters ? p_key
    and p_parameters->p_key<>'null'::jsonb
    and jsonb_typeof(p_parameters->p_key)='string'
    and not ((p_parameters->>p_key)=any(p_allowed)) then
    raise exception 'VALIDATION: %.% has unsupported value %',p_context,p_key,p_parameters->>p_key;
  end if;
end;
$$;

create or replace function public.validate_extensible_effect_enums()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  p jsonb:=new.parameters;
  k text;
begin
  select runtime_kind into k from public.effect_templates where id=new.template_id;
  if k is null then return new; end if;

  perform public.assert_parameter_enum(p,'duration_type',array['current_action','current_turn','target_next_turn_start','target_next_turn_end','turns','rounds','activations','until_attack','until_skill','until_block','until_swap','until_damage','until_shield_break','until_leaves_active','end_of_battle','while_relic_equipped'],k);
  perform public.assert_parameter_enum(p,'duration_clock',array['owner_turn','target_turn','global_round'],k);
  perform public.assert_parameter_enum(p,'activation_limit_scope',array['turn','round','battle','per_target_battle'],k);

  if k='shield_modifier' then
    perform public.assert_parameter_enum(p,'operation',array['grant','add','subtract','set','destroy'],k);
  elsif k='reactive_trigger' then
    perform public.assert_parameter_enum(p,'trigger_event',array['owner_attacked','owner_hp_damaged','owner_shield_hit','owner_shield_breaks','owner_blocks','owner_swaps','owner_uses_skill','owner_spends_mana','owner_healed','owner_receives_positive','owner_receives_negative','owner_applies_status','owner_receives_status','owner_defeats_enemy','ally_attacked','ally_defeated','enemy_swaps','turn_start','turn_end','round_start','round_end','battle_start','battle_end'],k);
    perform public.assert_parameter_enum(p,'trigger_source',array['self','ally','enemy','active_critter','any_critter'],k);
  elsif k='direct_health_modifier' then
    perform public.assert_parameter_enum(p,'operation',array['heal','lose_hp','set_hp','drain'],k);
    perform public.assert_parameter_enum(p,'value_type',array['flat','percent_max_hp','percent_current_hp','percent_missing_hp','percent_damage_dealt'],k);
    perform public.assert_parameter_enum(p,'overhealing_behavior',array['discard','convert'],k);
  elsif k='retaliation' then
    perform public.assert_parameter_enum(p,'trigger_condition',array['attacked','hit','hp_damaged','shield_damaged','shield_breaks'],k);
    perform public.assert_parameter_enum(p,'retaliation_target',array['attacker','all_attacking_enemies'],k);
    perform public.assert_parameter_enum(p,'scaling_source',array['flat','owner_atk','owner_def','damage_received','shield_damage_received'],k);
  elsif k='damage_modifier' then
    perform public.assert_parameter_enum(p,'direction',array['dealt','received'],k);
    perform public.assert_parameter_enum(p,'modifier_type',array['flat','percentage'],k);
    perform public.assert_parameter_enum(p,'applicable_source',array['attack','skill','status','retaliation','direct_damage','any_damage'],k);
    perform public.assert_parameter_enum(p,'applicable_target',array['any','self','allies','enemies','shielded','unshielded','with_status'],k);
    perform public.assert_parameter_enum(p,'condition',array['none','target_below_half_hp','target_above_half_hp','source_below_half_hp'],k);
  elsif k='conditional_effect' then
    perform public.assert_parameter_enum(p,'condition',array['hp_percent','shield_present','shield_value','mana','active_state','has_status','has_relic','relic_count','last_squad_member','action_order','ally_defeated','enemy_defeated','turn_interval','round_interval','element','previous_action','previous_mana_roll'],k);
    perform public.assert_parameter_enum(p,'comparison',array['equal','not_equal','above','below','at_least','at_most'],k);
    perform public.assert_parameter_enum(p,'check_timing',array['continuous','turn_start','turn_end','when_applied','before_action'],k);
  elsif k='delayed_effect' then
    perform public.assert_parameter_enum(p,'delay_type',array['turns','rounds','actions','attacks_received','skills_used','blocks_performed','swaps_performed'],k);
    perform public.assert_parameter_enum(p,'target_tracking',array['original','new_valid'],k);
    perform public.assert_parameter_enum(p,'cancel_condition',array['none','source_defeated','target_defeated','target_leaves_active','shield_breaks'],k);
  elsif k='effect_removal' then
    perform public.assert_parameter_enum(p,'removal_category',array['positive','negative','stat_modifiers','statuses','shields','delayed','reactive','all_removable'],k);
    perform public.assert_parameter_enum(p,'selection_method',array['oldest','newest','strongest','weakest','random','player_selected'],k);
  elsif k='effect_copy' then
    perform public.assert_parameter_enum(p,'source',array['self','ally','enemy','active_ally','active_enemy','selected_target'],k);
    perform public.assert_parameter_enum(p,'destination',array['self','ally','enemy','selected_target'],k);
    perform public.assert_parameter_enum(p,'copy_category',array['positive','negative','stat_modifiers','shields','statuses','all_copyable'],k);
    perform public.assert_parameter_enum(p,'copy_method',array['duplicate','steal','mirror'],k);
    perform public.assert_parameter_enum(p,'copied_duration',array['preserve','replace'],k);
  elsif k='effect_transfer' then
    perform public.assert_parameter_enum(p,'transferred_effect_type',array['damage','healing','shield','positive_effect','negative_effect','status'],k);
    perform public.assert_parameter_enum(p,'original_target',array['effect_target','self','ally','enemy'],k);
    perform public.assert_parameter_enum(p,'new_target',array['self','another_ally','random_ally','active_ally','configured_target'],k);
    perform public.assert_parameter_enum(p,'transfer_timing',array['before_resolution','after_resolution'],k);
  elsif k='damage_prevention' then
    perform public.assert_parameter_enum(p,'prevented_damage_source',array['attack','skill','status','retaliation','direct_damage','any_source'],k);
    perform public.assert_parameter_enum(p,'prevention_type',array['flat','percentage','complete'],k);
    perform public.assert_parameter_enum(p,'trigger_requirement',array['none','below_half_hp','shield_absent','lethal_damage'],k);
  elsif k='action_cost_modifier' then
    perform public.assert_parameter_enum(p,'cost_type',array['skill_mana','block','swap','other'],k);
    perform public.assert_parameter_enum(p,'applicable_action',array['all_actions','specific_skills','attacks','blocks','swaps','matching_skills'],k);
    perform public.assert_parameter_enum(p,'modifier_type',array['flat','percentage','set','minimum','maximum'],k);
  elsif k='resource_gain_loss' then
    perform public.assert_parameter_enum(p,'resource',array['squad_mana','currency','other'],k);
    perform public.assert_parameter_enum(p,'operation',array['gain','lose','set','refund','drain','reserve'],k);
    perform public.assert_parameter_enum(p,'target_squad',array['user','enemy','owner'],k);
    perform public.assert_parameter_enum(p,'trigger_timing',array['immediate','through_parent'],k);
  elsif k='resource_conversion' then
    perform public.assert_parameter_enum(p,'source_value',array['excess_healing','excess_shield','mana_gained','mana_spent','damage_dealt','hp_lost','shield_damage_taken','positive_modifiers_received','negative_modifiers_received'],k);
  elsif k='effect_scaling' then
    perform public.assert_parameter_enum(p,'scaling_source',array['current_hp','missing_hp','maximum_hp','current_shield','atk','def','spd','current_mana','mana_spent','equipped_relics','living_allies','defeated_allies','positive_effects','negative_effects','turns_elapsed','activation_count','damage_received_battle','damage_dealt_battle'],k);
    perform public.assert_parameter_enum(p,'recalculate_timing',array['continuous','when_applied','when_activated','turn_start'],k);
  elsif k='repeating_effect' then
    perform public.assert_parameter_enum(p,'activation_timing',array['turn_start','turn_end','round_start','round_end'],k);
  elsif k='effect_immunity' then
    perform public.assert_parameter_enum(p,'immune_effect_category',array['stat_reductions','statuses','forced_actions','direct_hp_loss','shield_removal','action_cost_increases','healing','other'],k);
  elsif k='effect_amplification' then
    perform public.assert_parameter_enum(p,'affected_effect_category',array['healing','shields','positive_stat_modifiers','negative_stat_modifiers','statuses','mana_gain','other'],k);
    perform public.assert_parameter_enum(p,'direction',array['applied','received'],k);
    perform public.assert_parameter_enum(p,'modifier_type',array['flat','percentage'],k);
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['skill_effects','ability_effects','relic_effects','status_effects'] loop
    execute format('drop trigger if exists validate_extensible_effect_enums on public.%I',t);
    execute format('create trigger validate_extensible_effect_enums before insert or update of template_id,parameters on public.%I for each row execute function public.validate_extensible_effect_enums()',t);
  end loop;
end;
$$;

create or replace function public.validate_extensible_challenge_enums()
returns trigger
language plpgsql
set search_path=public
as $$
declare p jsonb:=new.parameters; k text:=new.challenge_type;
begin
  if k='own_collectible' then
    perform public.assert_parameter_enum(p,'collectible_category',array['critter','rollcaster','relic'],k);
  elsif k='collection_diversity' then
    perform public.assert_parameter_enum(p,'diversity_mode',array['amount_of_type','different_types','specific_types'],k);
  elsif k='squad_composition' then
    perform public.assert_parameter_enum(p,'completion_event',array['battle_win','dungeon_clear'],k);
  elsif k='dungeon_clear' then
    perform public.assert_parameter_enum(p,'dungeon_selection',array['specific_dungeon','dungeon_id_range','any_dungeon'],k);
    perform public.assert_parameter_enum(p,'relic_selection',array['specific_relics','any_relics'],k);
  elsif k='resource_spending' then
    perform public.assert_parameter_enum(p,'spending_context',array['combat','shop'],k);
    perform public.assert_parameter_enum(p,'resource_type',array['mana','coin','prismite','shard','custom_currency'],k);
    perform public.assert_parameter_enum(p,'tracking_scope',array['lifetime','single_battle','single_dungeon','single_shop_purchase'],k);
  elsif k='swap_action' then
    perform public.assert_parameter_enum(p,'tracked_action',array['swaps_performed','unique_critters_swapped_in','damage_avoided_by_swap','knockout_after_swap'],k);
    perform public.assert_parameter_enum(p,'tracking_scope',array['lifetime','single_battle','single_dungeon'],k);
  elsif k='block_action' then
    perform public.assert_parameter_enum(p,'tracked_action',array['blocks_performed','damage_prevented','attacks_fully_blocked','survived_attack_after_block'],k);
    perform public.assert_parameter_enum(p,'tracking_scope',array['lifetime','single_battle','single_dungeon'],k);
  elsif k='dice_roll' then
    perform public.assert_parameter_enum(p,'tracked_result',array['die_value','turn_mana_total','matching_dice','maximum_die_result'],k);
    perform public.assert_parameter_enum(p,'comparison',array['equal','greater_than','greater_than_or_equal','less_than','less_than_or_equal'],k);
    perform public.assert_parameter_enum(p,'tracking_scope',array['lifetime','single_battle','single_dungeon'],k);
  end if;
  return new;
end;
$$;

drop trigger if exists validate_extensible_challenge_enums on public.collectible_unlock_challenges;
create trigger validate_extensible_challenge_enums
before insert or update of challenge_type,parameters on public.collectible_unlock_challenges
for each row execute function public.validate_extensible_challenge_enums();

commit;
