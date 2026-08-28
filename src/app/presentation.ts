import { xpProgress, type XpProgress } from "../lib/progression.js";
import type { ActionCostBreakdown } from "../lib/game.js";
import type { StatBreakdown } from "../lib/loadout.js";

export function modificationTone(breakdown?: StatBreakdown, cost = false): "positive" | "negative" | "mixed" | "" {
  if (!breakdown?.sources.length) return "";
  const positive = breakdown.sources.some((source) => cost ? source.amount < 0 : source.amount > 0);
  const negative = breakdown.sources.some((source) => cost ? source.amount > 0 : source.amount < 0);
  if (positive && negative) return "mixed";
  return positive ? "positive" : negative ? "negative" : "";
}

export function actionCostTone(breakdown?: ActionCostBreakdown): "positive" | "negative" | "mixed" | "" {
  if (!breakdown?.sources.length) return "";
  const discount = breakdown.sources.some((source) => source.amount < 0);
  const increase = breakdown.sources.some((source) => source.amount > 0);
  if (discount && increase) return "mixed";
  return discount ? "positive" : "negative";
}

export function costBreakdownText(label: string, breakdown: ActionCostBreakdown): string {
  return `${label}: ${breakdown.base} (Base) ${breakdown.sources.map((source) => `${signedAmount(source.amount)} (${source.sourceName})`).join(" ")}`;
}

export function signedAmount(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount}`;
}

export function breakdownText(label: string, breakdown: StatBreakdown): string {
  const finalText = breakdown.final !== undefined && breakdown.final !== breakdown.base + breakdown.sources.reduce((sum, source) => sum + source.amount, 0)
    ? ` = ${breakdown.final} (Capped)`
    : "";
  return `${label}: ${breakdown.base} (Base) ${breakdown.sources.map((source) => `${signedAmount(source.amount)} (${source.sourceName})`).join(" ")}${finalText}`;
}

export type XpThreshold = {
  level: number;
  total_required_xp: number;
};

export function xpStateAtTotal(progression: XpThreshold[], totalXp: number): { level: number; progress: XpProgress } {
  const ordered = [...progression].sort((left, right) => left.level - right.level);
  const level = [...ordered].reverse().find((row) => row.total_required_xp <= totalXp)?.level ?? 1;
  return { level, progress: xpProgress(ordered, level, totalXp) };
}

export type XpFillSegment = {
  kind: "fill";
  from: number;
  to: number;
  /** Keep showing this level (and fill toward 100%) even as total XP reaches the next threshold. */
  displayLevel: number;
  fillsToLevelUp: boolean;
};

export type XpLevelUpSegment = {
  kind: "levelUp";
  fromLevel: number;
  toLevel: number;
};

export type XpAnimSegment = XpFillSegment | XpLevelUpSegment;

export type XpCardVisual = {
  level: number;
  pct: number;
  progressText: string;
  showLevelUp: boolean;
  snapBar: boolean;
};

export function orderedXpThresholds(progression: XpThreshold[]): XpThreshold[] {
  return [...progression].sort((left, right) => left.level - right.level);
}

export function buildXpAnimSegments(progression: XpThreshold[], startingTotal: number, finalTotal: number): XpAnimSegment[] {
  const ordered = orderedXpThresholds(progression);
  const crossed = ordered.filter((row) => row.total_required_xp > startingTotal && row.total_required_xp <= finalTotal);
  const segments: XpAnimSegment[] = [];
  let cursor = startingTotal;

  for (const row of crossed) {
    const fromLevel = xpStateAtTotal(ordered, Math.max(0, row.total_required_xp - 1)).level;
    segments.push({
      kind: "fill",
      from: cursor,
      to: row.total_required_xp,
      displayLevel: fromLevel,
      fillsToLevelUp: true,
    });
    segments.push({ kind: "levelUp", fromLevel, toLevel: row.level });
    cursor = row.total_required_xp;
  }

  if (cursor < finalTotal) {
    segments.push({
      kind: "fill",
      from: cursor,
      to: finalTotal,
      displayLevel: xpStateAtTotal(ordered, cursor).level,
      fillsToLevelUp: false,
    });
  }

  return segments;
}

export function visualForXpTotal(progression: XpThreshold[], totalXp: number, levelOverride?: number): Omit<XpCardVisual, "showLevelUp" | "snapBar"> {
  const ordered = orderedXpThresholds(progression);
  const state = levelOverride == null
    ? xpStateAtTotal(ordered, totalXp)
    : { level: levelOverride, progress: xpProgress(ordered, levelOverride, totalXp) };
  const pct = state.progress.isMaxLevel || state.progress.needed <= 0
    ? 100
    : Math.min(100, Math.round((state.progress.current / state.progress.needed) * 100));
  const progressText = state.progress.isMaxLevel
    ? "Max level"
    : `${state.progress.current} / ${state.progress.needed} XP`;
  return { level: state.level, pct, progressText };
}

export function visualForLevelUpHold(progression: XpThreshold[], fromLevel: number): Omit<XpCardVisual, "showLevelUp" | "snapBar"> {
  const ordered = orderedXpThresholds(progression);
  const progress = xpProgress(ordered, fromLevel, Number.MAX_SAFE_INTEGER);
  return {
    level: fromLevel,
    pct: 100,
    progressText: progress.isMaxLevel || progress.needed <= 0 ? "Max level" : `${progress.needed} / ${progress.needed} XP`,
  };
}
