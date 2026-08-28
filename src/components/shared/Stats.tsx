import type { ReactNode } from "react";
import type { StatBlock } from "../../lib/game.js";
import type { LoadoutStatKey, StatBreakdown } from "../../lib/loadout.js";
import type { XpProgress } from "../../lib/progression.js";
import { breakdownText, modificationTone, signedAmount } from "../../app/presentation.js";

function StatBreakdownLine({ label, breakdown, cost = false }: { label?: string; breakdown: StatBreakdown; cost?: boolean }) {
  const calculated = breakdown.base + breakdown.sources.reduce((sum, source) => sum + source.amount, 0);
  const finalText = breakdown.final !== undefined && breakdown.final !== calculated ? ` = ${breakdown.final} (Capped)` : "";
  return (
    <span className="stat-breakdown-line">
      {label && <strong>{label}: </strong>}
      <span>{breakdown.base} (Base)</span>
      {breakdown.sources.map((source, index) => <strong className={(cost ? source.amount < 0 : source.amount > 0) ? "positive" : "negative"} key={`${source.sourceName}-${index}`}> {signedAmount(source.amount)} ({source.sourceName})</strong>)}{finalText && <strong> {finalText}</strong>}
    </span>
  );
}

export function StatCell({ label, value, className = "", breakdowns = [], cost = false }: { label: string; value: ReactNode; className?: string; breakdowns?: Array<{ label?: string; breakdown: StatBreakdown }>; cost?: boolean }) {
  const modified = breakdowns.some((entry) => entry.breakdown.sources.length > 0);
  const accessibleBreakdown = breakdowns.map((entry) => breakdownText(entry.label ?? label, entry.breakdown)).join(". ");
  return (
    <span className={`stat-cell ${className} ${modified ? "modified" : ""}`.trim()} tabIndex={modified ? 0 : undefined} aria-label={modified ? `${label} ${accessibleBreakdown}` : undefined}>
      <span className="stat-label">{label}</span>{value}
      {modified && <span className="game-tooltip stat-breakdown" role="tooltip">{breakdowns.map((entry, index) => <StatBreakdownLine key={`${entry.label ?? label}-${index}`} label={entry.label} breakdown={entry.breakdown} cost={cost} />)}</span>}
    </span>
  );
}

export function StatGrid({ stats, compact, breakdowns = {} }: { stats: StatBlock; compact?: boolean; breakdowns?: Partial<Record<LoadoutStatKey, StatBreakdown>> }) {
  return (
    <div className={`stat-grid ${compact ? "compact" : ""}`}>
      <StatCell label="HP" value={<strong className={modificationTone(breakdowns.hp)}>{stats.hp}</strong>} breakdowns={breakdowns.hp ? [{ breakdown: breakdowns.hp }] : []} />
      <StatCell label="ATK" value={<strong className={modificationTone(breakdowns.atk)}>{stats.atk}</strong>} breakdowns={breakdowns.atk ? [{ breakdown: breakdowns.atk }] : []} />
      <StatCell label="DEF" value={<strong className={modificationTone(breakdowns.def)}>{stats.def}</strong>} breakdowns={breakdowns.def ? [{ breakdown: breakdowns.def }] : []} />
      <StatCell label="SPD" value={<strong className={modificationTone(breakdowns.spd)}>{stats.spd}</strong>} breakdowns={breakdowns.spd ? [{ breakdown: breakdowns.spd }] : []} />
      <StatCell
        label="Mana"
        className="mana-dice-stat"
        value={<strong><span className={modificationTone(breakdowns.diceMin)}>{stats.diceMin}</span>–<span className={modificationTone(breakdowns.diceMax)}>{stats.diceMax}</span></strong>}
        breakdowns={[
          ...(breakdowns.diceMin ? [{ label: "Minimum", breakdown: breakdowns.diceMin }] : []),
          ...(breakdowns.diceMax ? [{ label: "Maximum", breakdown: breakdowns.diceMax }] : []),
        ]}
      />
      <StatCell label="Block" value={<strong className={modificationTone(breakdowns.blockCost, true)}>{stats.blockCost}</strong>} cost breakdowns={breakdowns.blockCost ? [{ breakdown: breakdowns.blockCost }] : []} />
      <StatCell label="Swap" value={<strong className={modificationTone(breakdowns.swapCost, true)}>{stats.swapCost}</strong>} cost breakdowns={breakdowns.swapCost ? [{ breakdown: breakdowns.swapCost }] : []} />
      <StatCell label="Relics" value={<strong>{stats.relicSlots}</strong>} />
    </div>
  );
}

export function ProgressBar({ progress, inline = false, className = "" }: { progress: XpProgress; inline?: boolean; className?: string }) {
  const pct = progress.isMaxLevel || progress.needed <= 0 ? 100 : Math.min(100, Math.round((progress.current / progress.needed) * 100));
  const progressText = progress.isMaxLevel ? "Max level" : `${progress.current} / ${progress.needed} XP`;
  return (
    <div className={`xp-progress ${inline ? "xp-progress-inline" : ""} ${className}`.trim()}>
      <div className="xp-bar" role="progressbar" aria-label="Experience progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={progressText}><span style={{ width: `${pct}%` }} /></div>
      <p>{progressText}</p>
    </div>
  );
}
