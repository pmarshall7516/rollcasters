import { byId, critterStats } from "../../lib/game.js";
import { preferredAssetPath } from "../../lib/asset-paths.js";
import type { AppData, Critter, Rollcaster } from "../../lib/types.js";
import { CardName, CardSprite } from "../../components/shared/CollectibleVisuals.js";
import { EffectList } from "../../components/shared/Effects.js";
import { Sprite } from "../../components/shared/Sprite.js";
import { StatGrid } from "../../components/shared/Stats.js";

export function StarterRollcasterScreen({ data, onSelect }: { data: AppData; onSelect: (rollcasterId: string) => void }) {
  const starterRollcasters = data.catalog.starterRollcasterOptions
    .filter((option) => option.is_active)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((option) => byId(data.catalog.rollcasters, option.rollcaster_id))
    .filter((rollcaster): rollcaster is Rollcaster => Boolean(rollcaster));

  return (
    <section className="screen-stack starter-selection-screen">
      <div className="screen-heading">
        <p className="eyebrow">Step 1 of 2</p>
        <h1>Choose your starting Rollcaster</h1>
        <p>Your Rollcaster leads the squad. Review each starter Ability before making your one-time choice.</p>
      </div>
      <div className="starter-rollcaster-row">
        {starterRollcasters.map((rollcaster) => {
          const starterUnlock = data.catalog.rollcasterAbilityUnlocks
            .filter((unlock) =>
              unlock.rollcaster_id === rollcaster.id &&
              unlock.unlock_level === 1 &&
              unlock.unlock_cost === 0
            )
            .sort((left, right) =>
              Number(right.is_default) - Number(left.is_default) ||
              left.sort_order - right.sort_order ||
              left.ability_id.localeCompare(right.ability_id)
            )[0];
          const ability = starterUnlock
            ? byId(data.catalog.rollcasterAbilities, starterUnlock.ability_id)
            : undefined;
          const effects = ability ? data.catalog.effectsByAbility[ability.id] ?? [] : [];
          return (
            <button
              key={rollcaster.id}
              className="catalog-card starter-rollcaster-card"
              onClick={() => onSelect(rollcaster.id)}
              aria-label={`Choose ${rollcaster.name} as your starting Rollcaster`}
            >
              <span className="collectible-id">{rollcaster.id}</span>
              <CardSprite className="rollcaster-sprite-frame starter-rollcaster-sprite">
                <Sprite
                  name={rollcaster.name}
                  element="basic"
                  assetPath={preferredAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path, ["portrait", "card", "thumb"])}
                  size="large"
                  fit="portrait"
                />
              </CardSprite>
              <CardName data={data} name={rollcaster.name} />
              <p className="starter-rollcaster-description">{rollcaster.description}</p>
              <span className="starter-ability-card">
                <span className="eyebrow">Starter Ability</span>
                <strong>{ability?.name ?? "No starter Ability authored"}</strong>
                <span>{ability?.description ?? "This Rollcaster needs a level-1 starter Ability."}</span>
                {effects.length > 0 && <EffectList effects={effects} className="starter-ability-effects" />}
              </span>
              <span className="primary-button full-width">Choose {rollcaster.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function StarterScreen({ data, onSelect }: { data: AppData; onSelect: (critterId: string) => void }) {
  const starterCritters = data.catalog.starterOptions
    .filter((option) => option.is_active)
    .map((option) => byId(data.catalog.critters, option.critter_id))
    .filter((critter): critter is Critter => Boolean(critter));

  return (
    <section className="screen-stack">
      <div className="screen-heading">
        <p className="eyebrow">Step 2 of 2</p>
        <h1>Choose your starter critter</h1>
        <p>This choice creates your first squad member and cannot be repeated.</p>
      </div>
      <div className="starter-row">
        {starterCritters.map((critter) => (
          <button key={critter.id} className="catalog-card starter-card" onClick={() => onSelect(critter.id)}>
            <span className="collectible-id">{critter.id}</span>
            <CardSprite><Sprite name={critter.name} element={critter.element_1_id} assetPath={preferredAssetPath(data, "critter", critter.id, critter.asset_path, ["card", "thumb"])} size="large" /></CardSprite>
            <CardName data={data} name={critter.name} critter={critter} />
            <StatGrid stats={critterStats(data.catalog, critter, 1)} compact />
            <span className="primary-button full-width">Choose {critter.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
