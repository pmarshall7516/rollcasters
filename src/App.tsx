import { useEffect, useRef, useState } from "react";
import {
  Check,
  Coins,
  Gem,
  LogOut,
  Play,
  Shield,
  Sparkles,
  Swords,
  UserRound,
  X,
} from "lucide-react";
import {
  ensureUserGameState,
  getGameAssetUrl,
  getSession,
  hasSupabaseConfig,
  loadAppData,
  resolveDungeonRun,
  setActiveRollcaster,
  setCritterRelicSlot,
  setCritterSkillSlot,
  setRollcasterAbilitySlot,
  setSquadSlot,
  selectStarterCritter,
  signIn,
  signOut,
  signUp,
  startDungeonRun,
  supabase,
} from "./lib/supabase";
import {
  byId,
  createInitialCombatState,
  critterStats,
  isSingleTarget,
  resolveTurn,
  skillTargets,
  squadCritters,
  startTurn,
  type CombatState,
} from "./lib/game";
import type {
  AppData,
  CombatAction,
  Critter,
  Dungeon,
  PlayerState,
  Relic,
  Skill,
  UserCritter,
  UserRollcaster,
  View,
} from "./lib/types";
import { describeEffect } from "./lib/presentation";

type CollectionTab = "rollcasters" | "critters" | "relics";

