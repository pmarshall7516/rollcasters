const STAT_LABELS: Record<string, string> = {
  hp: "HP",
  atk: "ATK",
  def: "DEF",
  spd: "SPD",
  dice: "mana",
  block_cost: "block cost",
  swap_cost: "swap cost",
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function amountText(effect: Record<string, unknown>): string {
  const amount = Number(effect.amount ?? 0);
  return effect.amount_type === "percent_max_hp" || effect.amount_type === "percent"
    ? percent(amount)
    : String(Math.abs(amount));
}

function statText(effect: Record<string, unknown>): string {
  const stat = String(effect.stat ?? "stat");
  return STAT_LABELS[stat] ?? stat.replace(/_/g, " ").toUpperCase();
}

function targetText(target: unknown): string {
  switch (String(target ?? "target")) {
    case "all_friendly_critters": return "All friendly Critters";
    case "all_enemy_critters": return "All enemy Critters";
    case "equipped_critter": return "The equipped Critter";
    case "self": return "The user";
    default: return "The target";
  }
}

function timingText(timing: unknown): string {
  switch (String(timing ?? "")) {
    case "end_of_turn": return " at the end of each turn";
    case "start_of_turn": return " at the start of each turn";
    case "before_action": return " before acting";
    default: return "";
  }
}

/** Converts catalog effect data into consistent player-facing copy. */
export function describeEffect(effect: Record<string, unknown> | null | undefined, fallback = ""): string {
  if (!effect || Object.keys(effect).length === 0) return fallback;
  const kind = String(effect.kind ?? "");
  const target = targetText(effect.target);
  const amount = amountText(effect);
  const stat = statText(effect);

  switch (kind) {
    case "damage_over_time":
      return `Deals ${amount} of maximum HP as damage${timingText(effect.timing)}.`;
    case "skip_chance":
      return `Has a ${percent(Number(effect.chance ?? 0))} chance to prevent the target from acting.`;
    case "heal":
    case "restore_hp":
      return `Restores ${amount}${effect.amount_type === "percent_max_hp" ? " of maximum" : ""} HP to ${target.toLowerCase()}.`;
    case "team_stat_bonus":
    case "stat_bonus":
    case "buff":
      return `${target} gain${target.startsWith("All ") ? "" : "s"} ${amount} ${stat}.`;
    case "equipped_critter_stat_bonus":
      return `The equipped Critter gains ${amount} ${stat}.`;
    case "stat_penalty":
    case "debuff":
      return `${target} lose${target.startsWith("All ") ? "" : "s"} ${amount} ${stat}.`;
    case "apply_status": {
      const status = String(effect.status_name ?? effect.status_id ?? "a status effect");
      const duration = effect.duration == null ? "" : ` for ${effect.duration} turns`;
      return effect.chance == null
        ? `${target} receives ${status}${duration}.`
        : `${target} has a ${percent(Number(effect.chance))} chance to receive ${status}${duration}.`;
    }
    case "shield":
      return `Grants ${target.toLowerCase()} a ${amount}-point shield${timingText(effect.timing)}.`;
    case "damage_reduction":
      return `${target} take${target.startsWith("All ") ? "" : "s"} ${amount} less damage.`;
    case "mana_gain":
      return `Gain ${amount} mana.`;
    default:
      return fallback || "Applies its listed effect.";
  }
}
