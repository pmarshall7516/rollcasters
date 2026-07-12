import { useEffect, useMemo, useState } from "react";
import {
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
  elementName,
  equippedSkillIds,
  resolveTurn,
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

type CollectionTab = "rollcasters" | "critters" | "relics";

export function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [view, setView] = useState<View>("auth");
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("critters");
  const [detail, setDetail] = useState<{ type: "critter" | "rollcaster"; id: string } | null>(null);
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
              await refresh("home");
              setCombat(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Unable to apply rewards.");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
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
        <h1>Rollcasters</h1>
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await signUp(email, password, username || email.split("@")[0]);
      else await signIn(email, password);
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="brand-panel">
        <span className="brand-mark">RC</span>
        <h1>Rollcasters</h1>
        <p>Build a squad, roll mana, and clear creature dungeons with your chosen Rollcaster.</p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === "login" ? "Log in" : "Create account"}</h2>
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
  return (
    <header className="top-bar">
      <button className="logo-button" onClick={onHome}>
        <span>RC</span>
        Rollcasters
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
        <Sprite name={critter.name} element={critter.element_id} assetPath={critter.asset_path} size="large" />
            <h2>{critter.id} - {critter.name}</h2>
            <p>{elementName(data.catalog, critter.element_id)} type</p>
            <StatGrid stats={critterStats(data.catalog, critter, 1)} compact />
            <span className="primary-button full-width">Choose {critter.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function HomeScreen({ data, onCollection, onPlay }: { data: AppData; onCollection: () => void; onPlay: () => void }) {
  const player = data.player!;
  const activeRollcaster = player.rollcasters.find((row) => row.id === player.profile.active_rollcaster_id) ?? player.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, activeRollcaster?.rollcaster_id);
  const abilitySlot = player.abilitySlots.find((slot) => slot.user_rollcaster_id === activeRollcaster?.id);
  const ability = byId(data.catalog.rollcasterAbilities, abilitySlot?.ability_id);
  const squad = player.squadSlots.slice().sort((a, b) => a.slot_index - b.slot_index);

  return (
    <section className="home-layout">
      <aside className="rollcaster-panel">
        <p className="eyebrow">Active Rollcaster</p>
        <Sprite name={rollcaster?.name ?? "Shanks"} element="basic" assetPath={rollcaster?.asset_path} size="hero" />
        <h1>{rollcaster?.name ?? "Unknown"}</h1>
        <p>Level {activeRollcaster?.level ?? 1}</p>
        <div className="ability-chip">
          <Sparkles size={16} />
          {ability?.name ?? "No ability equipped"}
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
            />
          );
        })}
      </section>
    </section>
  );
}

