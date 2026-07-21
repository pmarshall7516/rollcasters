-- Extensible Skill/Ability/Relic Effects and collectible Challenge templates.
-- This is an additive compatibility migration over the consolidated baseline.

begin;

alter table public.skill_effects
  add column classification text not null default 'positive',
  add column execution text not null default 'root',
  add constraint skill_effects_classification_check check (classification in ('positive','negative','mixed')),
  add constraint skill_effects_execution_check check (execution in ('root','child'));
alter table public.ability_effects
  add column classification text not null default 'positive',
  add column execution text not null default 'root',
  add constraint ability_effects_classification_check check (classification in ('positive','negative','mixed')),
  add constraint ability_effects_execution_check check (execution in ('root','child'));
alter table public.relic_effects
  add column classification text not null default 'positive',
  add column execution text not null default 'root',
  add constraint relic_effects_classification_check check (classification in ('positive','negative','mixed')),
  add constraint relic_effects_execution_check check (execution in ('root','child'));
alter table public.status_effects
  add column classification text not null default 'positive',
  add column execution text not null default 'root',
  add constraint status_effects_classification_check check (classification in ('positive','negative','mixed')),
  add constraint status_effects_execution_check check (execution in ('root','child'));

update public.effect_templates
set runtime_version=2,
    version=version+1,
    updated_at=now(),
    description=case effect_category
      when 'skill' then 'Adjusts HP, ATK, DEF, or SPEED when the Skill resolves.'
      else 'Adjusts HP, ATK, DEF, SPEED, Block cost, Swap cost, or Relic equip slots.'
    end,
    parameter_schema=jsonb_build_object(
      'type','object',
      'required',case when effect_category='skill' then jsonb_build_array('stat','value_mode','amount','chance','target') else jsonb_build_array('stat','value_mode','amount','target') end,
      'properties',jsonb_build_object(
        'stat',jsonb_build_object('type','string','enum',case when effect_category='skill' then jsonb_build_array('hp','atk','def','spd') else jsonb_build_array('hp','atk','def','spd','block_cost','swap_cost','relic_slots') end),
        'value_mode',jsonb_build_object('type','string','enum',jsonb_build_array('flat','percentage')),
        'amount',jsonb_build_object('type','number'),
        'chance',jsonb_build_object('type','number','minimum',0,'maximum',1),
        'target',jsonb_build_object('type','string'),
        'duration_type',jsonb_build_object('type','string'),
        'duration_value',jsonb_build_object('type','integer','minimum',1),
        'duration_clock',jsonb_build_object('type','string')
      )
    )
where runtime_kind='stat_modifier' and effect_category in ('skill','ability','relic');