export function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [view, setView] = useState<View>("auth");
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("critters");
  const [detail, setDetail] = useState<{ type: "critter" | "rollcaster" | "relic"; id: string } | null>(null);
  const [combat, setCombat] = useState<CombatState | null>(null);

  async function refresh(nextView?: View) {
    if (!hasSupabaseConfig) return;
    setLoading(true);
    setError(null);
    try {
      await ensureUserGameState();
      const loaded = await loadAppData();
      setData(loaded);
      if (nextView) {
        setView(nextView);
      } else {
        setView(loaded.player?.profile.starter_selected_at ? "home" : "starter");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load game data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setSessionReady(true);
      return;
    }

    getSession()
      .then(async (session) => {
        setIsAuthed(Boolean(session));
        if (session) await refresh();
      })
      .catch((err) => setError(err.message))
      .finally(() => setSessionReady(true));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      if (!session) {
        setData(null);
        setView("auth");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        view,
        loading,
        authed: isAuthed,
        starterSelected: data?.player?.profile.starter_selected_at != null,
        coins: data?.player?.profile.coins ?? 0,
        combat: combat
          ? {
              phase: combat.phase,
              turn: combat.turn,
              playerMana: combat.playerMana,
              opponentMana: combat.opponentMana,
              player: combat.playerUnits.map((unit) => ({
                name: unit.name,
                hp: unit.hp,
                active: unit.active,
                roll: unit.manaRoll,
              })),
              opponents: combat.opponentUnits.map((unit) => ({
                name: unit.name,
                hp: unit.hp,
                active: unit.active,
                roll: unit.manaRoll,
              })),
            }
          : null,
      });
    window.advanceTime = () => undefined;
  }, [view, loading, isAuthed, data, combat]);

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!sessionReady) return <Shell><Loading message="Checking session..." /></Shell>;
  if (!isAuthed) return <Shell><AuthScreen onAuthed={() => refresh()} error={error} setError={setError} /></Shell>;
  if (!data?.player) return <Shell><Loading message="Loading Rollcasters..." error={error} /></Shell>;

  return (
    <Shell>
      <TopBar
        data={data}
        player={data.player}
        onHome={() => setView(data.player?.profile.starter_selected_at ? "home" : "starter")}
        onSignOut={async () => {
          await signOut();
          setIsAuthed(false);
        }}
      />
      {error && <div className="notice error">{error}</div>}
      {loading && <div className="notice">Loading latest game state...</div>}
      {view === "starter" && (
        <StarterScreen
          data={data}
          onSelect={async (critterId) => {
            setLoading(true);
            try {
              await selectStarterCritter(critterId);
              await refresh("home");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Starter selection failed.");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {view === "home" && (
        <HomeScreen
          data={data}
          onCollection={() => setView("collection")}
          onPlay={() => setView("play")}
          onRefresh={() => refresh("home")}
        />
      )}
      {view === "collection" && (
        <CollectionScreen
          data={data}
          tab={collectionTab}
          setTab={setCollectionTab}
          detail={detail}
          setDetail={setDetail}
          onBack={() => setView("home")}
        />
      )}
      {view === "play" && (
        <PlayScreen
          data={data}
          onBack={() => setView("home")}
          onStart={async (dungeon) => {
            setLoading(true);
            try {
              const runId = await startDungeonRun(dungeon.id);
              setCombat(createInitialCombatState(data.catalog, data.player!, dungeon, runId));
              setView("combat");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to start dungeon.");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {view === "combat" && combat && (
        <CombatScreen
          data={data}
          combat={combat}
          setCombat={setCombat}
          onBack={() => setView("play")}
          onWin={async () => {
            if (!combat.runId) return;
            setLoading(true);
            try {
              await resolveDungeonRun(combat.runId);
              await refresh("rewards");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to apply rewards.");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {view === "rewards" && combat && <RewardScreen data={data} combat={combat} onContinue={() => { setCombat(null); setView("home"); }} />}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <div className="world-glow" />
      {children}
    </main>
  );
}

function SetupScreen() {
  return (
    <Shell>
      <section className="setup-panel">
        <BrandLogo />
        <p>The app is built, but Supabase browser credentials are not configured yet.</p>
        <pre>{`VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY`}</pre>
        <p>Add these to `.env`, run the SQL in `supabase/migrations`, then restart the dev server.</p>
      </section>
    </Shell>
  );
}

function Loading({ message, error }: { message: string; error?: string | null }) {
  return (
    <section className="setup-panel">
      <h1>{message}</h1>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}

function AuthScreen({
  onAuthed,
  error,
  setError,
}: {
  onAuthed: () => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const hasSession = await signUp(email, password, username || email.split("@")[0]);
        if (!hasSession) {
          setConfirmationEmail(email);
          return;
        }
      } else {
        await signIn(email, password);
      }
      await onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <header className="auth-brand"><BrandLogo /></header>
      <form className="auth-card" onSubmit={submit}>
        {confirmationEmail ? (
          <div className="confirmation-message">
            <h2>Check your email</h2>
            <p>We sent a confirmation link to <strong>{confirmationEmail}</strong>.</p>
            <button type="button" className="primary-button" onClick={() => { setConfirmationEmail(null); setMode("login"); }}>
              Return to log in
            </button>
          </div>
        ) : <>
        <h2>{mode === "login" ? "Log in" : "Sign up"}</h2>
        {mode === "signup" && (
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ShanksFan" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={6}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" disabled={busy}>
          {busy ? "Working..." : mode === "login" ? "Log in" : "Sign up"}
        </button>
        <button type="button" className="link-button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>
        </>}
      </form>
    </section>
  );
}

function TopBar({
  data,
  player,
  onHome,
  onSignOut,
}: {
  data: AppData;
  player: PlayerState;
  onHome: () => void;
  onSignOut: () => void;
}) {
  const coinAssetPath = findAssetPath(data, "currency", "coins");
  const logoPath = findAssetPath(data, "ui", "logo", "full") ?? "ui/logo.png";
  return (
    <header className="top-bar">
      <button type="button" className="brand-home-button" onClick={onHome} aria-label="Rollcasters home">
        <BrandLogo path={logoPath} compact />
      </button>
      <div className="account-cluster">
        <div className="coin-pill">
          <AssetIcon path={coinAssetPath} alt="Coins" fallback={<Coins size={17} />} />
          {player.profile.coins}
        </div>
        <div className="user-pill">
          <UserRound size={17} />
          {player.profile.username}
        </div>
        <button className="icon-button" onClick={onSignOut} aria-label="Log out">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

function BrandLogo({ path = "ui/logo.png", compact = false }: { path?: string | null; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = hasSupabaseConfig && path && !failed ? getGameAssetUrl(path) : null;
  useEffect(() => { setFailed(false); setLoaded(false); }, [path]);
  return <span className="brand-lockup">
    {(!src || !loaded) && <span className={`brand-logo-fallback ${compact ? "signed-in" : ""}`} aria-label="Rollcasters">Rollcasters</span>}
    {src && <img className={`brand-logo ${compact ? "signed-in" : ""} ${loaded ? "loaded" : "loading"}`} src={src} alt="Rollcasters" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
  </span>;
}

function StarterScreen({ data, onSelect }: { data: AppData; onSelect: (critterId: string) => void }) {
  const starterCritters = data.catalog.starterOptions
    .filter((option) => option.is_active)
    .map((option) => byId(data.catalog.critters, option.critter_id))
    .filter((critter): critter is Critter => Boolean(critter));

  return (
    <section className="screen-stack">
      <div className="screen-heading">
        <h1>Choose your starter critter</h1>
        <p>This choice creates your first squad member and cannot be repeated.</p>
      </div>
      <div className="starter-row">
        {starterCritters.map((critter) => (
          <button key={critter.id} className="catalog-card starter-card" onClick={() => onSelect(critter.id)}>
            <span className="collectible-id">{critter.id}</span>
            <CardSprite><Sprite name={critter.name} element={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} size="large" /></CardSprite>
            <CardName data={data} name={critter.name} elementId={critter.element_id} />
            <StatGrid stats={critterStats(data.catalog, critter, 1)} compact />
            <span className="primary-button full-width">Choose {critter.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type EquipTarget =
  | { type: "critter"; slotIndex: number }
  | { type: "skill"; slotIndex: number; owned: UserCritter }
  | { type: "relic"; slotIndex: number; owned: UserCritter }
  | { type: "ability"; slotIndex: number; owned: UserRollcaster }
  | { type: "rollcaster"; slotIndex: number };

function HomeScreen({ data, onCollection, onPlay, onRefresh }: { data: AppData; onCollection: () => void; onPlay: () => void; onRefresh: () => Promise<void> }) {
  const player = data.player!;
  const activeRollcaster = player.rollcasters.find((row) => row.id === player.profile.active_rollcaster_id) ?? player.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, activeRollcaster?.rollcaster_id);
  const squad = player.squadSlots.slice().sort((a, b) => a.slot_index - b.slot_index);
  const [equipTarget, setEquipTarget] = useState<EquipTarget | null>(null);
  const [equipError, setEquipError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const abilityCount = unlockedAbilitySlotCount(data, activeRollcaster);

  async function equip(operation: () => Promise<void>) {
    setSaving(true);
    setEquipError(null);
    try {
      await operation();
      await onRefresh();
      setEquipTarget(null);
    } catch (err) {
      setEquipError(err instanceof Error ? err.message : "Unable to update loadout.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <><section className="home-layout">
      <aside className="rollcaster-panel">
        <p className="eyebrow">Active Rollcaster</p>
        <button className="portrait-button" onClick={() => setEquipTarget({ type: "rollcaster", slotIndex: 1 })} aria-label="Choose active Rollcaster">
          <SpriteFrame size="hero" className="rollcaster-sprite-frame"><Sprite name={rollcaster?.name ?? "Shanks"} element="basic" assetPath={catalogAssetPath(data, "rollcaster", rollcaster?.id, rollcaster?.asset_path)} size="hero" fit="portrait" /></SpriteFrame>
        </button>
        <h1>{rollcaster?.name ?? "Unknown"}</h1>
        <p>Level {activeRollcaster?.level ?? 1}</p>
        <div className="ability-list" aria-label="Rollcaster abilities">
          {Array.from({ length: abilityCount }, (_, index) => {
            const slotIndex = index + 1;
            const row = player.abilitySlots.find((slot) => slot.user_rollcaster_id === activeRollcaster?.id && slot.slot_index === slotIndex);
            const ability = byId(data.catalog.rollcasterAbilities, row?.ability_id);
            return <AbilitySlot key={slotIndex} ability={ability} slotIndex={slotIndex} onClick={() => activeRollcaster && setEquipTarget({ type: "ability", slotIndex, owned: activeRollcaster })} />;
          })}
        </div>
      </aside>

      <nav className="main-actions" aria-label="Main menu">
        <button className="menu-button play-button" onClick={onPlay}>
          <Play size={24} />
          Play
        </button>
        <button className="menu-button" onClick={onCollection}>
          <Gem size={24} />
          Collection
        </button>
        <button className="menu-button muted" disabled>
          <Coins size={24} />
          Shop
        </button>
      </nav>

      <section className="squad-panel">
        {squad.map((slot) => {
          const owned = player.critters.find((critter) => critter.id === slot.user_critter_id);
          return (
            <CritterLoadoutSlot
              key={slot.slot_index}
              data={data}
              slotIndex={slot.slot_index}
              owned={owned}
              onEquip={setEquipTarget}
            />
          );
        })}
      </section>
    </section>
    {equipTarget && <EquipDialog data={data} target={equipTarget} saving={saving} error={equipError} onClose={() => setEquipTarget(null)} onEquip={equip} />}
    </>
  );
}

function CritterLoadoutSlot({ data, slotIndex, owned, onEquip }: { data: AppData; slotIndex: number; owned?: UserCritter; onEquip: (target: EquipTarget) => void }) {
  if (!owned) {
    return (
      <button className="loadout-slot empty" onClick={() => onEquip({ type: "critter", slotIndex })}>
        <span className="empty-slot-plus">+</span><h3>Squad slot {slotIndex}</h3><p>Choose a critter</p>
      </button>
    );
  }

  const critter = byId(data.catalog.critters, owned.critter_id)!;
  const stats = critterStats(data.catalog, critter, owned.level);

  return (
    <article className="loadout-slot">
      <button className="slot-topline slot-button" onClick={() => onEquip({ type: "critter", slotIndex })}>
        <SpriteFrame size="sm"><Sprite name={critter.name} element={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} size="small" /></SpriteFrame>
        <div>
          <CritterName data={data} critter={critter} />
          <p>Level {owned.level}</p>
        </div>
        <span className="edit-label">Edit</span>
      </button>
      <StatGrid stats={stats} compact />
      <div className="skill-grid">
        {[1, 2, 3, 4].map((skillSlot) => {
          const row = data.player!.skillSlots.find((candidate) => candidate.user_critter_id === owned.id && candidate.slot_index === skillSlot);
          return <SkillTile key={skillSlot} data={data} skill={byId(data.catalog.skills, row?.skill_id)} onClick={() => onEquip({ type: "skill", slotIndex: skillSlot, owned })} />;
        })}
      </div>
      <div className="relic-row">
        {Array.from({ length: stats.relicSlots }, (_, index) => {
          const relicSlot = index + 1;
          const row = data.player!.relicSlots.find((candidate) => candidate.user_critter_id === owned.id && candidate.slot_index === relicSlot);
          return <RelicSlot key={relicSlot} data={data} relic={byId(data.catalog.relics, row?.relic_id)} slotIndex={relicSlot} onClick={() => onEquip({ type: "relic", slotIndex: relicSlot, owned })} />;
        })}
      </div>
    </article>
  );
}

function SpriteFrame({ children, size = "md", className = "", selected = false }: { children: React.ReactNode; size?: "xs" | "sm" | "md" | "lg" | "hero"; className?: string; selected?: boolean }) {
  return <span className={`sprite-frame sprite-frame-${size} ${selected ? "selected" : ""} ${className}`.trim()}>{children}</span>;
}

function CritterName({ data, critter, unknown = false }: { data: AppData; critter: Critter; unknown?: boolean }) {
  const element = byId(data.catalog.elements, critter.element_id);
  const path = catalogAssetPath(data, "element", critter.element_id, element?.asset_path, "icon");
  return <span className="critter-name">{!unknown && <AssetIcon path={path} alt={`${element?.name ?? critter.element_id} element`} fallback={<Sparkles size={18} />} />}<strong>{unknown ? "???" : critter.name}</strong></span>;
}

function GameTooltip({ label, content, children }: { label: string; content: React.ReactNode; children: React.ReactNode }) {
  return <span className="tooltip-anchor" tabIndex={0} aria-label={label}>{children}<span className="game-tooltip" role="tooltip">{content}</span></span>;
}

function SkillTile({ data, skill, onClick, disabled = false, disabledReason, selected = false }: { data: AppData; skill?: Skill | null; onClick?: () => void; disabled?: boolean; disabledReason?: string; selected?: boolean }) {
  const element = skill ? byId(data.catalog.elements, skill.element_id) : null;
  const elementPath = skill ? catalogAssetPath(data, "element", skill.element_id, element?.asset_path, "icon") : null;
  const manaPath = findAssetPath(data, "mana", "mana");
  const effectText = skill ? describeEffect(skill.effect, skill.description) : "Choose a skill.";
  const targetText = skill ? targetingDescription(skill) : "";
  const label = skill ? `${skill.name}, ${skill.skill_type}${skill.skill_type === "attack" ? `, ${skill.power} power` : ""}. ${effectText} ${targetText}` : "Choose a skill.";
  const tooltip = skill ? <><span className="tooltip-heading"><AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={18} />} /><strong>{skill.name} - {skill.skill_type === "attack" ? "Attack" : "Support"}{skill.skill_type === "attack" ? ` - ${skill.power} Power` : ""}</strong></span><span className="tooltip-description">{effectText}</span><span className="tooltip-target">{targetText}</span>{disabledReason && <span className="tooltip-disabled">{disabledReason}</span>}</> : <span className="tooltip-description">Choose a skill.</span>;
  return <GameTooltip label={label.trim()} content={tooltip}><button type="button" className={`skill-tile ${skill ? "" : "empty"} ${selected ? "selected" : ""}`} onClick={onClick} disabled={disabled || !onClick}>
    <span className="skill-title">{skill && <AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={16} />} />}<strong>{skill?.name ?? "-----"}</strong></span>
    {skill?.skill_type === "attack" && <span className="skill-power">PWR {skill.power}</span>}
    {skill && <span className="skill-mana"><AssetIcon path={manaPath} alt="Mana" fallback={<Gem size={15} />} />{skill.mana_cost}</span>}
    {selected && <Check className="selection-check" size={15} />}
  </button></GameTooltip>;
}

function RelicSlot({ data, relic, slotIndex, onClick }: { data: AppData; relic?: Relic | null; slotIndex: number; onClick: () => void }) {
  const emptyPath = findAssetPath(data, "ui", "relic-slot", "empty") ?? "ui/relic-slot.png";
  const details = relic ? `${relic.name}. ${describeEffect(relic.effect, relic.description)}` : "Choose a relic.";
  return <GameTooltip label={details.trim()} content={<span className="tooltip-description">{details.trim()}</span>}><button type="button" className="relic-slot" onClick={onClick} aria-label={`Equip relic · Slot ${slotIndex}`}>
    <SpriteFrame size="sm"><AssetIcon path={relic ? catalogAssetPath(data, "relic", relic.id, relic.asset_path) : emptyPath} alt={relic?.name ?? "Empty relic slot"} fallback={<Shield size={26} />} /></SpriteFrame>
    <span>{relic?.name ?? "-----"}</span>
  </button></GameTooltip>;
}

function AbilitySlot({ ability, slotIndex, onClick }: { ability?: { name: string; description: string; effect: Record<string, unknown> } | null; slotIndex: number; onClick: () => void }) {
  const effect = ability ? describeEffect(ability.effect, ability.description) : "Choose an ability.";
  const details = ability ? `${ability.name}. ${effect}` : effect;
  const tooltip = ability ? <><span className="tooltip-heading"><strong>{ability.name}</strong></span><span className="tooltip-description">{effect}</span></> : <span className="tooltip-description">Choose an ability.</span>;
  return <GameTooltip label={details.trim()} content={tooltip}><button type="button" className="ability-slot" onClick={onClick} aria-label={`Equip ability · Slot ${slotIndex}`}>
    <span><small>Slot {slotIndex}</small><strong>{ability?.name ?? "-----"}</strong></span>
  </button></GameTooltip>;
}

function targetingDescription(skill: Skill): string {
  switch (skill.targeting ?? "single_enemy") {
    case "all_enemies": return "Targets all Enemy Critters.";
    case "all_others": return "Targets all other Critters.";
    case "single_any": return "Targets one Friendly or Enemy Critter.";
    case "all_friendlies": return "Targets all Friendly Critters.";
    default: return "Targets one Enemy Critter.";
  }
}

function unlockedAbilitySlotCount(data: AppData, owned?: UserRollcaster): number {
  if (!owned) return 0;
  return data.catalog.rollcasterProgression
    .filter((row) => row.rollcaster_id === owned.rollcaster_id && row.level <= owned.level)
    .sort((a, b) => b.level - a.level)[0]?.total_unlocked_ability_slots ?? 1;
}

function EquipDialog({ data, target, saving, error, onClose, onEquip }: { data: AppData; target: EquipTarget; saving: boolean; error: string | null; onClose: () => void; onEquip: (operation: () => Promise<void>) => void }) {
  const player = data.player!;
  const title = target.type === "rollcaster" ? "Choose active Rollcaster" : `Equip ${target.type} · Slot ${target.slotIndex}`;
  let content: React.ReactNode;

  if (target.type === "critter") {
    const assigned = new Set(player.squadSlots.map((row) => row.user_critter_id).filter(Boolean));
    const eligible = player.critters;
    const current = player.squadSlots.find((row) => row.slot_index === target.slotIndex)?.user_critter_id;
    content = eligible.length ? <div className="candidate-grid">{eligible.map((owned) => {
      const critter = byId(data.catalog.critters, owned.critter_id)!;
      const selected = current === owned.id;
      const inSquad = assigned.has(owned.id);
      return <button className={`candidate-card ${selected ? "selected" : ""} ${inSquad ? "in-squad" : ""}`} key={owned.id} disabled={saving || inSquad} onClick={() => onEquip(() => setSquadSlot(target.slotIndex, owned.id))}>
        <SpriteFrame size="md" selected={selected}><Sprite name={critter.name} element={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>
        <CritterName data={data} critter={critter} /><span>Level {owned.level}</span>{inSquad && <span className="state-badge"><Check size={14} /> In squad</span>}
      </button>;
    })}</div> : <p className="empty-state">No critters available</p>;
  } else if (target.type === "skill") {
    const ids = player.unlockedSkillIdsByCritter[target.owned.id] ?? [];
    const rows = player.skillSlots.filter((row) => row.user_critter_id === target.owned.id);
    const current = rows.find((row) => row.slot_index === target.slotIndex)?.skill_id;
    const equippedElsewhere = new Set(rows.filter((row) => row.slot_index !== target.slotIndex).map((row) => row.skill_id));
    const eligible = ids.map((id) => byId(data.catalog.skills, id)).filter((skill): skill is Skill => Boolean(skill));
    content = eligible.length ? <div className="dialog-skill-grid">{eligible.map((skill) => <SkillTile key={skill.id} data={data} skill={skill} selected={current === skill.id} disabled={saving || equippedElsewhere.has(skill.id) || current === skill.id} onClick={() => onEquip(() => setCritterSkillSlot(target.owned.id, target.slotIndex, skill.id))} />)}</div> : <p className="empty-state">No skills available</p>;
  } else if (target.type === "relic") {
    const current = player.relicSlots.find((row) => row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)?.relic_id;
    const eligible = data.catalog.relics.filter((relic) => {
      const owned = player.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
      const used = player.relicSlots.filter((row) => row.relic_id === relic.id && !(row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)).length;
      return owned - used > 0;
    });
    content = eligible.length ? <div className="candidate-grid">{eligible.map((relic) => {
      const owned = player.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
      const used = player.relicSlots.filter((row) => row.relic_id === relic.id).length;
      return <button className={`candidate-card ${current === relic.id ? "selected" : ""}`} key={relic.id} disabled={saving || current === relic.id} onClick={() => onEquip(() => setCritterRelicSlot(target.owned.id, target.slotIndex, relic.id))}>
        <SpriteFrame size="md" selected={current === relic.id}><Sprite name={relic.name} element="metal" assetPath={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} /></SpriteFrame><strong>{relic.name}</strong><span>{describeEffect(relic.effect, relic.description)}</span><span className="inventory-count">Owned {owned} · Equipped {used} · Available {owned - used}</span>
      </button>;
    })}</div> : <p className="empty-state">No relics available</p>;
  } else if (target.type === "ability") {
    const ids = player.unlockedAbilityIdsByRollcaster[target.owned.id] ?? [];
    const rows = player.abilitySlots.filter((row) => row.user_rollcaster_id === target.owned.id);
    const current = rows.find((row) => row.slot_index === target.slotIndex)?.ability_id;
    const equippedElsewhere = new Set(rows.filter((row) => row.slot_index !== target.slotIndex).map((row) => row.ability_id));
    const eligible = ids.map((id) => byId(data.catalog.rollcasterAbilities, id)).filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
    content = eligible.length ? <div className="ability-candidates">{eligible.map((ability) => <button className={`ability-candidate ${current === ability.id ? "selected" : ""}`} key={ability.id} disabled={saving || current === ability.id || equippedElsewhere.has(ability.id)} onClick={() => onEquip(() => setRollcasterAbilitySlot(target.owned.id, target.slotIndex, ability.id))}><span><strong>{ability.name}</strong><small>{describeEffect(ability.effect, ability.description)}</small></span>{current === ability.id && <Check size={18} />}</button>)}</div> : <p className="empty-state">No abilities available</p>;
  } else {
    content = <div className="candidate-grid">{player.rollcasters.map((owned) => {
      const entry = byId(data.catalog.rollcasters, owned.rollcaster_id)!;
      const selected = player.profile.active_rollcaster_id === owned.id;
      return <button className={`candidate-card ${selected ? "selected" : ""}`} key={owned.id} disabled={saving || selected} onClick={() => onEquip(() => setActiveRollcaster(owned.id))}><SpriteFrame size="lg" selected={selected}><Sprite name={entry.name} element="basic" assetPath={catalogAssetPath(data, "rollcaster", entry.id, entry.asset_path)} size="large" fit="portrait" /></SpriteFrame><strong>{entry.name}</strong><span>Level {owned.level}</span></button>;
    })}</div>;
  }

  const currentRelic = target.type === "relic" ? player.relicSlots.find((row) => row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)?.relic_id : null;
  const canUnequip = (target.type === "relic" && Boolean(currentRelic)) || (target.type === "critter" && player.squadSlots.filter((row) => row.user_critter_id).length > 1) || (target.type === "skill" && player.skillSlots.filter((row) => row.user_critter_id === target.owned.id && row.skill_id).length > 1) || (target.type === "ability" && player.abilitySlots.filter((row) => row.user_rollcaster_id === target.owned.id && row.ability_id).length > 1);
  const clear = target.type === "critter" ? () => setSquadSlot(target.slotIndex, null) : target.type === "skill" ? () => setCritterSkillSlot(target.owned.id, target.slotIndex, null) : target.type === "relic" ? () => setCritterRelicSlot(target.owned.id, target.slotIndex, null) : target.type === "ability" ? () => setRollcasterAbilitySlot(target.owned.id, target.slotIndex, null) : null;
  return <Modal title={title} description="Choose an eligible item for this loadout slot." onClose={onClose}>
    {error && <p className="notice error" role="alert">{error}</p>}{content}
    <div className="dialog-actions">{canUnequip && clear && <button className="danger-button" disabled={saving} onClick={() => onEquip(clear)}>Unequip</button>}<button className="secondary-button" onClick={onClose}>Cancel</button></div>
  </Modal>;
}

function CollectionScreen({
  data,
  tab,
  setTab,
  detail,
  setDetail,
  onBack,
}: {
  data: AppData;
  tab: CollectionTab;
  setTab: (tab: CollectionTab) => void;
  detail: { type: "critter" | "rollcaster" | "relic"; id: string } | null;
  setDetail: (detail: { type: "critter" | "rollcaster" | "relic"; id: string } | null) => void;
  onBack: () => void;
}) {
  return (
    <section className="screen-stack">
      <div className="screen-heading row">
        <div>
          <h1>Collection</h1>
          <p>Review unlocked, seen, and undiscovered game pieces.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>Back</button>
      </div>
      <div className="tabs">
        {(["rollcasters", "critters", "relics"] as CollectionTab[]).map((candidate) => (
          <button key={candidate} className={tab === candidate ? "active" : ""} onClick={() => setTab(candidate)}>
            {candidate}
          </button>
        ))}
      </div>
      {tab === "rollcasters" && <RollcasterGrid data={data} setDetail={setDetail} />}
      {tab === "critters" && <CritterGrid data={data} setDetail={setDetail} />}
      {tab === "relics" && <RelicGrid data={data} setDetail={setDetail} />}
      {detail && <DetailModal data={data} detail={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function RollcasterGrid({
  data,
  setDetail,
}: {
  data: AppData;
  setDetail: (detail: { type: "rollcaster"; id: string }) => void;
}) {
  return (
    <div className="collection-grid">
      {data.catalog.rollcasters.map((rollcaster) => {
        const owned = data.player!.rollcasters.find((row) => row.rollcaster_id === rollcaster.id);
        return (
          <button key={rollcaster.id} className={`catalog-card ${!owned ? "locked" : ""}`} onClick={() => owned && setDetail({ type: "rollcaster", id: owned.id })}>
            <span className="collectible-id">{rollcaster.id}</span>
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster.name} element="basic" assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} size="hero" fit="portrait" /></CardSprite>
            <CardName data={data} name={rollcaster.name} />
            {owned ? (
              <>
                <p>Level {owned.level}</p>
                <ProgressBar current={owned.xp} needed={nextXp(data, owned)} />
                <p>{owned.ability_points} ability points</p>
              </>
            ) : (
              <p>Locked</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function CritterGrid({
  data,
  setDetail,
}: {
  data: AppData;
  setDetail: (detail: { type: "critter"; id: string }) => void;
}) {
  return (
    <div className="collection-grid">
      {data.catalog.critters.map((critter) => {
        const owned = data.player!.critters.find((row) => row.critter_id === critter.id);
        const seen = data.player!.seenCritterIds.includes(critter.id);
        const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
        return (
          <button
            key={critter.id}
            className={`catalog-card ${!owned ? "locked" : ""}`}
            onClick={() => owned && setDetail({ type: "critter", id: owned.id })}
          >
            <span className="collectible-id">{critter.id}</span>
            <CardSprite><Sprite
              name={owned || seen ? critter.name : "Unknown"}
              element={critter.element_id}
              assetPath={owned || seen ? catalogAssetPath(data, "critter", critter.id, critter.asset_path) : null}
              size="large"
              locked={!owned && !seen}
            /></CardSprite>
            <CardName data={data} name={owned || seen ? critter.name : "???"} elementId={owned || seen ? critter.element_id : undefined} />
            {owned ? (
              <>
                <p>Level {owned.level}</p>
                <ProgressBar current={owned.xp} needed={nextCritterXp(data, owned)} />
                <StatGrid stats={stats} compact />
              </>
            ) : seen ? (
              <>
                <p>Seen</p>
                <StatGrid stats={stats} compact />
              </>
            ) : (
              <p>Undiscovered</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RelicGrid({ data, setDetail }: { data: AppData; setDetail: (detail: { type: "relic"; id: string }) => void }) {
  return (
    <div className="collection-grid">
      {data.catalog.relics.map((relic) => {
        const inventory = data.player!.relicInventory.find((row) => row.relic_id === relic.id);
        return <RelicCard key={relic.id} data={data} relic={relic} quantity={inventory?.quantity ?? 0} onClick={() => inventory && setDetail({ type: "relic", id: relic.id })} />;
      })}
    </div>
  );
}

function RelicCard({ data, relic, quantity, onClick }: { data: AppData; relic: Relic; quantity: number; onClick: () => void }) {
  return (
    <button className={`catalog-card ${quantity <= 0 ? "locked" : ""}`} onClick={onClick}>
      <span className="collectible-id">{relic.id}</span>
      <CardSprite><Sprite name={relic.name} element="metal" assetPath={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} size="large" /></CardSprite>
      <CardName data={data} name={relic.name} />
      <p>{relic.description}</p>
      <p>Owned {quantity} / {relic.max_owned}</p>
    </button>
  );
}

function CardSprite({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`card-sprite-frame ${className}`.trim()}>{children}</span>;
}

function CardName({ data, name, elementId }: { data: AppData; name: string; elementId?: string }) {
  const element = elementId ? byId(data.catalog.elements, elementId) : null;
  const path = elementId ? catalogAssetPath(data, "element", elementId, element?.asset_path, "icon") : null;
  return (
    <span className="card-name-row">
      {elementId && <AssetIcon path={path} alt={`${element?.name ?? elementId} element`} fallback={null} />}
      <strong>{name}</strong>
    </span>
  );
}

function DetailModal({
  data,
  detail,
  onClose,
}: {
  data: AppData;
  detail: { type: "critter" | "rollcaster" | "relic"; id: string };
  onClose: () => void;
}) {
  if (detail.type === "critter") {
    const owned = data.player!.critters.find((row) => row.id === detail.id)!;
    const critter = byId(data.catalog.critters, owned.critter_id)!;
    const stats = critterStats(data.catalog, critter, owned.level);
    const skillIds = data.player!.unlockedSkillIdsByCritter[owned.id] ?? [];
    return (
      <Modal title={critter.name} onClose={onClose}>
        <CollectibleDetailHero data={data} id={critter.id} name={critter.name} elementId={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} assetElement={critter.element_id} />
        <p className="detail-level">Level {owned.level}</p>
        <StatGrid stats={stats} />
        <h3>Skills</h3>
        <div className="mini-grid">
          {data.catalog.critterSkillUnlocks
            .filter((row) => row.critter_id === critter.id)
            .map((unlock) => {
              const skill = byId(data.catalog.skills, unlock.skill_id)!;
              const unlocked = skillIds.includes(skill.id);
              return (
                <div key={skill.id} className={`detail-tile ${unlocked ? "" : "locked"}`}>
                  <SkillTile data={data} skill={skill} />
                  <span>Unlock level {unlock.unlock_level} · {unlock.unlock_cost} points</span>
                </div>
              );
            })}
        </div>
      </Modal>
    );
  }

  if (detail.type === "relic") {
    const relic = byId(data.catalog.relics, detail.id)!;
    const quantity = data.player!.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
    return (
      <Modal title={relic.name} onClose={onClose}>
        <CollectibleDetailHero data={data} id={relic.id} name={relic.name} assetPath={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} assetElement="metal" />
        <p>{relic.description}</p>
        <p><strong>Owned:</strong> {quantity} / {relic.max_owned}</p>
        <h3>Effect</h3>
        <p className="effect-summary">{describeEffect(relic.effect, relic.description) || "No additional effect."}</p>
      </Modal>
    );
  }

  const owned = data.player!.rollcasters.find((row) => row.id === detail.id)!;
  const rollcaster = byId(data.catalog.rollcasters, owned.rollcaster_id)!;
  const abilityIds = data.player!.unlockedAbilityIdsByRollcaster[owned.id] ?? [];
  return (
    <Modal title={rollcaster.name} onClose={onClose}>
      <CollectibleDetailHero data={data} id={rollcaster.id} name={rollcaster.name} assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} assetElement="basic" />
      <p className="detail-level">Level {owned.level}</p>
      <p>{owned.ability_points} ability points</p>
      <h3>Abilities</h3>
      <div className="mini-grid">
        {data.catalog.rollcasterAbilityUnlocks
          .filter((row) => row.rollcaster_id === rollcaster.id)
          .map((unlock) => {
            const ability = byId(data.catalog.rollcasterAbilities, unlock.ability_id)!;
            const unlocked = abilityIds.includes(ability.id);
            return (
              <article key={ability.id} className={`mini-card ${unlocked ? "" : "locked"}`}>
                <strong>{ability.name}</strong>
                <span>Level {unlock.unlock_level} / Cost {unlock.unlock_cost}</span>
                <p>{ability.description}</p>
              </article>
            );
          })}
      </div>
    </Modal>
  );
}

function CollectibleDetailHero({ data, id, name, elementId, assetPath, assetElement }: { data: AppData; id: string; name: string; elementId?: string; assetPath: string | null; assetElement: string }) {
  return (
    <div className="collectible-detail-hero">
      <span className="collectible-id">{id}</span>
      <CardSprite className={assetElement === "basic" && !elementId ? "rollcaster-sprite-frame" : ""}><Sprite name={name} element={assetElement} assetPath={assetPath} size="hero" fit={assetElement === "basic" && !elementId ? "portrait" : "contain"} /></CardSprite>
      <CardName data={data} name={name} elementId={elementId} />
    </div>
  );
}

function PlayScreen({
  data,
  onBack,
  onStart,
}: {
  data: AppData;
  onBack: () => void;
  onStart: (dungeon: Dungeon) => void;
}) {
  const unlockedIds = data.player!.dungeonProgress.filter((row) => row.is_unlocked).map((row) => row.dungeon_id);
  const progress = new Map(data.player!.dungeonProgress.map((row) => [row.dungeon_id, row]));
  const dungeons = data.catalog.dungeons;
  return (
    <section className="screen-stack">
      <div className="screen-heading row">
        <div>
          <h1>Dungeons</h1>
          <p>Select an unlocked dungeon. Your squad starts fully healed.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>Back</button>
      </div>
      <div className="dungeon-list">
        {dungeons.map((dungeon) => (
          <article key={dungeon.id} className={`dungeon-card ${!unlockedIds.includes(dungeon.id) ? "locked" : ""} ${progress.get(dungeon.id)?.completed_at ? "completed" : ""}`}>
            <div>
              <p className="eyebrow">{dungeon.dungeon_type} dungeon</p>
              <h2>{dungeon.id} - {dungeon.name}</h2>
              <p>Difficulty {dungeon.difficulty} · {dungeon.battle_format} · {dungeon.encounter_count} encounter</p>
              <div className="dungeon-badges"><span>{progress.get(dungeon.id)?.completed_at ? `Completed · ${progress.get(dungeon.id)?.clear_count} clears` : unlockedIds.includes(dungeon.id) ? "Ready" : "Locked"}</span><span>Coins + XP</span></div>
            </div>
            <button className="primary-button" disabled={!unlockedIds.includes(dungeon.id)} onClick={() => onStart(dungeon)}>
              {unlockedIds.includes(dungeon.id) ? "Enter dungeon" : "Locked"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function RewardScreen({ data, combat, onContinue }: { data: AppData; combat: CombatState; onContinue: () => void }) {
  const opponent = data.catalog.dungeonOpponents.find((row) => row.dungeon_id === combat.dungeon.id);
  const defeated = combat.opponentUnits[0]?.critter;
  return <section className="reward-screen screen-stack">
    <div className="reward-banner"><Sparkles size={28} /><p className="eyebrow">Dungeon complete</p><h1>Victory rewards</h1><p>{combat.dungeon.name} has been cleared.</p></div>
    <div className="reward-grid">
      <article className="reward-card"><Coins size={30} /><strong>{opponent?.currency_reward ?? 0}</strong><span>Coins</span></article>
      <article className="reward-card"><Sparkles size={30} /><strong>{opponent?.rollcaster_xp_reward ?? 0}</strong><span>Rollcaster XP</span></article>
      <article className="reward-card"><Gem size={30} /><strong>{opponent?.critter_xp_reward ?? 0}</strong><span>Critter XP</span></article>
      {defeated && <article className="reward-card reward-preview"><SpriteFrame size="md"><Sprite name={defeated.name} element={defeated.element_id} assetPath={catalogAssetPath(data, "critter", defeated.id, defeated.asset_path)} /></SpriteFrame><CritterName data={data} critter={defeated} /><span>Encounter logged</span></article>}
    </div>
    <button className="primary-button reward-continue" onClick={onContinue}>Return to camp</button>
  </section>;
}

function CombatScreen({
  data,
  combat,
  setCombat,
  onBack,
  onWin,
}: {
  data: AppData;
  combat: CombatState;
  setCombat: (state: CombatState) => void;
  onBack: () => void;
  onWin: () => void;
}) {
  const [actions, setActions] = useState<Record<string, CombatAction>>({});
  const [targeting, setTargeting] = useState<{ actorKey: string; skill: Skill; mode: "select" | "preview" } | null>(null);
  const activePlayer = combat.playerUnits.filter((unit) => unit.active && unit.hp > 0);
  const totalCost = Object.values(actions).reduce((sum, action) => sum + action.cost, 0);
  const manaAssetPath = findAssetPath(data, "mana", "mana");
  const activeOwnedRollcaster = data.player!.rollcasters.find((row) => row.id === data.player!.profile.active_rollcaster_id) ?? data.player!.rollcasters[0];
  const activeRollcaster = byId(data.catalog.rollcasters, activeOwnedRollcaster?.rollcaster_id);
  const previewTargets = targeting?.mode === "preview" ? skillTargets(combat, targeting.actorKey, targeting.skill) : [];
  const previewTargetKeys = new Set(previewTargets.map((unit) => unit.key));

  useEffect(() => {
    setActions({});
    setTargeting(null);
  }, [combat.turn]);

  function setAction(action: CombatAction) {
    setActions((current) => ({ ...current, [action.actorKey]: action }));
    setTargeting(null);
  }

  function chooseSkill(actorKey: string, skill: Skill) {
    const targets = skillTargets(combat, actorKey, skill);
    if (isSingleTarget(skill) && targets.length > 1) {
      setTargeting({ actorKey, skill, mode: "select" });
      return;
    }
    if (!isSingleTarget(skill) && targets.length > 0) {
      setTargeting({ actorKey, skill, mode: "preview" });
      return;
    }
    setAction({ actorKey, type: "skill", skillId: skill.id, targetKey: isSingleTarget(skill) ? targets[0]?.key : undefined, cost: skill.mana_cost });
  }

  return (
    <section className="combat-screen">
      <div className="combat-header">
        <button className="secondary-button" onClick={onBack}>Back</button>
        <div>
          <h1>{combat.dungeon.name}</h1>
          <p>Turn {combat.turn} / {combat.dungeon.battle_format}</p>
        </div>
        <div className="mana-readout">
          <span><AssetIcon path={manaAssetPath} alt="Mana" fallback={null} />Player Mana {combat.playerMana}</span>
          <span><AssetIcon path={manaAssetPath} alt="Mana" fallback={null} />Enemy Mana {combat.opponentMana}</span>
        </div>
      </div>

      <div className="battlefield">
        <aside className="battle-rollcaster">
          <span className="combat-sprite-frame rollcaster-combat-frame"><Sprite
            name={activeRollcaster?.name ?? "Rollcaster"}
            element="basic"
            assetPath={catalogAssetPath(
              data,
              "rollcaster",
              activeRollcaster?.id,
              activeRollcaster?.asset_path,
            )}
            size="large"
            fit="portrait"
          /></span>
          <p>{activeRollcaster?.name ?? "Rollcaster"}</p>
        </aside>
        <div className="battle-column">
          {combat.playerUnits.map((unit) => (
            <BattleUnit
              key={unit.key}
              unit={unit}
              skills={unit.skills}
              data={data}
              action={actions[unit.key]}
              canAct={combat.phase === "selecting" && unit.active && unit.hp > 0}
              bench={combat.playerUnits.filter((candidate) => !candidate.active && candidate.hp > 0)}
              availableMana={combat.playerMana - (totalCost - (actions[unit.key]?.cost ?? 0))}
              onAction={setAction}
              onChooseSkill={chooseSkill}
              previewed={previewTargetKeys.has(unit.key)}
              previewKind={targeting?.skill.skill_type}
            />
          ))}
        </div>
        <div className="battle-column opponent-column">
          {combat.opponentUnits.map((unit) => (
            <BattleUnit key={unit.key} unit={unit} skills={unit.skills} data={data} opponent previewed={previewTargetKeys.has(unit.key)} previewKind={targeting?.skill.skill_type} />
          ))}
        </div>
      </div>

      {targeting && <section className={`target-picker ${targeting.mode}`} aria-label={targeting.mode === "preview" ? "Preview affected critters" : "Choose a skill target"}>
        <div><p className="eyebrow">{targeting.mode === "preview" ? "Affected Critters" : "Choose target"}</p><h2>{targeting.skill.name}</h2><p>{targetingDescription(targeting.skill)}</p></div>
        <div className="target-options">{skillTargets(combat, targeting.actorKey, targeting.skill).map((unit) => targeting.mode === "select" ? <button key={unit.key} onClick={() => setAction({ actorKey: targeting.actorKey, type: "skill", skillId: targeting.skill.id, targetKey: unit.key, cost: targeting.skill.mana_cost })}><SpriteFrame size="xs"><Sprite name={unit.name} element={unit.critter.element_id} assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)} size="small" /></SpriteFrame><span><CritterName data={data} critter={unit.critter} /><small>{unit.side === "player" ? "Friendly" : "Enemy"} · {unit.hp}/{unit.maxHp} HP</small></span></button> : <article key={unit.key} className={`target-preview-card ${targeting.skill.skill_type}`}><SpriteFrame size="xs"><Sprite name={unit.name} element={unit.critter.element_id} assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)} size="small" /></SpriteFrame><span><CritterName data={data} critter={unit.critter} /><small>{unit.side === "player" ? "Friendly" : "Enemy"} · {unit.hp}/{unit.maxHp} HP</small></span></article>)}</div>
        <div className="target-picker-actions">{targeting.mode === "preview" && <button className="primary-button" onClick={() => setAction({ actorKey: targeting.actorKey, type: "skill", skillId: targeting.skill.id, cost: targeting.skill.mana_cost })}>{targeting.skill.skill_type === "attack" ? "Confirm area attack" : "Confirm support effect"}</button>}<button className="secondary-button" onClick={() => setTargeting(null)}>Cancel</button></div>
      </section>}

      <div className="turn-panel">
        {combat.phase === "ready" && (
          <button className="primary-button" onClick={() => setCombat(startTurn(combat))}>
            Roll Dice
          </button>
        )}
        {combat.phase === "selecting" && (
          <>
            <div className="selection-summary">
              <strong>Selected Actions</strong>
              {activePlayer.map((unit) => (
                <span key={unit.key}>
                  {unit.name}: {actions[unit.key]?.type ?? "skip"} ({actions[unit.key]?.cost ?? 0} mana)
                </span>
              ))}
              <strong>Total {totalCost} / {combat.playerMana}</strong>
            </div>
            <button
              className="primary-button"
              disabled={Boolean(targeting) || totalCost > combat.playerMana}
              onClick={() => {
                const submitted = activePlayer.map(
                  (unit) => actions[unit.key] ?? { actorKey: unit.key, type: "skip", cost: 0 },
                );
                setCombat(resolveTurn(combat, submitted));
              }}
            >
              Continue
            </button>
          </>
        )}
        {combat.phase === "won" && <button className="primary-button" onClick={onWin}>Claim Rewards</button>}
        {combat.phase === "lost" && <button className="secondary-button" onClick={onBack}>Return</button>}
      </div>

      <div className="combat-log">
        {combat.log.slice(0, 8).map((entry, index) => (
          <p key={`${entry}-${index}`}>{entry}</p>
        ))}
      </div>
    </section>
  );
}

function BattleUnit({
  unit,
  skills,
  data,
  action,
  canAct,
  bench = [],
  onAction,
  onChooseSkill,
  opponent = false,
  availableMana = 0,
  previewed = false,
  previewKind,
}: {
  unit: CombatState["playerUnits"][number];
  skills: Skill[];
  data: AppData;
  action?: CombatAction;
  canAct?: boolean;
  bench?: CombatState["playerUnits"];
  onAction?: (action: CombatAction) => void;
  onChooseSkill?: (actorKey: string, skill: Skill) => void;
  opponent?: boolean;
  availableMana?: number;
  previewed?: boolean;
  previewKind?: Skill["skill_type"];
}) {
  const pct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  return (
    <article className={`battle-unit ${!unit.active ? "bench" : ""} ${opponent ? "opponent" : ""} ${previewed ? `target-preview ${previewKind ?? "attack"}-preview` : ""}`}>
      <span className="combat-sprite-frame critter-combat-frame"><Sprite
        name={unit.name}
        element={unit.critter.element_id}
        assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)}
        size="medium"
        flipped={opponent}
      /></span>
      <div className="battle-unit-info">
        <CritterName data={data} critter={unit.critter} />
        <p>Lv {unit.level} / Mana {unit.stats.diceMin}–{unit.stats.diceMax}: {unit.manaRoll || "-"}</p>
        <div className="hp-bar"><span style={{ width: `${pct}%` }} /></div>
        <p>{unit.hp} / {unit.maxHp} HP {unit.blocking ? "/ blocking" : ""}</p>
      </div>
      {canAct && onAction && (
        <div className="action-grid">
          <button className={action?.type === "block" ? "selected-action" : ""} disabled={unit.stats.blockCost > availableMana} onClick={() => onAction({ actorKey: unit.key, type: "block", cost: unit.stats.blockCost })}>
            Block {unit.stats.blockCost}
          </button>
          <button className={action?.type === "skip" ? "selected-action" : ""} onClick={() => onAction({ actorKey: unit.key, type: "skip", cost: 0 })}>Skip 0</button>
          {skills.map((skill) => (
            <SkillTile
              key={skill.id}
              data={data}
              skill={skill}
              selected={action?.type === "skill" && action.skillId === skill.id}
              disabled={skill.mana_cost > availableMana}
              disabledReason={skill.mana_cost > availableMana ? "Insufficient mana." : undefined}
              onClick={() => onChooseSkill?.(unit.key, skill)}
            />
          ))}
          {bench.map((candidate) => (
            <button
              key={candidate.key}
              onClick={() =>
                onAction({
                  actorKey: unit.key,
                  type: "swap",
                  swapToId: candidate.userCritter?.id,
                  cost: unit.stats.swapCost,
                })
              }
            >
              Swap {candidate.name} {unit.stats.swapCost}
            </button>
          ))}
        </div>
      )}
      {action && <span className="action-badge">{action.type}</span>}
    </article>
  );
}

function Modal({ title, description = "Item details", children, onClose }: { title: string; description?: string; children: React.ReactNode; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = `modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    modal?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !modal) return;
      const focusable = [...modal.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input, [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}>
        <div className="modal-header">
          <div><p className="eyebrow">Loadout & collection</p><h2 id={titleId}>{title}</h2><p id={`${titleId}-description`}>{description}</p></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Sprite({
  name,
  element,
  assetPath,
  size = "medium",
  locked,
  flipped,
  fit = "contain",
}: {
  name: string;
  element: string;
  assetPath?: string | null;
  size?: "small" | "medium" | "large" | "hero";
  locked?: boolean;
  flipped?: boolean;
  fit?: "contain" | "portrait";
}) {
  const [failedAssetPath, setFailedAssetPath] = useState<string | null>(null);
  const src = !locked && assetPath && failedAssetPath !== assetPath ? getGameAssetUrl(assetPath) : null;
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    setFailedAssetPath(null);
  }, [assetPath]);

  return (
    <span
      className={`sprite sprite-${size} sprite-fit-${fit} element-${element} ${src ? "has-asset" : ""} ${locked ? "locked" : ""} ${
        flipped ? "flipped" : ""
      }`}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={fit === "portrait" ? "portrait-sprite-image" : undefined}
          onError={() => setFailedAssetPath(assetPath ?? null)}
        />
      ) : locked ? "?" : initials}
    </span>
  );
}

function AssetIcon({
  path,
  alt,
  fallback,
}: {
  path?: string | null;
  alt: string;
  fallback: React.ReactNode;
}) {
  const [failedAssetPath, setFailedAssetPath] = useState<string | null>(null);
  const src = path && failedAssetPath !== path ? getGameAssetUrl(path) : null;

  useEffect(() => {
    setFailedAssetPath(null);
  }, [path]);

  if (!src) return <>{fallback}</>;
  return <img className="asset-icon" src={src} alt={alt} onError={() => setFailedAssetPath(path ?? null)} />;
}

function catalogAssetPath(
  data: AppData,
  category: string,
  ownerId: string | null | undefined,
  directPath: string | null | undefined,
  variant = "default",
): string | null {
  if (directPath) return directPath;
  if (!ownerId) return null;
  return findAssetPath(data, category, ownerId, variant);
}

function findAssetPath(data: AppData, category: string, ownerId: string, variant = "icon"): string | null {
  return (
    data.catalog.gameAssets.find(
      (asset) =>
        asset.category === category &&
        asset.owner_id === ownerId &&
        asset.variant === variant &&
        asset.is_active,
    )?.path ?? null
  );
}

function StatGrid({ stats, compact }: { stats: ReturnType<typeof critterStats>; compact?: boolean }) {
  return (
    <div className={`stat-grid ${compact ? "compact" : ""}`}>
      <span>HP <strong>{stats.hp}</strong></span>
      <span>ATK <strong>{stats.atk}</strong></span>
      <span>DEF <strong>{stats.def}</strong></span>
      <span>SPD <strong>{stats.spd}</strong></span>
      <span>Mana Dice <strong>{stats.diceMin}–{stats.diceMax}</strong></span>
      <span>Block <strong>{stats.blockCost}</strong></span>
      <span>Swap <strong>{stats.swapCost}</strong></span>
      <span>Relics <strong>{stats.relicSlots}</strong></span>
    </div>
  );
}

function ProgressBar({ current, needed }: { current: number; needed: number }) {
  const pct = needed <= 0 ? 100 : Math.min(100, Math.round((current / needed) * 100));
  return (
    <div>
      <div className="xp-bar"><span style={{ width: `${pct}%` }} /></div>
      <p>{current} / {needed} XP</p>
    </div>
  );
}

function nextXp(data: AppData, owned: UserRollcaster): number {
  return (
    data.catalog.rollcasterProgression
      .filter((row) => row.rollcaster_id === owned.rollcaster_id && row.level > owned.level)
      .sort((a, b) => a.level - b.level)[0]?.total_required_xp ?? owned.xp
  );
}

function nextCritterXp(data: AppData, owned: UserCritter): number {
  return (
    data.catalog.critterProgression
      .filter((row) => row.critter_id === owned.critter_id && row.level > owned.level)
      .sort((a, b) => a.level - b.level)[0]?.total_required_xp ?? owned.xp
  );
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}