function CritterLoadoutSlot({ data, slotIndex, owned }: { data: AppData; slotIndex: number; owned?: UserCritter }) {
  if (!owned) {
    return (
      <article className="loadout-slot empty">
        <h3>Slot {slotIndex}</h3>
        <p>Empty critter slot</p>
      </article>
    );
  }

  const critter = byId(data.catalog.critters, owned.critter_id)!;
  const stats = critterStats(data.catalog, critter, owned.level);
  const skills = equippedSkillIds(data.player!, owned.id)
    .map((skillId) => byId(data.catalog.skills, skillId))
    .filter((skill): skill is Skill => Boolean(skill));

  return (
    <article className="loadout-slot">
      <div className="slot-topline">
        <Sprite name={critter.name} element={critter.element_id} assetPath={critter.asset_path} size="small" />
        <div>
          <h3>{critter.name}</h3>
          <p>Level {owned.level} {elementName(data.catalog, critter.element_id)}</p>
        </div>
      </div>
      <StatGrid stats={stats} compact />
      <div className="skill-grid">
        {[0, 1, 2, 3].map((index) => (
          <button key={index} className="skill-button" disabled={!skills[index]}>
            {skills[index]?.name ?? "Empty"}
          </button>
        ))}
      </div>
      <div className="relic-row">
        {Array.from({ length: stats.relicSlots }).map((_, index) => (
          <span key={index} className="relic-slot">
            <Shield size={15} />
          </span>
        ))}
      </div>
    </article>
  );
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
  detail: { type: "critter" | "rollcaster"; id: string } | null;
  setDetail: (detail: { type: "critter" | "rollcaster"; id: string } | null) => void;
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
      {tab === "relics" && <RelicGrid data={data} />}
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
          <button key={rollcaster.id} className="catalog-card" onClick={() => owned && setDetail({ type: "rollcaster", id: owned.id })}>
            <Sprite name={rollcaster.name} element="basic" assetPath={rollcaster.asset_path} size="large" />
            <h2>{rollcaster.id} - {rollcaster.name}</h2>
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
            className={`catalog-card ${!owned && !seen ? "locked" : ""}`}
            onClick={() => owned && setDetail({ type: "critter", id: owned.id })}
          >
            <Sprite
              name={owned || seen ? critter.name : "Unknown"}
              element={critter.element_id}
              assetPath={owned || seen ? critter.asset_path : null}
              size="large"
              locked={!owned && !seen}
            />
            <h2>{owned || seen ? `${critter.id} - ${critter.name}` : "???"}</h2>
            {owned ? (
              <>
                <p>Level {owned.level} {elementName(data.catalog, critter.element_id)}</p>
                <ProgressBar current={owned.xp} needed={nextCritterXp(data, owned)} />
                <StatGrid stats={stats} compact />
              </>
            ) : seen ? (
              <>
                <p>Seen {elementName(data.catalog, critter.element_id)} type</p>
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

function RelicGrid({ data }: { data: AppData }) {
  return (
    <div className="collection-grid">
      {data.catalog.relics.map((relic) => {
        const inventory = data.player!.relicInventory.find((row) => row.relic_id === relic.id);
        return <RelicCard key={relic.id} relic={relic} quantity={inventory?.quantity ?? 0} />;
      })}
    </div>
  );
}

function RelicCard({ relic, quantity }: { relic: Relic; quantity: number }) {
  return (
    <article className={`catalog-card ${quantity <= 0 ? "locked" : ""}`}>
      <Sprite name={relic.name} element="metal" assetPath={relic.asset_path} size="large" locked={quantity <= 0} />
      <h2>{relic.id} - {relic.name}</h2>
      <p>{relic.description}</p>
      <p>Owned {quantity} / {relic.max_owned}</p>
    </article>
  );
}

function DetailModal({
  data,
  detail,
  onClose,
}: {
  data: AppData;
  detail: { type: "critter" | "rollcaster"; id: string };
  onClose: () => void;
}) {
  if (detail.type === "critter") {
    const owned = data.player!.critters.find((row) => row.id === detail.id)!;
    const critter = byId(data.catalog.critters, owned.critter_id)!;
    const stats = critterStats(data.catalog, critter, owned.level);
    const skillIds = data.player!.unlockedSkillIdsByCritter[owned.id] ?? [];
    return (
      <Modal title={critter.name} onClose={onClose}>
        <Sprite name={critter.name} element={critter.element_id} assetPath={critter.asset_path} size="hero" />
        <StatGrid stats={stats} />
        <h3>Skills</h3>
        <div className="mini-grid">
          {data.catalog.critterSkillUnlocks
            .filter((row) => row.critter_id === critter.id)
            .map((unlock) => {
              const skill = byId(data.catalog.skills, unlock.skill_id)!;
              const unlocked = skillIds.includes(skill.id);
              return (
                <article key={skill.id} className={`mini-card ${unlocked ? "" : "locked"}`}>
                  <strong>{skill.name}</strong>
                  <span>Level {unlock.unlock_level} / Cost {unlock.unlock_cost}</span>
                  <p>{skill.description}</p>
                </article>
              );
            })}
        </div>
      </Modal>
    );
  }

  const owned = data.player!.rollcasters.find((row) => row.id === detail.id)!;
  const rollcaster = byId(data.catalog.rollcasters, owned.rollcaster_id)!;
  const abilityIds = data.player!.unlockedAbilityIdsByRollcaster[owned.id] ?? [];
  return (
    <Modal title={rollcaster.name} onClose={onClose}>
      <Sprite name={rollcaster.name} element="basic" assetPath={rollcaster.asset_path} size="hero" />
      <p>Level {owned.level}</p>
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
  const dungeons = data.catalog.dungeons.filter((dungeon) => unlockedIds.includes(dungeon.id));
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
          <article key={dungeon.id} className="dungeon-card">
            <div>
              <p className="eyebrow">{dungeon.dungeon_type} dungeon</p>
              <h2>{dungeon.id} - {dungeon.name}</h2>
              <p>Difficulty {dungeon.difficulty} / {dungeon.battle_format} / {dungeon.encounter_count} encounter</p>
            </div>
            <button className="primary-button" onClick={() => onStart(dungeon)}>
              Start
            </button>
          </article>
        ))}
      </div>
    </section>
  );
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
  const activePlayer = combat.playerUnits.filter((unit) => unit.active && unit.hp > 0);
  const totalCost = Object.values(actions).reduce((sum, action) => sum + action.cost, 0);
  const manaAssetPath = findAssetPath(data, "mana", "mana");

  useEffect(() => {
    setActions({});
  }, [combat.turn]);

  function setAction(action: CombatAction) {
    setActions((current) => ({ ...current, [action.actorKey]: action }));
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
          <Sprite
            name="Shanks"
            element="basic"
            assetPath={data.catalog.rollcasters.find((rollcaster) => rollcaster.id === "001")?.asset_path}
            size="large"
          />
          <p>Shanks</p>
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
              onAction={setAction}
            />
          ))}
        </div>
        <div className="battle-column opponent-column">
          {combat.opponentUnits.map((unit) => (
            <BattleUnit key={unit.key} unit={unit} skills={unit.skills} data={data} opponent />
          ))}
        </div>
      </div>

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
              disabled={totalCost > combat.playerMana}
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
  opponent = false,
}: {
  unit: CombatState["playerUnits"][number];
  skills: Skill[];
  data: AppData;
  action?: CombatAction;
  canAct?: boolean;
  bench?: CombatState["playerUnits"];
  onAction?: (action: CombatAction) => void;
  opponent?: boolean;
}) {
  const pct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  return (
    <article className={`battle-unit ${!unit.active ? "bench" : ""} ${opponent ? "opponent" : ""}`}>
      <Sprite
        name={unit.name}
        element={unit.critter.element_id}
        assetPath={unit.critter.asset_path}
        size="medium"
        flipped={opponent}
      />
      <div className="battle-unit-info">
        <h3>{unit.name}</h3>
        <p>Lv {unit.level} / {elementName(data.catalog, unit.critter.element_id)} / Roll d{unit.stats.dice}: {unit.manaRoll || "-"}</p>
        <div className="hp-bar"><span style={{ width: `${pct}%` }} /></div>
        <p>{unit.hp} / {unit.maxHp} HP {unit.blocking ? "/ blocking" : ""}</p>
      </div>
      {canAct && onAction && (
        <div className="action-grid">
          <button onClick={() => onAction({ actorKey: unit.key, type: "block", cost: unit.stats.blockCost })}>
            Block {unit.stats.blockCost}
          </button>
          <button onClick={() => onAction({ actorKey: unit.key, type: "skip", cost: 0 })}>Skip 0</button>
          {skills.map((skill) => (
            <button
              key={skill.id}
              onClick={() =>
                onAction({
                  actorKey: unit.key,
                  type: "skill",
                  skillId: skill.id,
                  targetKey: "o1",
                  cost: skill.mana_cost,
                })
              }
            >
              {skill.name} {skill.mana_cost}
            </button>
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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <h2>{title}</h2>
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
}: {
  name: string;
  element: string;
  assetPath?: string | null;
  size?: "small" | "medium" | "large" | "hero";
  locked?: boolean;
  flipped?: boolean;
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
      className={`sprite sprite-${size} element-${element} ${src ? "has-asset" : ""} ${locked ? "locked" : ""} ${
        flipped ? "flipped" : ""
      }`}
    >
      {src ? <img src={src} alt={name} onError={() => setFailedAssetPath(assetPath ?? null)} /> : locked ? "?" : initials}
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
      <span>Dice <strong>d{stats.dice}</strong></span>
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