with families(runtime_kind,name,description,icon_order,required_keys,properties) as (
  values
    ('shield_modifier','Shield Modifier','Grants, changes, sets, or destroys Shield durability.',30,
      '["target","operation","can_stack","replace_existing_shield","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"operation":{"type":"string","enum":["grant","add","subtract","set","destroy"]},"shield_value":{"type":"integer","minimum":0},"maximum_shield":{"type":"integer","minimum":0},"can_stack":{"type":"boolean"},"replace_existing_shield":{"type":"boolean"},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('reactive_trigger','Reactive Trigger','Runs child Effects after a configured combat event.',40,
      '["target","trigger_event","trigger_source","child_effect_ids","activation_chance","cooldown_turns","requires_hp_damage","requires_shield_damage"]'::jsonb,
      '{"target":{"type":"string"},"trigger_event":{"type":"string"},"trigger_source":{"type":"string"},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"activation_chance":{"type":"number","minimum":0,"maximum":1},"activation_limit":{"type":"integer","minimum":1},"activation_limit_scope":{"type":"string"},"cooldown_turns":{"type":"integer","minimum":0},"requires_hp_damage":{"type":"boolean"},"requires_shield_damage":{"type":"boolean"},"minimum_damage":{"type":"integer","minimum":0}}'::jsonb),
    ('direct_health_modifier','Direct Health Modifier','Heals, removes, sets, or drains HP separately from attack damage.',50,
      '["target","operation","value_type","value","can_defeat_target","affected_by_shield","affected_by_healing_modifiers","overhealing_behavior"]'::jsonb,
      '{"target":{"type":"string"},"operation":{"type":"string","enum":["heal","lose_hp","set_hp","drain"]},"value_type":{"type":"string"},"value":{"type":"number","minimum":0},"can_defeat_target":{"type":"boolean"},"affected_by_shield":{"type":"boolean"},"affected_by_healing_modifiers":{"type":"boolean"},"overhealing_behavior":{"type":"string","enum":["discard","convert"]},"overheal_effect_ids":{"type":"array","items":{"type":"string"}}}'::jsonb),
    ('retaliation','Retaliation','Runs child Effects against an attacker after a configured hit.',60,
      '["target","trigger_condition","retaliation_target","child_effect_ids","retaliation_value","scaling_source","scaling_ratio","activation_chance","can_defeat_attacker"]'::jsonb,
      '{"target":{"type":"string"},"trigger_condition":{"type":"string"},"retaliation_target":{"type":"string"},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"retaliation_value":{"type":"number","minimum":0},"scaling_source":{"type":"string"},"scaling_ratio":{"type":"number"},"activation_chance":{"type":"number","minimum":0,"maximum":1},"activation_limit":{"type":"integer","minimum":1},"can_defeat_attacker":{"type":"boolean"}}'::jsonb),
    ('damage_modifier','Damage Modifier','Modifies final damage dealt or received under configured conditions.',70,
      '["target","direction","modifier_type","modifier_value","applicable_source","applicable_target","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"direction":{"type":"string","enum":["dealt","received"]},"modifier_type":{"type":"string","enum":["flat","percentage"]},"modifier_value":{"type":"number"},"applicable_source":{"type":"string"},"applicable_target":{"type":"string"},"required_status_id":{"type":"string"},"minimum_final_damage":{"type":"integer","minimum":0},"maximum_final_damage":{"type":"integer","minimum":0},"usage_limit":{"type":"integer","minimum":1},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('conditional_effect','Conditional Effect','Runs and maintains child Effects according to a combat condition.',80,
      '["target","condition","comparison","condition_value","true_effect_ids","check_timing","remove_effects_when_false"]'::jsonb,
      '{"target":{"type":"string"},"condition":{"type":"string"},"comparison":{"type":"string"},"condition_value":{"type":"string"},"condition_ids":{"type":"string"},"true_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"false_effect_ids":{"type":"array","items":{"type":"string"}},"check_timing":{"type":"string"},"remove_effects_when_false":{"type":"boolean"}}'::jsonb),
    ('delayed_effect','Delayed Effect','Schedules child Effects after a count of future events.',90,
      '["target","delay_type","delay_value","child_effect_ids","target_tracking","cancel_condition","visible_countdown","repeat"]'::jsonb,
      '{"target":{"type":"string"},"delay_type":{"type":"string"},"delay_value":{"type":"integer","minimum":1},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"target_tracking":{"type":"string"},"cancel_condition":{"type":"string"},"visible_countdown":{"type":"boolean"},"repeat":{"type":"boolean"}}'::jsonb),
    ('effect_duration','Effect Duration','Applies one reusable lifecycle to child Effects.',100,
      '["target","child_effect_ids","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('effect_removal','Effect Removal','Removes configured Effect categories from one or more targets.',110,
      '["target","removal_category","selection_method","prevent_reapplication"]'::jsonb,
      '{"target":{"type":"string"},"removal_category":{"type":"string"},"maximum_effects_removed":{"type":"integer","minimum":1},"selection_method":{"type":"string"},"specific_effect_id":{"type":"string"},"prevent_reapplication":{"type":"boolean"},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('effect_copy','Effect Copy','Duplicates, steals, or mirrors Effects between Critters.',120,
      '["source","destination","copy_category","maximum_effects_copied","copy_method","copied_duration","copied_strength","allow_permanent_effects"]'::jsonb,
      '{"source":{"type":"string"},"destination":{"type":"string"},"copy_category":{"type":"string"},"maximum_effects_copied":{"type":"integer","minimum":1},"copy_method":{"type":"string","enum":["duplicate","steal","mirror"]},"copied_duration":{"type":"string"},"copied_strength":{"type":"number","minimum":0},"allow_permanent_effects":{"type":"boolean"}}'::jsonb),
    ('effect_transfer','Effect Transfer','Moves all or part of damage, healing, Shield, or Effects to a new target.',130,
      '["transferred_effect_type","original_target","new_target","transfer_percentage","original_target_retains_remainder","transfer_timing"]'::jsonb,
      '{"transferred_effect_type":{"type":"string"},"original_target":{"type":"string"},"new_target":{"type":"string"},"transfer_percentage":{"type":"number","minimum":0,"maximum":1},"original_target_retains_remainder":{"type":"boolean"},"activation_limit":{"type":"integer","minimum":1},"transfer_timing":{"type":"string"}}'::jsonb),
    ('damage_prevention','Damage Prevention','Prevents part or all of an incoming damage instance.',140,
      '["target","prevented_damage_source","prevention_type","trigger_requirement","consume_on_zero_damage","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"prevented_damage_source":{"type":"string"},"prevention_type":{"type":"string","enum":["flat","percentage","complete"]},"prevented_amount":{"type":"number","minimum":0},"usage_limit":{"type":"integer","minimum":1},"trigger_requirement":{"type":"string"},"consume_on_zero_damage":{"type":"boolean"},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('action_cost_modifier','Action Cost Modifier','Changes Skill Mana, Block, Swap, or other supported action costs.',150,
      '["target","cost_type","applicable_action","modifier_type","modifier_value","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"cost_type":{"type":"string"},"applicable_action":{"type":"string"},"skill_ids":{"type":"array","items":{"type":"string"}},"modifier_type":{"type":"string"},"modifier_value":{"type":"number"},"usage_limit":{"type":"integer","minimum":1},"minimum_cost":{"type":"integer","minimum":0},"maximum_cost":{"type":"integer","minimum":0},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('resource_gain_loss','Resource Gain and Loss','Gains, loses, sets, refunds, drains, or reserves a battle resource.',160,
      '["resource","operation","value","target_squad","can_exceed_maximum","trigger_timing"]'::jsonb,
      '{"resource":{"type":"string"},"resource_id":{"type":"string"},"operation":{"type":"string"},"value":{"type":"number","minimum":0},"target_squad":{"type":"string"},"can_exceed_maximum":{"type":"boolean"},"minimum_remaining_resource":{"type":"number","minimum":0},"trigger_timing":{"type":"string"}}'::jsonb),
    ('resource_conversion','Resource Conversion','Converts a resolved source value into child Effect output.',170,
      '["target","source_value","output_effect_ids","conversion_ratio","consume_source"]'::jsonb,
      '{"target":{"type":"string"},"source_value":{"type":"string"},"output_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"conversion_ratio":{"type":"number","exclusiveMinimum":0},"maximum_conversion":{"type":"number","minimum":0},"consume_source":{"type":"boolean"},"activation_limit":{"type":"integer","minimum":1}}'::jsonb),
    ('effect_scaling','Effect Scaling','Calculates a context value for child Effects from combat state.',180,
      '["target","child_effect_ids","base_value","scaling_source","scaling_ratio","recalculate_timing"]'::jsonb,
      '{"target":{"type":"string"},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"base_value":{"type":"number"},"scaling_source":{"type":"string"},"scaling_ratio":{"type":"number"},"minimum_value":{"type":"number"},"maximum_value":{"type":"number"},"recalculate_timing":{"type":"string"}}'::jsonb),
    ('repeating_effect','Repeating Effect','Runs child Effects repeatedly on a turn or round interval.',190,
      '["target","activation_timing","repeat_interval","child_effect_ids","initial_delay","remove_when_source_leaves_battle"]'::jsonb,
      '{"target":{"type":"string"},"activation_timing":{"type":"string"},"repeat_interval":{"type":"integer","minimum":1},"child_effect_ids":{"type":"array","items":{"type":"string"},"minItems":1},"number_of_activations":{"type":"integer","minimum":1},"initial_delay":{"type":"integer","minimum":0},"remove_when_source_leaves_battle":{"type":"boolean"}}'::jsonb),
    ('effect_immunity','Effect Immunity','Prevents configured Effect categories from being applied.',200,
      '["target","immune_effect_category","consume_on_attempt","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"immune_effect_category":{"type":"string"},"usage_limit":{"type":"integer","minimum":1},"consume_on_attempt":{"type":"boolean"},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb),
    ('effect_amplification','Effect Amplification','Increases or decreases Effects applied by or received by a target.',210,
      '["target","affected_effect_category","direction","modifier_type","modifier_value","duration_type","duration_clock"]'::jsonb,
      '{"target":{"type":"string"},"affected_effect_category":{"type":"string"},"direction":{"type":"string","enum":["applied","received"]},"modifier_type":{"type":"string","enum":["flat","percentage"]},"modifier_value":{"type":"number"},"duration_type":{"type":"string"},"duration_value":{"type":"integer","minimum":1},"duration_clock":{"type":"string"}}'::jsonb)
), owners(owner) as (values ('skill'),('ability'),('relic'))
insert into public.effect_templates(
  id,name,description,runtime_kind,runtime_version,allowed_owners,parameter_schema,ui_schema,
  is_runtime_supported,is_active,is_archived,version,sort_order,effect_category,created_at,updated_at
)
select owner||'-'||replace(runtime_kind,'_','-'),name,description,runtime_kind,1,array[owner],
  jsonb_build_object('type','object','required',required_keys,'properties',properties),
  jsonb_build_object('registry','effect-v2','iconOrder',icon_order),true,true,false,1,icon_order,owner,now(),now()
from families cross join owners
on conflict(id) do update set
  name=excluded.name,description=excluded.description,runtime_kind=excluded.runtime_kind,
  parameter_schema=excluded.parameter_schema,ui_schema=excluded.ui_schema,
  is_runtime_supported=true,is_active=true,is_archived=false,sort_order=excluded.sort_order,updated_at=now();

create table public.unlock_challenge_templates (
  id text primary key,
  name text not null,
  description text not null,
  challenge_category text not null check (challenge_category in ('global','tracked','shop')),
  progress_mode text not null check (progress_mode in ('derived','tracked_event','shop')),
  runtime_version integer not null check (runtime_version > 0),
  allowed_collectible_types text[] not null default array['critter','rollcaster','relic']::text[],
  parameter_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(parameter_schema)='object'),
  ui_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(ui_schema)='object'),
  is_active boolean not null default true,
  is_archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check (allowed_collectible_types <@ array['critter','rollcaster','relic']::text[] and cardinality(allowed_collectible_types)>0)
);

alter table public.unlock_challenge_templates enable row level security;
create policy unlock_challenge_templates_read_all on public.unlock_challenge_templates for select using (true);
grant select on public.unlock_challenge_templates to anon, authenticated;
grant all on public.unlock_challenge_templates to service_role;

