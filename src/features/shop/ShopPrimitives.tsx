import { ShoppingBag } from "lucide-react";
import { formatAmount } from "../../lib/collectibles.js";

export function ShopProgressBar({ current, projected = current, goal, type, showCompletion = false }: { current: bigint; projected?: bigint; goal: bigint; type: "Shards" | "Relics"; showCompletion?: boolean }) {
  const complete = showCompletion && goal > 0n && current >= goal;
  const pct = goal > 0n ? Number((current * 100n) / goal) : 100;
  const clamped = Math.max(0, Math.min(100, pct));
  const projectedPct = goal > 0n ? Number(((projected > goal ? goal : projected) * 100n) / goal) : 100;
  const projectedClamped = Math.max(clamped, Math.min(100, projectedPct));
  return (
    <div className={`shard-progress ${complete ? "complete" : ""}`.trim()} role="progressbar" aria-label={`${type} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} aria-valuetext={`${formatAmount(current)} / ${formatAmount(goal)} ${type.toLocaleLowerCase()}${projectedClamped > clamped ? `, ${formatAmount(projected)} projected` : ""}${complete ? ", complete" : ""}`}>
      <div className="xp-bar"><i className="shop-progress-projected" style={{ left: `${clamped}%`, width: `${projectedClamped - clamped}%` }} /><span style={{ width: `${clamped}%` }} /></div>
      <p>{formatAmount(current)} / {formatAmount(goal)} {type}</p>
    </div>
  );
}

export function ShopEmptyState({ hasAuthoredEntries }: { hasAuthoredEntries: boolean }) {
  return <div className="shop-empty"><ShoppingBag size={34} /><h2>{hasAuthoredEntries ? "No shop entries match" : "No offers available yet"}</h2><p>{hasAuthoredEntries ? "Try a different name or collectible ID." : "Active offers authored in Content Studio will appear here."}</p></div>;
}

export function ShopQuantityControl({ label, quantity, max, disabled = false, onChange, onClick }: { label: string; quantity: number; max: number; disabled?: boolean; onChange: (quantity: number) => void; onClick?: (event: React.MouseEvent) => void }) {
  const safeMax = Math.max(1, Math.min(99, Math.trunc(max)));
  return <div className="shop-quantity-control" onClick={onClick}>
    <button type="button" aria-label={`Decrease ${label.toLocaleLowerCase()}`} disabled={disabled || quantity <= 1} onClick={() => onChange(Math.max(1, quantity - 1))}>−</button>
    <output className="shop-quantity-input" aria-label={label} aria-live="polite">{quantity}</output>
    <button type="button" aria-label={`Increase ${label.toLocaleLowerCase()}`} disabled={disabled || quantity >= safeMax} onClick={() => onChange(Math.min(safeMax, quantity + 1))}>+</button>
  </div>;
}
