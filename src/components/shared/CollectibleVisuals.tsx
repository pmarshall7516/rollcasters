import { Sparkles } from "lucide-react";
import { byId, critterElementIds } from "../../lib/game.js";
import { catalogAssetPath } from "../../lib/asset-paths.js";
import type { AppData, Critter } from "../../lib/types.js";
import { AssetIcon } from "./Sprite.js";

export function CardSprite({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`card-sprite-frame ${className}`.trim()}>{children}</span>;
}

export function CardName({ data, name, critter }: { data: AppData; name: string; critter?: Critter }) {
  return (
    <span className="card-name-row">
      {critter && <CritterElementLogos data={data} critter={critter} />}
      <strong>{name}</strong>
    </span>
  );
}

export function CritterElementLogos({ data, critter }: { data: AppData; critter: Critter }) {
  const elements = critterElementIds(critter).map((elementId) => ({
    id: elementId,
    record: byId(data.catalog.elements, elementId),
  }));
  const label = elements
    .map(({ id, record }, index) => `Element ${index + 1}: ${record?.name ?? id}`)
    .join("; ");
  return (
    <span className="critter-element-logos" aria-label={label}>
      {elements.map(({ id, record }) => (
        <AssetIcon
          key={id}
          path={catalogAssetPath(data, "element", id, record?.asset_path, "icon")}
          alt=""
          fallback={<Sparkles size={18} />}
        />
      ))}
    </span>
  );
}