insert into public.unlock_challenge_templates(id,name,description,challenge_category,progress_mode,runtime_version,allowed_collectible_types,parameter_schema,ui_schema,sort_order)
values
  ('own_collectible','Collectible Ownership','Own specific collectibles or an amount from one category.','global','derived',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["collectible_category","collectible_ids","required_amount","require_unique_collectibles","retroactive"],"properties":{"collectible_category":{"type":"string","enum":["critter","rollcaster","relic"]},"collectible_ids":{"type":"array","items":{"type":"string"}},"required_amount":{"type":"integer","minimum":1},"require_unique_collectibles":{"type":"boolean"},"retroactive":{"type":"boolean"}}}', '{"registry":"unlock-v2"}',10),
  ('level_up_critter','Level Up Critter','Require a selected Critter to reach a level.','global','derived',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["critter_id","required_level"],"properties":{"critter_id":{"type":"string"},"required_level":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',20),
  ('collection_diversity','Collection Diversity','Own Critters from one, several, or specific Elements.','global','derived',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["diversity_mode","required_per_type","require_unique_critters","retroactive"],"properties":{"diversity_mode":{"type":"string","enum":["amount_of_type","different_types","specific_types"]},"element_ids":{"type":"array","items":{"type":"string"}},"required_distinct_types":{"type":"integer","minimum":1},"required_element_ids":{"type":"array","items":{"type":"string"}},"required_per_type":{"type":"integer","minimum":1},"require_unique_critters":{"type":"boolean"},"retroactive":{"type":"boolean"}}}', '{"registry":"unlock-v2"}',30),
  ('knock_out_critters','Knock Out Critters','Track qualifying knockouts while selected.','tracked','tracked_event',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["target_mode","any_target","target_ids","required_amount"],"properties":{"target_mode":{"type":"string"},"any_target":{"type":"boolean"},"target_ids":{"type":"array","items":{"type":"string"}},"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',40),
  ('deal_damage','Deal Damage','Track qualifying enemy HP loss while selected.','tracked','tracked_event',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["target_mode","any_target","target_ids","required_amount"],"properties":{"target_mode":{"type":"string"},"any_target":{"type":"boolean"},"target_ids":{"type":"array","items":{"type":"string"}},"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',50),
  ('take_damage','Take Damage','Track qualifying friendly HP loss while selected.','tracked','tracked_event',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["target_mode","any_target","target_ids","required_amount"],"properties":{"target_mode":{"type":"string"},"any_target":{"type":"boolean"},"target_ids":{"type":"array","items":{"type":"string"}},"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',60),
  ('use_skill','Use Skill','Track qualifying Skill uses while selected.','tracked','tracked_event',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["target_mode","any_target","target_ids","required_amount"],"properties":{"target_mode":{"type":"string"},"any_target":{"type":"boolean"},"target_ids":{"type":"array","items":{"type":"string"}},"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',70),
  ('squad_composition','Squad Combat Composition','Win battles or clear Dungeons with a configured squad.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["completion_event","required_completions","all_squad_members_must_match","require_survival"],"properties":{"completion_event":{"type":"string","enum":["battle_win","dungeon_clear"]},"required_completions":{"type":"integer","minimum":1},"required_critter_ids":{"type":"array","items":{"type":"string"}},"required_element_ids":{"type":"array","items":{"type":"string"}},"required_matching_critters":{"type":"integer","minimum":1},"required_distinct_elements":{"type":"integer","minimum":1},"all_squad_members_must_match":{"type":"boolean"},"require_survival":{"type":"boolean"}}}', '{"registry":"unlock-v2"}',80),
  ('dungeon_clear','Dungeon Clear','Clear selected Dungeons with optional Relic rules.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["dungeon_selection","required_clears","has_relic_requirements"],"properties":{"dungeon_selection":{"type":"string"},"dungeon_ids":{"type":"array","items":{"type":"string"}},"minimum_dungeon_ids":{"type":"array","items":{"type":"string"}},"maximum_dungeon_ids":{"type":"array","items":{"type":"string"}},"required_clears":{"type":"integer","minimum":1},"has_relic_requirements":{"type":"boolean"},"relic_selection":{"type":"string"},"required_relic_ids":{"type":"array","items":{"type":"string"}},"required_relic_amount":{"type":"integer","minimum":1},"require_unique_relics":{"type":"boolean"},"require_relic_activation":{"type":"boolean"}}}', '{"registry":"unlock-v2"}',90),
  ('resource_spending','Resource Spending','Spend combat resources or shop currency.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["spending_context","resource_type","required_amount","tracking_scope"],"properties":{"spending_context":{"type":"string"},"resource_type":{"type":"string"},"custom_currency_id":{"type":"string"},"required_amount":{"type":"integer","minimum":1},"tracking_scope":{"type":"string"},"shop_ids":{"type":"array","items":{"type":"string"}},"dungeon_ids":{"type":"array","items":{"type":"string"}},"ability_ids":{"type":"array","items":{"type":"string"}},"critter_ids":{"type":"array","items":{"type":"string"}},"rollcaster_ids":{"type":"array","items":{"type":"string"}},"purchased_collectible_categories":{"type":"array","items":{"type":"string"}}}}', '{"registry":"unlock-v2"}',100),
  ('swap_action','Swap Action','Perform or benefit from successful paid Swaps.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["tracked_action","required_amount","tracking_scope"],"properties":{"tracked_action":{"type":"string"},"required_amount":{"type":"integer","minimum":1},"tracking_scope":{"type":"string"},"critter_ids":{"type":"array","items":{"type":"string"}},"element_ids":{"type":"array","items":{"type":"string"}},"dungeon_ids":{"type":"array","items":{"type":"string"}},"allowed_turns_after_swap":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',110),
  ('block_action','Block Action','Perform Blocks or achieve defensive results.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["tracked_action","required_amount","tracking_scope"],"properties":{"tracked_action":{"type":"string"},"required_amount":{"type":"integer","minimum":1},"tracking_scope":{"type":"string"},"critter_ids":{"type":"array","items":{"type":"string"}},"element_ids":{"type":"array","items":{"type":"string"}},"enemy_critter_ids":{"type":"array","items":{"type":"string"}},"enemy_element_ids":{"type":"array","items":{"type":"string"}},"dungeon_ids":{"type":"array","items":{"type":"string"}}}}', '{"registry":"unlock-v2"}',120),
  ('dice_roll','Dice Roll','Produce configured die or turn Mana results.','tracked','tracked_event',2,array['critter','rollcaster','relic'],
    '{"type":"object","required":["tracked_result","comparison","target_value","required_occurrences","include_modifiers","tracking_scope"],"properties":{"tracked_result":{"type":"string"},"comparison":{"type":"string"},"target_value":{"type":"integer","minimum":0},"required_occurrences":{"type":"integer","minimum":1},"include_modifiers":{"type":"boolean"},"tracking_scope":{"type":"string"},"die_types":{"type":"array","items":{"type":"string"}},"ability_ids":{"type":"array","items":{"type":"string"}},"critter_ids":{"type":"array","items":{"type":"string"}},"rollcaster_ids":{"type":"array","items":{"type":"string"}},"dungeon_ids":{"type":"array","items":{"type":"string"}}}}', '{"registry":"unlock-v2"}',130),
  ('shop_shards','Shop Shards','Unlock from collectible Shard ownership.','shop','shop',1,array['critter','rollcaster','relic'],
    '{"type":"object","required":["required_amount"],"properties":{"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',140),
  ('shop_relic','Shop Relic','Unlock a Relic from owned quantity.','shop','shop',1,array['relic'],
    '{"type":"object","required":["required_amount"],"properties":{"required_amount":{"type":"integer","minimum":1}}}', '{"registry":"unlock-v2"}',150);

alter table public.collectible_unlock_challenges
  add column parameters jsonb not null default '{}'::jsonb,
  add column display_text text,
  add constraint collectible_unlock_challenges_parameters_check check (jsonb_typeof(parameters)='object'),
  add constraint collectible_unlock_challenges_display_text_check check (display_text is null or btrim(display_text)<>'');

alter table public.collectible_unlock_challenges drop constraint collectible_unlock_challenges_challenge_type_check;
alter table public.collectible_unlock_challenges
  add constraint collectible_unlock_challenges_template_fkey foreign key(challenge_type) references public.unlock_challenge_templates(id) on update cascade;

update public.collectible_unlock_challenges c
set parameters=case c.challenge_type
  when 'own_collectible' then jsonb_build_object(
    'collectible_category',c.target_category,
    'collectible_ids',case when c.target_id is null then '[]'::jsonb else jsonb_build_array(c.target_id) end,
    'required_amount',coalesce(c.required_amount,1),
    'require_unique_collectibles',true,
    'retroactive',true)
  when 'level_up_critter' then jsonb_build_object('critter_id',c.target_id,'required_level',c.required_level)
  when 'knock_out_critters' then jsonb_build_object('target_mode',c.target_mode,'any_target',c.any_target,'target_ids',to_jsonb(c.target_ids),'required_amount',c.required_amount)
  when 'deal_damage' then jsonb_build_object('target_mode',c.target_mode,'any_target',c.any_target,'target_ids',to_jsonb(c.target_ids),'required_amount',c.required_amount)
  when 'take_damage' then jsonb_build_object('target_mode',c.target_mode,'any_target',c.any_target,'target_ids',to_jsonb(c.target_ids),'required_amount',c.required_amount)
  when 'use_skill' then jsonb_build_object('target_mode',c.target_mode,'any_target',c.any_target,'target_ids',to_jsonb(c.target_ids),'required_amount',c.required_amount)
  else jsonb_build_object('required_amount',c.required_amount)
end;

create or replace function public.validate_json_parameter_schema(p_schema jsonb,p_parameters jsonb,p_context text)
returns void
language plpgsql
set search_path=public
as $$
declare
  v_key text;
  v_spec jsonb;
  v_value jsonb;
  v_type text;
begin
  if jsonb_typeof(p_parameters)<>'object' then raise exception 'VALIDATION: % parameters must be an object',p_context; end if;
  for v_key in select jsonb_array_elements_text(coalesce(p_schema->'required','[]'::jsonb)) loop
    if not (p_parameters ? v_key) or p_parameters->v_key='null'::jsonb then
      raise exception 'VALIDATION: % requires parameter %',p_context,v_key;
    end if;
    if jsonb_typeof(p_parameters->v_key)='string' and btrim(p_parameters->>v_key)='' then
      raise exception 'VALIDATION: % requires non-empty parameter %',p_context,v_key;
    end if;
  end loop;

  for v_key,v_spec in select key,value from jsonb_each(coalesce(p_schema->'properties','{}'::jsonb)) loop
    if not (p_parameters ? v_key) or p_parameters->v_key='null'::jsonb then continue; end if;
    v_value:=p_parameters->v_key;
    v_type:=v_spec->>'type';
    if v_type='integer' and (jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)) then raise exception 'VALIDATION: %.% must be an integer',p_context,v_key; end if;
    if v_type='number' and jsonb_typeof(v_value)<>'number' then raise exception 'VALIDATION: %.% must be numeric',p_context,v_key; end if;
    if v_type='string' and jsonb_typeof(v_value)<>'string' then raise exception 'VALIDATION: %.% must be a string',p_context,v_key; end if;
    if v_type='boolean' and jsonb_typeof(v_value)<>'boolean' then raise exception 'VALIDATION: %.% must be boolean',p_context,v_key; end if;
    if v_type='array' and jsonb_typeof(v_value)<>'array' then raise exception 'VALIDATION: %.% must be an array',p_context,v_key; end if;
    if v_spec ? 'enum' and not (v_spec->'enum' @> jsonb_build_array(v_value)) then raise exception 'VALIDATION: %.% has an unsupported value',p_context,v_key; end if;
    if jsonb_typeof(v_value)='number' and v_spec ? 'minimum' and (v_value#>>'{}')::numeric<(v_spec->>'minimum')::numeric then raise exception 'VALIDATION: %.% is below its minimum',p_context,v_key; end if;
    if jsonb_typeof(v_value)='number' and v_spec ? 'exclusiveMinimum' and (v_value#>>'{}')::numeric<=(v_spec->>'exclusiveMinimum')::numeric then raise exception 'VALIDATION: %.% must exceed its minimum',p_context,v_key; end if;
    if jsonb_typeof(v_value)='number' and v_spec ? 'maximum' and (v_value#>>'{}')::numeric>(v_spec->>'maximum')::numeric then raise exception 'VALIDATION: %.% exceeds its maximum',p_context,v_key; end if;
    if jsonb_typeof(v_value)='array' and v_spec ? 'minItems' and jsonb_array_length(v_value)<(v_spec->>'minItems')::integer then raise exception 'VALIDATION: %.% needs more selections',p_context,v_key; end if;
    if jsonb_typeof(v_value)='array' and v_spec#>>'{items,type}'='string' and exists(select 1 from jsonb_array_elements(v_value) item where jsonb_typeof(item.value)<>'string') then raise exception 'VALIDATION: %.% must contain string IDs',p_context,v_key; end if;
  end loop;
end;
$$;

create or replace function public.validate_inline_effect_parameters(p_template_id text,p_parameters jsonb,p_owner text)
returns void
language plpgsql
set search_path=public
as $$
declare
  v_kind text;
  v_category text;
  v_schema jsonb;
  v_target text:=p_parameters->>'target';
begin
  select runtime_kind,effect_category,parameter_schema into v_kind,v_category,v_schema
  from public.effect_templates
  where id=p_template_id and is_active and not is_archived and is_runtime_supported;
  if v_kind is null then raise exception 'VALIDATION: inactive, unsupported, or missing effect template %',p_template_id; end if;
  if v_category<>p_owner then raise exception 'VALIDATION: template % does not belong to % effects',p_template_id,p_owner; end if;
  perform public.validate_json_parameter_schema(v_schema,p_parameters,p_template_id);

  if v_target is not null then
    if p_owner='skill' and v_target not in ('self','selected_ally','selected_enemy','all_allies','all_friendlies','all_enemies','target_enemies','attacker','defender','effect_owner') then raise exception 'VALIDATION: invalid Skill effect target'; end if;
    if p_owner='ability' and v_target not in ('all_friendlies','all_squad_friendlies','all_enemies','all_element_friendlies','all_element_enemies','active_ally','active_enemy','attacker','defender','effect_owner') then raise exception 'VALIDATION: invalid Ability effect target'; end if;
    if p_owner='relic' and v_target not in ('equipped_critter','equipped_allies','equipped_friendlies','all_squad_friendlies','all_enemies','active_ally','active_enemy','attacker','defender','effect_owner') then raise exception 'VALIDATION: invalid Relic effect target'; end if;
    if p_owner='status' and v_target not in ('status_holder','status_holder_allies','status_holder_friendlies','status_holder_enemies') then raise exception 'VALIDATION: invalid Status effect target'; end if;
  end if;

  if v_kind='stat_modifier' and p_parameters->>'stat'='relic_slots' and p_parameters->>'value_mode'<>'flat' then raise exception 'VALIDATION: Relic slots support flat modifiers only'; end if;
  if p_parameters ? 'status_id' and not exists(select 1 from public.statuses where id=p_parameters->>'status_id') then raise exception 'VALIDATION: Effect references an unknown Status'; end if;
  if p_parameters ? 'required_status_id' and nullif(p_parameters->>'required_status_id','') is not null and not exists(select 1 from public.statuses where id=p_parameters->>'required_status_id') then raise exception 'VALIDATION: Effect references an unknown required Status'; end if;
  if p_parameters ? 'element_ids' and exists(select 1 from jsonb_array_elements_text(p_parameters->'element_ids') id where not exists(select 1 from public.elements e where e.id=id.value)) then raise exception 'VALIDATION: element_ids contains an unknown Element'; end if;
  if p_parameters ? 'skill_ids' and exists(select 1 from jsonb_array_elements_text(p_parameters->'skill_ids') id where not exists(select 1 from public.skills s where s.id=id.value)) then raise exception 'VALIDATION: skill_ids contains an unknown Skill'; end if;
  if p_parameters ? 'resource_id' and nullif(p_parameters->>'resource_id','') is not null and not exists(select 1 from public.currencies c where c.id=p_parameters->>'resource_id') then raise exception 'VALIDATION: resource_id references an unknown Currency'; end if;
  if p_parameters ? 'minimum_final_damage' and p_parameters ? 'maximum_final_damage' and p_parameters->'minimum_final_damage'<>'null'::jsonb and p_parameters->'maximum_final_damage'<>'null'::jsonb and (p_parameters->>'minimum_final_damage')::numeric>(p_parameters->>'maximum_final_damage')::numeric then raise exception 'VALIDATION: minimum final damage cannot exceed maximum'; end if;
  if p_parameters ? 'minimum_cost' and p_parameters ? 'maximum_cost' and p_parameters->'minimum_cost'<>'null'::jsonb and p_parameters->'maximum_cost'<>'null'::jsonb and (p_parameters->>'minimum_cost')::numeric>(p_parameters->>'maximum_cost')::numeric then raise exception 'VALIDATION: minimum cost cannot exceed maximum'; end if;
  if p_parameters ? 'minimum_value' and p_parameters ? 'maximum_value' and p_parameters->'minimum_value'<>'null'::jsonb and p_parameters->'maximum_value'<>'null'::jsonb and (p_parameters->>'minimum_value')::numeric>(p_parameters->>'maximum_value')::numeric then raise exception 'VALIDATION: minimum scaled value cannot exceed maximum'; end if;
  if v_kind='shield_modifier' and coalesce((p_parameters->>'can_stack')::boolean,false) and coalesce((p_parameters->>'replace_existing_shield')::boolean,false) then raise exception 'VALIDATION: Shield cannot stack and replace at the same time'; end if;
end;
$$;

create or replace view public.combat_effects_v1 as
select 'skill'::text owner_type,e.skill_id owner_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id template_id,t.runtime_kind,t.runtime_version,e.classification,e.execution
from public.skill_effects e join public.effect_templates t on t.id=e.template_id
union all
select 'ability',e.ability_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version,e.classification,e.execution
from public.ability_effects e join public.effect_templates t on t.id=e.template_id
union all
select 'relic',e.relic_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version,e.classification,e.execution
from public.relic_effects e join public.effect_templates t on t.id=e.template_id
union all
select 'status',e.status_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version,e.classification,e.execution
from public.status_effects e join public.effect_templates t on t.id=e.template_id;

create or replace function public.assert_inline_effect_graph(p_owner text,p_owner_id text)
returns void
language plpgsql
set search_path=public
as $$
declare v_problem text;
begin
  with edges as (
    select parent.id parent_id,child_id.value child_id
    from public.combat_effects_v1 parent
    cross join lateral jsonb_each(parent.parameters) property
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(property.value)='array' then property.value else '[]'::jsonb end
    ) child_id
    where parent.owner_type=p_owner and parent.owner_id=p_owner_id
      and property.key in ('child_effect_ids','overheal_effect_ids','true_effect_ids','false_effect_ids','output_effect_ids')
      and jsonb_typeof(property.value)='array'
  )
  select format('%s -> %s',edge.parent_id,edge.child_id) into v_problem
  from edges edge
  left join public.combat_effects_v1 child on child.owner_type=p_owner and child.owner_id=p_owner_id and child.id=edge.child_id
  where child.id is null or child.execution<>'child'
  limit 1;
  if v_problem is not null then raise exception 'VALIDATION: Effect child reference is missing or not Child only: %',v_problem; end if;

  with recursive edges as (
    select parent.id parent_id,child_id.value child_id
    from public.combat_effects_v1 parent
    cross join lateral jsonb_each(parent.parameters) property
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(property.value)='array' then property.value else '[]'::jsonb end
    ) child_id
    where parent.owner_type=p_owner and parent.owner_id=p_owner_id
      and property.key in ('child_effect_ids','overheal_effect_ids','true_effect_ids','false_effect_ids','output_effect_ids')
      and jsonb_typeof(property.value)='array'
  ), walk(root_id,node_id,path,cycle,depth) as (
    select parent_id,child_id,array[parent_id],child_id=parent_id,1 from edges
    union all
    select walk.root_id,edge.child_id,walk.path||walk.node_id,edge.child_id=any(walk.path||walk.node_id),walk.depth+1
    from walk join edges edge on edge.parent_id=walk.node_id
    where not walk.cycle and walk.depth<17
  )
  select array_to_string(path||node_id,' -> ') into v_problem from walk where cycle or depth>16 limit 1;
  if v_problem is not null then raise exception 'VALIDATION: Effect dependency cycle or depth limit exceeded: %',v_problem; end if;
end;
$$;

create or replace function public.replace_inline_effects(p_owner text,p_owner_id text,p_effects jsonb)
returns void
language plpgsql
set search_path=public
as $$
declare
  v_table text;
  v_owner_column text;
  v_effect jsonb;
  v_order bigint;
  v_classification text;
  v_execution text;
begin
  v_table:=case p_owner when 'skill' then 'skill_effects' when 'ability' then 'ability_effects' when 'relic' then 'relic_effects' when 'status' then 'status_effects' end;
  v_owner_column:=case p_owner when 'skill' then 'skill_id' when 'ability' then 'ability_id' when 'relic' then 'relic_id' when 'status' then 'status_id' end;
  if v_table is null then raise exception 'VALIDATION: invalid inline Effect owner'; end if;
  if jsonb_typeof(coalesce(p_effects,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: Effects must be an array'; end if;
  execute format('delete from public.%I where %I=$1',v_table,v_owner_column) using p_owner_id;
  for v_effect,v_order in select value,ordinality from jsonb_array_elements(coalesce(p_effects,'[]'::jsonb)) with ordinality loop
    if nullif(btrim(v_effect->>'id'),'') is null or nullif(btrim(v_effect->>'name'),'') is null or nullif(btrim(v_effect->>'description'),'') is null then raise exception 'VALIDATION: every Effect needs ID, name, and description'; end if;
    v_classification:=coalesce(nullif(v_effect->>'classification',''),'positive');
    v_execution:=coalesce(nullif(v_effect->>'execution',''),'root');
    if v_classification not in ('positive','negative','mixed') then raise exception 'VALIDATION: invalid Effect classification'; end if;
    if v_execution not in ('root','child') then raise exception 'VALIDATION: invalid Effect execution mode'; end if;
    perform public.validate_inline_effect_parameters(v_effect->>'templateId',coalesce(v_effect->'parameters','{}'::jsonb),p_owner);
    execute format('insert into public.%I(%I,id,name,description,template_id,classification,execution,parameters,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',v_table,v_owner_column)
      using p_owner_id,v_effect->>'id',v_effect->>'name',v_effect->>'description',v_effect->>'templateId',v_classification,v_execution,coalesce(v_effect->'parameters','{}'::jsonb),(v_order-1)::integer;
  end loop;
  perform public.assert_inline_effect_graph(p_owner,p_owner_id);
end;
$$;

create or replace function public.challenge_catalog_reference_exists(p_kind text,p_id text)
returns boolean
language sql
stable
set search_path=public
as $$
  select case p_kind
    when 'critter' then exists(select 1 from public.critters where id=p_id)
    when 'rollcaster' then exists(select 1 from public.rollcasters where id=p_id)
    when 'relic' then exists(select 1 from public.relics where id=p_id)
    when 'element' then exists(select 1 from public.elements where id=p_id)
    when 'skill' then exists(select 1 from public.skills where id=p_id)
    when 'ability' then exists(select 1 from public.rollcaster_abilities where id=p_id)
    when 'dungeon' then exists(select 1 from public.dungeons where id=p_id)
    when 'currency' then exists(select 1 from public.currencies where id=p_id)
    when 'shop' then exists(select 1 from public.shop_entries where id::text=p_id)
    else false
  end;
$$;

create or replace function public.validate_collectible_unlock_challenge()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_template public.unlock_challenge_templates%rowtype;
  v_key text;
  v_kind text;
  v_id text;
  v_ids jsonb;
  v_goal bigint;
  v_max_owned bigint;
begin
  if not public.collectible_exists(new.collectible_type,new.collectible_id) then
    raise exception 'VALIDATION: unlock challenge owner does not exist';
  end if;
  select * into v_template from public.unlock_challenge_templates where id=new.challenge_type;
  if not found or not v_template.is_active or v_template.is_archived then
    raise exception 'VALIDATION: unlock Challenge Template % is unavailable',new.challenge_type;
  end if;
  if not (new.collectible_type=any(v_template.allowed_collectible_types)) then
    raise exception 'VALIDATION: % cannot be attached to % collectibles',new.challenge_type,new.collectible_type;
  end if;
  perform public.validate_json_parameter_schema(v_template.parameter_schema,new.parameters,new.challenge_type);

  -- Validate every typed reference list against the same catalogs used by the editor.
  for v_key,v_kind in
    select * from (values
      ('critter_ids','critter'),('required_critter_ids','critter'),('enemy_critter_ids','critter'),
      ('rollcaster_ids','rollcaster'),('required_relic_ids','relic'),
      ('element_ids','element'),('required_element_ids','element'),('enemy_element_ids','element'),
      ('skill_ids','skill'),('ability_ids','ability'),('dungeon_ids','dungeon'),
      ('minimum_dungeon_ids','dungeon'),('maximum_dungeon_ids','dungeon'),('shop_ids','shop')
    ) refs(parameter_key,catalog_kind)
  loop
    v_ids:=new.parameters->v_key;
    if jsonb_typeof(v_ids)='array' then
      for v_id in select jsonb_array_elements_text(v_ids) loop
        if not public.challenge_catalog_reference_exists(v_kind,v_id) then
          raise exception 'VALIDATION: %.% references missing % %',new.challenge_type,v_key,v_kind,v_id;
        end if;
      end loop;
    end if;
  end loop;
  if nullif(new.parameters->>'custom_currency_id','') is not null
    and not public.challenge_catalog_reference_exists('currency',new.parameters->>'custom_currency_id') then
    raise exception 'VALIDATION: % references missing Currency %',new.challenge_type,new.parameters->>'custom_currency_id';
  end if;

  -- Canonicalize the legacy columns. They remain populated for old game builds,
  -- while parameters is the authoritative v2 definition.
  if new.challenge_type='own_collectible' then
    new.target_category:=new.parameters->>'collectible_category';
    if new.target_category not in ('critter','rollcaster','relic') then raise exception 'VALIDATION: invalid collectible category'; end if;
    v_ids:=coalesce(new.parameters->'collectible_ids','[]'::jsonb);
    for v_id in select jsonb_array_elements_text(v_ids) loop
      if not public.collectible_exists(new.target_category,v_id) then raise exception 'VALIDATION: ownership target % is missing',v_id; end if;
      if new.target_category=new.collectible_type and v_id=new.collectible_id then raise exception 'VALIDATION: a collectible cannot require itself'; end if;
    end loop;
    new.target_id:=case when jsonb_array_length(v_ids)=1 then v_ids->>0 else null end;
    new.required_amount:=(new.parameters->>'required_amount')::bigint;
    if coalesce((new.parameters->>'require_unique_collectibles')::boolean,true) and jsonb_array_length(v_ids)>0
      and new.required_amount>jsonb_array_length(v_ids) then
      raise exception 'VALIDATION: ownership amount exceeds selected unique collectibles';
    end if;
    if new.target_category='relic' and jsonb_array_length(v_ids)>0 and not coalesce((new.parameters->>'require_unique_collectibles')::boolean,true) then
      select coalesce(sum(max_owned),0) into v_max_owned from public.relics where id in (select jsonb_array_elements_text(v_ids));
      if new.required_amount>v_max_owned then raise exception 'VALIDATION: ownership amount exceeds selected Relic capacity'; end if;
    end if;
    new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  elsif new.challenge_type='level_up_critter' then
    new.target_id:=new.parameters->>'critter_id';
    new.required_level:=(new.parameters->>'required_level')::integer;
    if not public.challenge_catalog_reference_exists('critter',new.target_id) then raise exception 'VALIDATION: Level Up Critter requires an existing Critter'; end if;
    if new.collectible_type='critter' and new.target_id=new.collectible_id then raise exception 'VALIDATION: a locked Critter cannot require its own level'; end if;
    new.target_category:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_amount:=null;
  elsif new.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
    new.target_mode:=new.parameters->>'target_mode';
    new.any_target:=coalesce((new.parameters->>'any_target')::boolean,false);
    new.target_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(new.parameters->'target_ids','[]'::jsonb))),'{}');
    new.required_amount:=(new.parameters->>'required_amount')::bigint;
    if new.challenge_type='use_skill' and new.target_mode not in ('skill','element') then raise exception 'VALIDATION: Use Skill mode must be Skill or Element'; end if;
    if new.challenge_type<>'use_skill' and new.target_mode not in ('species','element') then raise exception 'VALIDATION: Critter tracking mode must be Species or Element'; end if;
    if not new.any_target and cardinality(new.target_ids)=0 then raise exception 'VALIDATION: tracked challenge requires targets when Any is disabled'; end if;
    foreach v_id in array new.target_ids loop
      v_kind:=case new.target_mode when 'species' then 'critter' when 'element' then 'element' else 'skill' end;
      if not public.challenge_catalog_reference_exists(v_kind,v_id) then raise exception 'VALIDATION: tracked challenge references missing % %',v_kind,v_id; end if;
    end loop;
    if new.any_target then new.target_ids:='{}'; end if;
    new.target_category:=null; new.target_id:=null; new.required_level:=null;
  elsif new.challenge_type in ('shop_shards','shop_relic') then
    new.required_amount:=(new.parameters->>'required_amount')::bigint;
    if new.challenge_type='shop_relic' then
      if new.collectible_type<>'relic' then raise exception 'VALIDATION: Shop Relic is valid only for Relics'; end if;
      select max_owned into v_max_owned from public.relics where id=new.collectible_id;
      if new.required_amount>v_max_owned then raise exception 'VALIDATION: Shop Relic amount exceeds max_owned'; end if;
    end if;
    new.target_category:=null; new.target_id:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  else
    if new.challenge_type='collection_diversity' then
      if new.parameters->>'diversity_mode'='amount_of_type' then
        if jsonb_array_length(coalesce(new.parameters->'element_ids','[]'::jsonb))<>1 then raise exception 'VALIDATION: choose exactly one Element'; end if;
        v_goal:=(new.parameters->>'required_per_type')::bigint;
      elsif new.parameters->>'diversity_mode'='different_types' then
        v_goal:=(new.parameters->>'required_distinct_types')::bigint;
        if v_goal>(select count(*) from public.elements) then raise exception 'VALIDATION: distinct Element goal exceeds the Element catalog'; end if;
      elsif new.parameters->>'diversity_mode'='specific_types' then
        v_goal:=jsonb_array_length(coalesce(new.parameters->'required_element_ids','[]'::jsonb));
        if v_goal<1 then raise exception 'VALIDATION: choose at least one required Element'; end if;
      else raise exception 'VALIDATION: invalid diversity mode'; end if;
    elsif new.challenge_type='squad_composition' then
      v_goal:=(new.parameters->>'required_completions')::bigint;
      if jsonb_array_length(coalesce(new.parameters->'required_critter_ids','[]'::jsonb))=0
        and jsonb_array_length(coalesce(new.parameters->'required_element_ids','[]'::jsonb))=0
        and not (new.parameters ? 'required_matching_critters' and new.parameters->'required_matching_critters'<>'null'::jsonb)
        and not (new.parameters ? 'required_distinct_elements' and new.parameters->'required_distinct_elements'<>'null'::jsonb) then
        raise exception 'VALIDATION: configure at least one squad composition rule';
      end if;
    elsif new.challenge_type='dungeon_clear' then
      v_goal:=(new.parameters->>'required_clears')::bigint;
      if new.parameters->>'dungeon_selection'='specific_dungeon' and jsonb_array_length(coalesce(new.parameters->'dungeon_ids','[]'::jsonb))<>1 then raise exception 'VALIDATION: choose exactly one Dungeon'; end if;
      if new.parameters->>'dungeon_selection'='dungeon_id_range' and
        (jsonb_array_length(coalesce(new.parameters->'minimum_dungeon_ids','[]'::jsonb))<>1 or jsonb_array_length(coalesce(new.parameters->'maximum_dungeon_ids','[]'::jsonb))<>1) then raise exception 'VALIDATION: choose one minimum and maximum Dungeon'; end if;
      if coalesce((new.parameters->>'has_relic_requirements')::boolean,false)
        and new.parameters->>'relic_selection'='specific_relics'
        and jsonb_array_length(coalesce(new.parameters->'required_relic_ids','[]'::jsonb))=0 then raise exception 'VALIDATION: choose required Relics'; end if;
    elsif new.challenge_type in ('resource_spending','swap_action','block_action') then
      v_goal:=(new.parameters->>'required_amount')::bigint;
      if new.challenge_type='resource_spending' and new.parameters->>'resource_type'='custom_currency'
        and nullif(new.parameters->>'custom_currency_id','') is null then raise exception 'VALIDATION: choose a custom Currency'; end if;
    elsif new.challenge_type='dice_roll' then
      v_goal:=(new.parameters->>'required_occurrences')::bigint;
    else raise exception 'VALIDATION: unsupported Challenge Template %',new.challenge_type;
    end if;
    new.required_amount:=v_goal;
    new.target_category:=null; new.target_id:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create or replace function public.replace_collectible_unlocks(p_type text,p_id text,p_collect jsonb)
returns void
language plpgsql
set search_path=public
as $$
declare
  v_required integer:=coalesce((p_collect->>'requiredChallenges')::integer,0);
  v_challenge jsonb;
  v_parameters jsonb;
  v_order bigint;
  v_count integer;
  v_uuid uuid;
  v_ids uuid[]:='{}';
  v_existing_owner_type text;
  v_existing_owner_id text;
  v_before_definition jsonb;
  v_after_definition jsonb;
  v_affected_user uuid;
  v_affected_users uuid[]:='{}';
begin
  if p_type not in ('critter','rollcaster','relic') or not public.collectible_exists(p_type,p_id) then raise exception 'VALIDATION: invalid collectible owner'; end if;
  if p_collect is not null and jsonb_typeof(p_collect)<>'object' then raise exception 'VALIDATION: collect must be an object'; end if;
  if v_required<0 then raise exception 'VALIDATION: Required Challenges cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_collect->'challenges','[]'::jsonb))<>'array' then raise exception 'VALIDATION: challenges must be an array'; end if;

  select coalesce(array_agg(distinct tracked.user_id),'{}'::uuid[]) into v_affected_users
  from public.user_tracked_collectible_challenges tracked
  join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
  where challenge.collectible_type=p_type and challenge.collectible_id=p_id;

  insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges,updated_at,updated_by)
  values(p_type,p_id,0,now(),auth.uid())
  on conflict(collectible_type,collectible_id) do update set required_challenges=0,updated_at=now(),updated_by=auth.uid();

  for v_challenge in select value from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) loop
    if nullif(v_challenge->>'id','') is null then raise exception 'VALIDATION: every challenge needs a stable ID'; end if;
    v_uuid:=(v_challenge->>'id')::uuid;
    if v_uuid=any(v_ids) then raise exception 'VALIDATION: challenge IDs must be unique'; end if;
    v_ids:=array_append(v_ids,v_uuid);
  end loop;
  delete from public.collectible_unlock_challenges where collectible_type=p_type and collectible_id=p_id and not (id=any(v_ids));
  update public.collectible_unlock_challenges set gate_order=null where collectible_type=p_type and collectible_id=p_id and gate_order is not null;

  for v_challenge,v_order in select value,ordinality from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) with ordinality loop
    v_uuid:=(v_challenge->>'id')::uuid;
    v_parameters:=coalesce(v_challenge->'parameters','{}'::jsonb);
    -- Accept the v1 editor payload during a rolling deployment.
    if v_parameters='{}'::jsonb then
      v_parameters:=case v_challenge->>'type'
        when 'own_collectible' then jsonb_build_object('collectible_category',v_challenge->>'targetCategory','collectible_ids',case when nullif(v_challenge->>'targetId','') is null then '[]'::jsonb else jsonb_build_array(v_challenge->>'targetId') end,'required_amount',coalesce(nullif(v_challenge->>'requiredAmount','')::bigint,1),'require_unique_collectibles',true,'retroactive',true)
        when 'level_up_critter' then jsonb_build_object('critter_id',v_challenge->>'targetId','required_level',nullif(v_challenge->>'requiredLevel','')::integer)
        when 'knock_out_critters' then jsonb_build_object('target_mode',v_challenge->>'targetMode','any_target',coalesce((v_challenge->>'anyTarget')::boolean,false),'target_ids',coalesce(v_challenge->'targetIds','[]'::jsonb),'required_amount',nullif(v_challenge->>'requiredAmount','')::bigint)
        when 'deal_damage' then jsonb_build_object('target_mode',v_challenge->>'targetMode','any_target',coalesce((v_challenge->>'anyTarget')::boolean,false),'target_ids',coalesce(v_challenge->'targetIds','[]'::jsonb),'required_amount',nullif(v_challenge->>'requiredAmount','')::bigint)
        when 'take_damage' then jsonb_build_object('target_mode',v_challenge->>'targetMode','any_target',coalesce((v_challenge->>'anyTarget')::boolean,false),'target_ids',coalesce(v_challenge->'targetIds','[]'::jsonb),'required_amount',nullif(v_challenge->>'requiredAmount','')::bigint)
        when 'use_skill' then jsonb_build_object('target_mode',v_challenge->>'targetMode','any_target',coalesce((v_challenge->>'anyTarget')::boolean,false),'target_ids',coalesce(v_challenge->'targetIds','[]'::jsonb),'required_amount',nullif(v_challenge->>'requiredAmount','')::bigint)
        else jsonb_build_object('required_amount',coalesce(nullif(v_challenge->>'requiredAmount','')::bigint,1))
      end;
    end if;
    select collectible_type,collectible_id,to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order'-'display_text'
      into v_existing_owner_type,v_existing_owner_id,v_before_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid for update;
    if v_existing_owner_type is not null and (v_existing_owner_type<>p_type or v_existing_owner_id<>p_id) then raise exception 'VALIDATION: a challenge ID cannot move to another collectible'; end if;
    insert into public.collectible_unlock_challenges(id,collectible_type,collectible_id,challenge_type,parameters,display_text,sort_order,gate_order)
    values(v_uuid,p_type,p_id,v_challenge->>'type',v_parameters,nullif(btrim(v_challenge->>'displayText'),''),coalesce((v_challenge->>'sortOrder')::integer,(v_order-1)::integer),nullif(v_challenge->>'gateOrder','')::integer)
    on conflict(id) do update set challenge_type=excluded.challenge_type,parameters=excluded.parameters,display_text=excluded.display_text,
      sort_order=excluded.sort_order,gate_order=excluded.gate_order,updated_at=now();
    select to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order'-'display_text' into v_after_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid;
    if v_before_definition is not null and v_before_definition is distinct from v_after_definition then
      for v_affected_user in select user_id from public.user_tracked_collectible_challenges where challenge_id=v_uuid loop
        delete from public.user_tracked_collectible_challenges where user_id=v_affected_user and challenge_id=v_uuid;
        perform public.compact_user_tracking_slots(v_affected_user);
      end loop;
      delete from public.user_collectible_challenge_progress where challenge_id=v_uuid;
    end if;
    v_existing_owner_type:=null; v_existing_owner_id:=null; v_before_definition:=null; v_after_definition:=null;
  end loop;

  select count(*) into v_count from public.collectible_unlock_challenges where collectible_type=p_type and collectible_id=p_id;
  if v_required>v_count then raise exception 'VALIDATION: Required Challenges cannot exceed configured challenges'; end if;
  update public.collectible_unlock_requirements set required_challenges=v_required,updated_at=now(),updated_by=auth.uid() where collectible_type=p_type and collectible_id=p_id;
  perform public.assert_collectible_gate_integrity(p_type,p_id);
  foreach v_affected_user in array v_affected_users loop
    perform public.reconcile_user_gated_tracking_internal(v_affected_user);
    perform public.evaluate_collectible_unlock_internal(v_affected_user,p_type,p_id);
  end loop;
end;
$$;

create or replace function public.collectible_unlock_snapshot(p_type text,p_id text)
returns jsonb
language sql
stable
set search_path=public
as $$
  select jsonb_build_object(
    'requiredChallenges',coalesce(requirement.required_challenges,0),
    'challenges',coalesce((select jsonb_agg(jsonb_build_object(
      'id',challenge.id,'type',challenge.challenge_type,'parameters',challenge.parameters,'displayText',challenge.display_text,
      'targetCategory',challenge.target_category,'targetId',challenge.target_id,'targetMode',challenge.target_mode,
      'anyTarget',challenge.any_target,'targetIds',challenge.target_ids,'requiredAmount',challenge.required_amount,
      'requiredLevel',challenge.required_level,'sortOrder',challenge.sort_order,'gateOrder',challenge.gate_order
    ) order by challenge.sort_order,challenge.id)
    from public.collectible_unlock_challenges challenge where challenge.collectible_type=p_type and challenge.collectible_id=p_id),'[]'::jsonb)
  )
  from (select 1) seed left join public.collectible_unlock_requirements requirement
    on requirement.collectible_type=p_type and requirement.collectible_id=p_id;
$$;

create or replace function public.collectible_challenge_current(p_user uuid,p_challenge uuid)
returns bigint
language plpgsql
stable
set search_path=public
as $$
declare
  c public.collectible_unlock_challenges%rowtype;
  v_value bigint:=0;
  v_category text;
  v_ids text[];
  v_mode text;
  v_per_type integer;
begin
  select * into c from public.collectible_unlock_challenges where id=p_challenge;
  if not found then return 0; end if;
  if c.challenge_type='own_collectible' then
    v_category:=c.parameters->>'collectible_category';
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(c.parameters->'collectible_ids','[]'::jsonb))),'{}');
    if v_category='critter' then
      select count(*) into v_value from public.user_critters owned where owned.user_id=p_user and (cardinality(v_ids)=0 or owned.critter_id=any(v_ids));
    elsif v_category='rollcaster' then
      select count(*) into v_value from public.user_rollcasters owned where owned.user_id=p_user and (cardinality(v_ids)=0 or owned.rollcaster_id=any(v_ids));
    elsif coalesce((c.parameters->>'require_unique_collectibles')::boolean,true) then
      select count(*) into v_value from public.user_relic_inventory owned where owned.user_id=p_user and owned.discovered_at is not null and owned.quantity>0 and (cardinality(v_ids)=0 or owned.relic_id=any(v_ids));
    else
      select coalesce(sum(owned.quantity),0) into v_value from public.user_relic_inventory owned where owned.user_id=p_user and owned.discovered_at is not null and (cardinality(v_ids)=0 or owned.relic_id=any(v_ids));
    end if;
  elsif c.challenge_type='collection_diversity' then
    v_mode:=c.parameters->>'diversity_mode';
    v_per_type:=(c.parameters->>'required_per_type')::integer;
    if v_mode='amount_of_type' then
      select count(distinct owned.critter_id) into v_value
      from public.user_critters owned join public.critters critter on critter.id=owned.critter_id
      where owned.user_id=p_user and (critter.element_1_id=c.parameters->'element_ids'->>0 or critter.element_2_id=c.parameters->'element_ids'->>0);
    else
      v_ids:=case when v_mode='specific_types' then coalesce(array(select jsonb_array_elements_text(coalesce(c.parameters->'required_element_ids','[]'::jsonb))),'{}') else '{}'::text[] end;
      select count(*) into v_value from (
        select element_id from (
          select owned.critter_id,critter.element_1_id element_id from public.user_critters owned join public.critters critter on critter.id=owned.critter_id where owned.user_id=p_user
          union
          select owned.critter_id,critter.element_2_id from public.user_critters owned join public.critters critter on critter.id=owned.critter_id where owned.user_id=p_user and critter.element_2_id is not null
        ) owned_elements where cardinality(v_ids)=0 or element_id=any(v_ids) group by element_id having count(distinct critter_id)>=v_per_type
      ) qualified;
    end if;
  elsif c.challenge_type='level_up_critter' then
    select coalesce(level,0)::bigint into v_value from public.user_critters where user_id=p_user and critter_id=c.parameters->>'critter_id';
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill','squad_composition','dungeon_clear','resource_spending','swap_action','block_action','dice_roll') then
    select coalesce(progress,0) into v_value from public.user_collectible_challenge_progress where user_id=p_user and challenge_id=c.id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_shards' then
    select coalesce(quantity,0) into v_value from public.user_collectible_shards where user_id=p_user and collectible_type=c.collectible_type and collectible_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_relic' then
    select coalesce(quantity,0)::bigint into v_value from public.user_relic_inventory where user_id=p_user and relic_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  end if;
  return least(v_value,coalesce(public.collectible_challenge_goal(c.id),v_value));
end;
$$;

create or replace function public.get_collectible_shop_catalog()
returns jsonb
language sql
stable
set search_path=public
as $$
  select jsonb_build_object(
    'currencies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'asset_path',c.asset_path,'text_color',c.text_color,'is_default',c.is_default,'is_system',c.is_system,'sort_order',c.sort_order,'is_active',c.is_active,'is_archived',c.is_archived) order by c.is_default desc,c.sort_order,c.name,c.id) from public.currencies c where c.is_active and not c.is_archived),'[]'::jsonb),
    'challenge_templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'description',t.description,'challenge_category',t.challenge_category,'progress_mode',t.progress_mode,'runtime_version',t.runtime_version,'allowed_collectible_types',t.allowed_collectible_types,'parameter_schema',t.parameter_schema,'ui_schema',t.ui_schema,'version',t.version,'sort_order',t.sort_order) order by t.sort_order,t.id) from public.unlock_challenge_templates t where t.is_active and not t.is_archived),'[]'::jsonb),
    'requirements',coalesce((select jsonb_agg(jsonb_build_object('collectible_type',r.collectible_type,'collectible_id',r.collectible_id,'required_challenges',r.required_challenges) order by r.collectible_type,r.collectible_id) from public.collectible_unlock_requirements r),'[]'::jsonb),
    'challenges',coalesce((select jsonb_agg(jsonb_build_object('id',ch.id,'collectible_type',ch.collectible_type,'collectible_id',ch.collectible_id,'challenge_type',ch.challenge_type,'parameters',ch.parameters,'display_text',ch.display_text,'target_category',ch.target_category,'target_id',ch.target_id,'target_mode',ch.target_mode,'any_target',ch.any_target,'target_ids',ch.target_ids,'required_amount',case when ch.required_amount is null then null else ch.required_amount::text end,'required_level',ch.required_level,'sort_order',ch.sort_order,'gate_order',ch.gate_order) order by ch.collectible_type,ch.collectible_id,ch.sort_order,ch.id) from public.collectible_unlock_challenges ch),'[]'::jsonb),
    'shop_entries',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'shop_type',s.shop_type,'name',s.name,'description',s.description,'target_category',s.target_category,'target_id',s.target_id,'quantity',s.quantity,'currency_id',s.currency_id,'price',s.price::text,'sort_order',s.sort_order,'is_active',s.is_active,'is_archived',s.is_archived) order by s.shop_type,s.sort_order,s.name,s.id) from public.shop_entries s where s.is_active and not s.is_archived),'[]'::jsonb)
  );
$$;

comment on table public.unlock_challenge_templates is 'Versioned authoring and runtime contracts for collectible unlock Challenges.';
comment on column public.collectible_unlock_challenges.parameters is 'Authoritative template parameters. Legacy target columns are trigger-maintained compatibility projections.';
comment on column public.collectible_unlock_challenges.display_text is 'Optional authored UI text; null uses the game-generated localized description.';

commit;
