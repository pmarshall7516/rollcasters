import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Coins,
  Gem,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Swords,
  Target,
  UserRound,
  X,
} from "lucide-react";
import {
  acknowledgeCollectibleUnlockEvent,
  ensureUserGameState,
  getGameAssetUrl,
  getSession,
  hasSupabaseConfig,
  loadAppData,
  purchaseShopEntry,
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
  snapshotDungeonRunEffects,
  startDungeonRun,
  submitCollectibleCombatEvents,
  supabase,
  trackCollectibleChallenge,
  untrackCollectibleChallenge,
  unlockCritterSkill,
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
import { calculateLoadoutStats, type LoadoutStatKey, type StatBreakdown } from "./lib/loadout";
import { relicSlotUnlocks, xpProgress, type XpProgress } from "./lib/progression";
import {
  challengeDescription,
  challengeGateBadge,
  challengeGateBlockMessage,
  challengesFor,
  collectibleAssetPath,
  collectibleIsOwned,
  collectibleName,
  collectibleTargetAvailable,
  currencyBalance,
  currencyFor,
  formatAmount,
  isTrackableChallenge,
  orderedCurrencies,
  progressFor,
  requirementFor,
  shopAvailability,
  shopErrorMessage,
  trackedSlotFor,
} from "./lib/collectibles";
import type {
  AppData,
  CombatAction,
  CollectibleUnlockEvent,
  CollectibleType,
  CollectibleUnlockChallenge,
  Critter,
  Dungeon,
  PlayerState,
  Relic,
  ResolvedEffectRef,
  Skill,
  ShopEntry,
  UserCritter,
  UserRollcaster,
  View,
} from "./lib/types";
import rollcastersLogoUrl from "./assets/rollcasters-logo.png";

type CollectionTab = "rollcasters" | "critters" | "relics";
type ShopTab = "shard" | "relic" | "lootbox";
type CollectionDetail = { type: "critter" | "rollcaster" | "relic"; id: string };

const collectibleIdCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sortByCollectibleId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => collectibleIdCollator.compare(left.id, right.id));
}

function routeFromLocation(): { view: View; shopTab: ShopTab } {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const shopTab: ShopTab = requestedTab === "relic" ? "relic" : "shard";
  if (window.location.pathname === "/shop") return { view: "shop", shopTab };
  if (window.location.pathname === "/collection") return { view: "collection", shopTab };
  if (window.location.pathname === "/play") return { view: "play", shopTab };
  return { view: "home", shopTab };
}

function viewUrl(view: View, shopTab: ShopTab): string {
  if (view === "shop") return `/shop?tab=${shopTab}`;
  if (view === "collection") return "/collection";
  if (view === "play") return "/play";
  return "/";
}

export function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [view, setView] = useState<View>("auth");
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("critters");
  const [shopTab, setShopTab] = useState<ShopTab>(() => routeFromLocation().shopTab);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [combat, setCombat] = useState<CombatState | null>(null);
  const [unlockQueue, setUnlockQueue] = useState<CollectibleUnlockEvent[]>([]);
  const seenUnlockEvents = useRef(new Set<string>());

  function navigate(nextView: View, nextShopTab = shopTab, replace = false) {
    if (nextView === "shop") setShopTab(nextShopTab);
    setView(nextView);
    if (["home", "collection", "shop", "play"].includes(nextView)) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", viewUrl(nextView, nextShopTab));
    }
  }

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
        const route = routeFromLocation();
        setShopTab(route.shopTab);
        setView(loaded.player?.profile.starter_selected_at ? route.view : "starter");
      }
    } catch (err) {
      console.error("Unable to load game data.", err);
      setError(errorMessage(err, "Unable to load game data."));
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
    function popstate() {
      if (!isAuthed || !data?.player?.profile.starter_selected_at) return;
      const route = routeFromLocation();
      setShopTab(route.shopTab);
      setView(route.view);
    }
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, [isAuthed, data?.player?.profile.starter_selected_at]);

  const pendingUnlockIds = data?.player?.collectibleSnapshot.unlock_events.map((event) => event.id).join("|") ?? "";
  useEffect(() => {
    const pending = data?.player?.collectibleSnapshot.unlock_events ?? [];
    const additions = pending.filter((event) => !seenUnlockEvents.current.has(event.id));
    if (!additions.length) return;
    additions.forEach((event) => seenUnlockEvents.current.add(event.id));
    setUnlockQueue((current) => [...current, ...additions]);
    additions.forEach((event) => {
      void acknowledgeCollectibleUnlockEvent(event.id).catch((ackError) => {
        console.error("Unable to acknowledge collectible unlock event.", ackError);
      });
    });
  }, [pendingUnlockIds]);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        view,
        loading,
        authed: isAuthed,
        starterSelected: data?.player?.profile.starter_selected_at != null,
        coins: data?.player?.profile.coins ?? 0,
        currencies: data?.player?.collectibleSnapshot.currencies ?? [],
        trackedChallenges: data?.player?.collectibleSnapshot.tracked ?? [],
        shop: view === "shop" ? { tab: shopTab, offers: data?.catalog.shopEntries.filter((entry) => entry.shop_type === shopTab).length ?? 0 } : null,
        unlockNotification: unlockQueue[0] ?? null,
        combat: combat
          ? {
              phase: combat.phase,
              turn: combat.turn,
              playerMana: combat.playerMana,
              opponentMana: combat.opponentMana,
              player: combat.playerUnits.map((unit) => ({
                name: unit.name,
                hp: unit.hp,
                maxHp: unit.maxHp,
                active: unit.active,
                roll: unit.manaRoll,
                stats: unit.stats,
              })),
              opponents: combat.opponentUnits.map((unit) => ({
                name: unit.name,
                hp: unit.hp,
                maxHp: unit.maxHp,
                active: unit.active,
                roll: unit.manaRoll,
                stats: unit.stats,
              })),
              statuses: combat.statuses.map((status) => ({ statusId: status.statusId, holder: status.holderKey, duration: status.duration })),
              rngState: combat.rngState,
            }
          : null,
      });
    window.advanceTime = () => undefined;
  }, [view, shopTab, loading, isAuthed, data, combat, unlockQueue]);

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!sessionReady) return <Shell><Loading message="Checking session..." /></Shell>;
  if (!isAuthed) return <Shell><AuthScreen onAuthed={() => refresh()} error={error} setError={setError} /></Shell>;
  if (!data?.player) return <Shell><Loading message="Loading Rollcasters..." error={error} /></Shell>;

  return (
    <Shell className={view === "collection" || view === "shop" ? "collection-shell" : ""}>
      <TopBar
        data={data}
        player={data.player}
        refreshing={loading}
        onHome={() => navigate(data.player?.profile.starter_selected_at ? "home" : "starter")}
        onSignOut={async () => {
          await signOut();
          setIsAuthed(false);
        }}
      />
      {error && <div className="notice error">{error}</div>}
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
          onCollection={() => navigate("collection")}
          onShop={() => navigate("shop", "shard")}
          onPlay={() => navigate("play")}
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
          onRefresh={() => refresh("collection")}
          onBack={() => navigate("home")}
        />
      )}
      {view === "shop" && (
        <ShopScreen
          data={data}
          tab={shopTab}
          setTab={(tab) => navigate("shop", tab)}
          onBack={() => navigate("home")}
          onRefresh={() => refresh("shop")}
        />
      )}
      {view === "play" && (
        <PlayScreen
          data={data}
          onBack={() => navigate("home")}
          onStart={async (dungeon) => {
            setLoading(true);
            try {
              const run = await startDungeonRun(dungeon.id);
              const initialCombat = createInitialCombatState(data.catalog, data.player!, dungeon, run.id, run.selectedOpponents);
              await snapshotDungeonRunEffects(run.id, initialCombat.snapshot);
              setCombat(initialCombat);
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
          onTurnResolved={async (resolved) => {
            setCombat(resolved);
            if (!resolved.runId || resolved.turnEvents.length === 0) return;
            try {
              await submitCollectibleCombatEvents(resolved.runId, combat.turn, resolved.turnEvents);
              await refresh("combat");
            } catch (progressError) {
              console.error("Unable to submit collectible combat progress.", progressError);
              setError(errorMessage(progressError, "Unable to update challenge progress."));
            }
          }}
          onBack={() => navigate("play")}
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
      {view === "rewards" && combat && <RewardScreen data={data} combat={combat} onContinue={() => { setCombat(null); navigate("home"); }} />}
      {unlockQueue[0] && <UnlockNotification data={data} event={unlockQueue[0]} onClose={() => setUnlockQueue((current) => current.slice(1))} />}
    </Shell>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function Shell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <main className={`app-shell ${className}`.trim()}>
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
    <section className="setup-panel loading-panel">
      <BrandLogo />
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
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setError(null);
            setMode(mode === "login" ? "signup" : "login");
          }}
        >
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
  refreshing,
  onHome,
  onSignOut,
}: {
  data: AppData;
  player: PlayerState;
  refreshing: boolean;
  onHome: () => void;
  onSignOut: () => void;
}) {
  const currencies = orderedCurrencies(data);
  const topBarRef = useRef<HTMLElement>(null);
  const currencyTooltipRef = useRef<HTMLSpanElement>(null);

  const showCurrencyTooltip = (element: HTMLElement, label: string) => {
    const topBar = topBarRef.current;
    const tooltip = currencyTooltipRef.current;
    if (!topBar || !tooltip) return;
    const topBarRect = topBar.getBoundingClientRect();
    const currencyRect = element.getBoundingClientRect();
    const tooltipMaxWidth = Math.min(260, window.innerWidth - 24);
    tooltip.textContent = label;
    tooltip.style.color = window.getComputedStyle(element).color;
    tooltip.style.left = `${Math.max(0, Math.min(currencyRect.left - topBarRect.left, topBarRect.width - tooltipMaxWidth))}px`;
    tooltip.style.top = `${currencyRect.bottom - topBarRect.top + 7}px`;
    tooltip.classList.add("visible");
  };

  const hideCurrencyTooltip = () => currencyTooltipRef.current?.classList.remove("visible");

  return (
    <header ref={topBarRef} className={`top-bar ${currencies.length > 3 ? "currency-rich" : ""}`.trim()}>
      {refreshing && (
        <div className="refresh-indicator" role="status" aria-live="polite" title="Refreshing game data">
          <RefreshCw aria-hidden="true" />
          <span>Refreshing</span>
          <span className="sr-only"> game data</span>
        </div>
      )}
      <button type="button" className="brand-home-button" onClick={onHome} aria-label="Rollcasters home">
        <BrandLogo compact />
      </button>
      <div className="account-cluster">
        <div
          className="currency-cluster"
          aria-label="Currency balances"
          onMouseLeave={hideCurrencyTooltip}
          onScroll={hideCurrencyTooltip}
        >
          {currencies.map((currency) => {
            const amount = formatAmount(currencyBalance(data, currency.id));
            const label = `${currency.name}: ${amount}`;
            return (
              <div
                className="coin-pill currency-pill"
                key={currency.id}
                role="group"
                tabIndex={0}
                aria-label={label}
                data-currency-id={currency.id}
                style={currency.text_color ? { color: currency.text_color } : undefined}
                onMouseEnter={(event) => showCurrencyTooltip(event.currentTarget, label)}
                onFocus={(event) => showCurrencyTooltip(event.currentTarget, label)}
                onBlur={hideCurrencyTooltip}
              >
                <AssetIcon path={catalogAssetPath(data, "currency", currency.id, currency.asset_path)} alt={currency.name} fallback={<Coins size={17} />} />
                <span>{amount}</span>
              </div>
            );
          })}
        </div>
        <div className="user-pill">
          <UserRound size={17} />
          {player.profile.username}
        </div>
        <button className="icon-button" onClick={onSignOut} aria-label="Log out">
          <LogOut size={18} />
        </button>
      </div>
      <span
        ref={currencyTooltipRef}
        className="currency-hover-tooltip"
        aria-hidden="true"
      />
    </header>
  );
}

function BrandLogo({ compact = false }: { compact?: boolean }) {
  return <span className="brand-lockup">
    <img className={`brand-logo ${compact ? "signed-in" : ""}`} src={rollcastersLogoUrl} alt="Rollcasters" draggable={false} />
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
  | { type: "skill"; slotIndex: number; owned: UserCritter; gridWidth: number }
  | { type: "relic"; slotIndex: number; owned: UserCritter }
  | { type: "ability"; slotIndex: number; owned: UserRollcaster }
  | { type: "rollcaster"; slotIndex: number };

function HomeScreen({ data, onCollection, onShop, onPlay, onRefresh }: { data: AppData; onCollection: () => void; onShop: () => void; onPlay: () => void; onRefresh: () => Promise<void> }) {
  const player = data.player!;
  const activeRollcaster = player.rollcasters.find((row) => row.id === player.profile.active_rollcaster_id) ?? player.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, activeRollcaster?.rollcaster_id);
  const squad = player.squadSlots.slice().sort((a, b) => a.slot_index - b.slot_index);
  const [equipTarget, setEquipTarget] = useState<EquipTarget | null>(null);
  const [equipError, setEquipError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const squadPanelRef = useRef<HTMLElement>(null);
  const squadLayoutKey = squad.map((slot) => `${slot.slot_index}:${slot.user_critter_id ?? "empty"}`).join("|");
  const abilityCount = unlockedAbilitySlotCount(data, activeRollcaster);
  const rollcasterProgress = activeRollcaster && rollcaster
    ? xpProgress(
        data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id),
        activeRollcaster.level,
        activeRollcaster.xp,
      )
    : null;

  useLayoutEffect(() => {
    const panel = squadPanelRef.current;
    if (!panel) return;

    let animationFrame = 0;
    let lastWidth = -1;
    const syncSlotHeight = () => {
      window.cancelAnimationFrame(animationFrame);
      panel.style.removeProperty("--squad-slot-height");
      animationFrame = window.requestAnimationFrame(() => {
        const occupiedSlot = panel.querySelector<HTMLElement>(".loadout-slot:not(.empty)");
        if (!occupiedSlot) return;
        const occupiedHeight = occupiedSlot.getBoundingClientRect().height;
        panel.style.setProperty("--squad-slot-height", `${Math.ceil(occupiedHeight * 100) / 100}px`);
      });
    };

    syncSlotHeight();
    void document.fonts?.ready.then(syncSlotHeight);
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (Math.abs(width - lastWidth) < 0.1) return;
      lastWidth = width;
      syncSlotHeight();
    });
    observer.observe(panel);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      panel.style.removeProperty("--squad-slot-height");
    };
  }, [squadLayoutKey]);

  async function equip(operation: () => Promise<void>) {
    setSaving(true);
    setEquipError(null);
    try {
      await operation();
      await onRefresh();
      setEquipTarget(null);
    } catch (err) {
      setEquipError(errorMessage(err, "Unable to update loadout."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <><section className="home-layout">
      <div className="home-rollcaster-column">
        <aside className="rollcaster-panel">
          <p className="eyebrow">Active Rollcaster</p>
          <button className="portrait-button" onClick={() => setEquipTarget({ type: "rollcaster", slotIndex: 1 })} aria-label="Choose active Rollcaster">
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster?.name ?? "Shanks"} element="basic" assetPath={catalogAssetPath(data, "rollcaster", rollcaster?.id, rollcaster?.asset_path)} size="hero" fit="portrait" /></CardSprite>
          </button>
          <h1>{rollcaster?.name ?? "Unknown"}</h1>
          {rollcasterProgress && <ProgressBar progress={rollcasterProgress} inline className="rollcaster-xp-progress" />}
          <p className="rollcaster-level">Level {activeRollcaster?.level ?? 1}</p>
          <div className="ability-list" aria-label="Rollcaster abilities">
            {Array.from({ length: abilityCount }, (_, index) => {
              const slotIndex = index + 1;
              const row = player.abilitySlots.find((slot) => slot.user_rollcaster_id === activeRollcaster?.id && slot.slot_index === slotIndex);
              const ability = byId(data.catalog.rollcasterAbilities, row?.ability_id);
              return <AbilitySlot key={slotIndex} data={data} ability={ability} slotIndex={slotIndex} onClick={() => activeRollcaster && setEquipTarget({ type: "ability", slotIndex, owned: activeRollcaster })} />;
            })}
          </div>
        </aside>
        <ChallengeTracking data={data} onRefresh={onRefresh} />
      </div>

      <nav className="main-actions" aria-label="Main menu">
        <button className="menu-button play-button" onClick={onPlay}>
          <Play size={24} />
          Play
        </button>
        <button className="menu-button" onClick={onCollection}>
          <Gem size={24} />
          Collection
        </button>
        <button className="menu-button" onClick={onShop}>
          <ShoppingBag size={24} />
          Shop
        </button>
      </nav>

      <section ref={squadPanelRef} className="squad-panel">
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

function ChallengeTracking({ data, onRefresh }: { data: AppData; onRefresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const tracked = data.player!.collectibleSnapshot.tracked.filter((trackedRow) => {
    const progress = progressFor(data, trackedRow.challenge_id);
    return progress.eligible !== false;
  });

  async function untrack(challengeId: string) {
    setBusyId(challengeId);
    setTrackingError(null);
    try {
      await untrackCollectibleChallenge(challengeId);
      await onRefresh();
    } catch (error) {
      setTrackingError(errorMessage(error, "Unable to untrack challenge."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="challenge-tracking" aria-label="Challenge tracking">
      <div className="challenge-tracking-heading"><Target size={17} /><strong>Challenge Tracking</strong></div>
      {trackingError && <p className="tracking-error" role="alert">{trackingError}</p>}
      <div className="challenge-tracking-slots">
        {[1, 2, 3].map((slot) => {
          const trackedRow = tracked.find((row) => row.slot_order === slot);
          const challenge = data.catalog.collectibleUnlockChallenges.find((row) => row.id === trackedRow?.challenge_id);
          if (!challenge) return <div className="tracked-challenge-card empty" key={slot}><Target size={20} /><span>Tracking slot {slot}</span></div>;
          const progress = progressFor(data, challenge.id);
          return (
            <article className="tracked-challenge-card" key={slot}>
              <CollectibleSprite data={data} type={challenge.collectible_type} id={challenge.collectible_id} size="xs" />
              <div className="tracked-challenge-copy">
                <strong>{collectibleName(data, challenge.collectible_type, challenge.collectible_id)}</strong>
                <span>{challengeDescription(data, challenge)}</span>
                <span className="challenge-progress">{formatAmount(progress.current)} / {formatAmount(progress.goal)}</span>
              </div>
              <button className="link-button tracked-untrack" disabled={busyId === challenge.id} onClick={() => untrack(challenge.id)}>Untrack</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CollectibleSprite({ data, type, id, size = "sm", shard = false }: { data: AppData; type: CollectibleType; id: string; size?: "xs" | "sm" | "md"; shard?: boolean }) {
  const name = collectibleName(data, type, id);
  const critter = type === "critter" ? byId(data.catalog.critters, id) : undefined;
  const element = critter?.element_id ?? (type === "relic" ? "metal" : "basic");
  const content = <Sprite name={name} element={element} assetPath={catalogAssetPath(data, type, id, collectibleAssetPath(data, type, id))} size="small" fit={type === "rollcaster" ? "portrait" : "contain"} />;
  return shard
    ? <span className="shard-sprite-glow" role="img" aria-label={`${name} shards`}><svg className="shard-sprite-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon className="shard-outline-glow shard-outline-glow-wide" points="1,50 50,1 99,50 50,99" /><polygon className="shard-outline-glow shard-outline-glow-mid" points="1,50 50,1 99,50 50,99" /><polygon className="shard-outline-border" points="1,50 50,1 99,50 50,99" /></svg><span className="shard-sprite-frame" aria-hidden="true">{content}</span></span>
    : <SpriteFrame size={size}>{content}</SpriteFrame>;
}

function CritterLoadoutSlot({ data, slotIndex, owned, onEquip }: { data: AppData; slotIndex: number; owned?: UserCritter; onEquip: (target: EquipTarget) => void }) {
  if (!owned) {
    return (
      <button className="loadout-slot empty" onClick={() => onEquip({ type: "critter", slotIndex })}>
        <Plus className="empty-relic-plus" aria-hidden="true" /><h3>Squad slot {slotIndex}</h3><p>Choose a critter</p>
      </button>
    );
  }

  const critter = byId(data.catalog.critters, owned.critter_id)!;
  const calculated = calculateLoadoutStats(data, owned);
  const stats = calculated.stats;
  const progress = xpProgress(
    data.catalog.critterProgression.filter((row) => row.critter_id === critter.id),
    owned.level,
    owned.xp,
  );
  const relicSlotStates = relicSlotUnlocks(data.catalog.critterProgression, critter.id);

  return (
    <article className="loadout-slot">
      <div className="loadout-critter-summary">
        <button className="slot-topline slot-button loadout-critter-header" onClick={() => onEquip({ type: "critter", slotIndex })} aria-label={`Change ${critter.name} in squad slot ${slotIndex}`}>
          <SpriteFrame size="md" className="loadout-critter-frame"><Sprite name={critter.name} element={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} size="small" /></SpriteFrame>
          <div className="loadout-critter-content">
            <div className="loadout-critter-identity">
              <CritterName data={data} critter={critter} />
            </div>
            <div className="loadout-critter-progression">
              <p className="loadout-critter-level">Level {owned.level}</p>
              <ProgressBar progress={progress} inline className="loadout-critter-xp-progress" />
            </div>
          </div>
        </button>
        <StatGrid stats={stats} breakdowns={calculated.breakdowns} compact />
      </div>
      <div className="loadout-equipment-grid">
        <SkillTileGrid ariaLabel={`${critter.name} skill slots`}>
          {[1, 2, 3, 4].map((skillSlot) => {
            const row = data.player!.skillSlots.find((candidate) => candidate.user_critter_id === owned.id && candidate.slot_index === skillSlot);
            return <SkillTile key={skillSlot} data={data} skill={byId(data.catalog.skills, row?.skill_id)} onClick={(event) => {
              const grid = event.currentTarget.closest(".skill-tile-grid");
              onEquip({ type: "skill", slotIndex: skillSlot, owned, gridWidth: grid?.getBoundingClientRect().width ?? 0 });
            }} />;
          })}
        </SkillTileGrid>
        <div className="loadout-relic-grid" aria-label="Relic slots">
          {relicSlotStates.map(({ slotIndex: relicSlot, unlockLevel }) => {
            if (unlockLevel === null) return <span key={relicSlot} className="loadout-relic-cell null" aria-hidden="true" />;
            if (relicSlot > stats.relicSlots) return <button key={relicSlot} type="button" className="loadout-relic-cell locked" disabled aria-label={`Relic slot ${relicSlot} unlocks at level ${unlockLevel}`}><Lock aria-hidden="true" /><span>Level {unlockLevel}</span></button>;
            const row = data.player!.relicSlots.find((candidate) => candidate.user_critter_id === owned.id && candidate.slot_index === relicSlot);
            return <LoadoutRelicSlot key={relicSlot} data={data} relic={byId(data.catalog.relics, row?.relic_id)} slotIndex={relicSlot} onClick={() => onEquip({ type: "relic", slotIndex: relicSlot, owned })} />;
          })}
        </div>
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

function SkillTileGrid({ ariaLabel, children, width }: { ariaLabel: string; children: React.ReactNode; width?: number }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(Boolean(width && width <= 180));

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => setCompact(grid.getBoundingClientRect().width <= 180);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [width]);

  return <div ref={gridRef} className={`skill-tile-grid ${compact ? "compact" : ""}`.trim()} aria-label={ariaLabel} style={width ? { width: "100%", maxWidth: width } : undefined}>{children}</div>;
}

function SkillTile({ data, skill, onClick, disabled = false, disabledReason, selected = false, equipped = false }: { data: AppData; skill?: Skill | null; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; disabledReason?: string; selected?: boolean; equipped?: boolean }) {
  const element = skill ? byId(data.catalog.elements, skill.element_id) : null;
  const elementPath = skill ? catalogAssetPath(data, "element", skill.element_id, element?.asset_path, "icon") : null;
  const manaPath = findAssetPath(data, "mana", "mana");
  const attachments = skill ? data.catalog.effectsBySkill[skill.id] ?? [] : [];
  const effectText = skill ? attachmentText(attachments) : "";
  const targetText = skill ? targetingDescription(skill) : "";
  const label = skill ? `${skill.name}, ${skill.skill_type}${skill.skill_type === "attack" ? `, ${skill.power} power` : ""}. ${skill.description} ${effectText} ${targetText}` : "Choose a skill.";
  const tooltip = skill ? <><span className="tooltip-heading"><AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={18} />} /><strong>{skill.name} - {skill.skill_type === "attack" ? "Attack" : "Support"}{skill.skill_type === "attack" ? ` - ${skill.power} Power` : ""}</strong></span><span className="tooltip-description">{skill.description}</span>{attachmentRows(attachments)}<span className="tooltip-target">{targetText}</span>{disabledReason && <span className="tooltip-disabled">{disabledReason}</span>}</> : <span className="tooltip-description">Choose a skill.</span>;
  return <GameTooltip label={label.trim()} content={tooltip}><button type="button" className={`skill-tile ${skill ? "" : "empty"} ${selected ? "selected" : ""} ${equipped ? "equipped" : ""} ${!onClick ? "read-only" : ""}`} onClick={onClick} disabled={disabled} aria-disabled={!onClick || undefined}>
    <span className="skill-title">{skill && <AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={16} />} />}<strong>{skill?.name ?? "-----"}</strong></span>
    {skill?.skill_type === "attack" && <span className="skill-power">PWR {skill.power}</span>}
    {skill && <span className="skill-mana"><AssetIcon path={manaPath} alt="Mana" fallback={<Gem size={15} />} />{skill.mana_cost}</span>}
    {(selected || equipped) && <Check className="selection-check" size={15} />}
  </button></GameTooltip>;
}

function RelicSlot({ data, relic, slotIndex, onClick }: { data: AppData; relic?: Relic | null; slotIndex: number; onClick: () => void }) {
  const attachments = relic ? data.catalog.effectsByRelic[relic.id] ?? [] : [];
  const details = relic ? `${relic.name}. ${relic.description} ${attachmentText(attachments)}` : "Choose a relic.";
  const tooltip = relic ? <><span className="tooltip-heading"><strong>{relic.name}</strong></span><span className="tooltip-description">{relic.description}</span>{attachmentRows(attachments)}</> : <span className="tooltip-description">Choose a relic.</span>;
  return <GameTooltip label={details.trim()} content={tooltip}><button type="button" className="relic-slot" onClick={onClick} aria-label={`Equip relic · Slot ${slotIndex}`}>
    <SpriteFrame size="sm">{relic
      ? <AssetIcon path={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} alt={relic.name} fallback={<Shield size={26} />} />
      : <Plus className="empty-relic-plus" aria-hidden="true" />}</SpriteFrame>
    <span>{relic?.name ?? "-----"}</span>
  </button></GameTooltip>;
}

function LoadoutRelicSlot({ data, relic, slotIndex, onClick }: { data: AppData; relic?: Relic | null; slotIndex: number; onClick: () => void }) {
  const attachments = relic ? data.catalog.effectsByRelic[relic.id] ?? [] : [];
  const details = relic ? `${relic.name}. ${relic.description} ${attachmentText(attachments)}` : `Choose a relic for slot ${slotIndex}.`;
  const tooltip = relic ? <><span className="tooltip-heading"><strong>{relic.name}</strong></span><span className="tooltip-description">{relic.description}</span>{attachmentRows(attachments)}</> : <span className="tooltip-description">Choose a relic for slot {slotIndex}.</span>;
  return <GameTooltip label={details.trim()} content={tooltip}><button type="button" className={`loadout-relic-cell unlocked ${relic ? "equipped" : "empty"}`} onClick={onClick} aria-label={`Equip relic · Slot ${slotIndex}`}>
    {relic
      ? <AssetIcon path={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} alt={relic.name} fallback={<Shield aria-hidden="true" />} />
      : <Plus className="empty-relic-plus" aria-hidden="true" />}
  </button></GameTooltip>;
}

function AbilitySlot({ data, ability, slotIndex, onClick }: { data: AppData; ability?: { id: string; name: string; description: string } | null; slotIndex: number; onClick: () => void }) {
  const attachments = ability ? data.catalog.effectsByAbility[ability.id] ?? [] : [];
  const effect = ability ? attachmentText(attachments) : "";
  const details = ability ? `${ability.name}. ${ability.description} ${effect}` : "Choose an ability.";
  const tooltip = ability ? <><span className="tooltip-heading"><strong>{ability.name}</strong></span><span className="tooltip-description">{ability.description}</span>{attachmentRows(attachments)}</> : <span className="tooltip-description">Choose an ability.</span>;
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
    case "all_allies": return "Targets every active Friendly teammate except the user.";
    case "self_only": return "Targets only the acting Critter.";
    default: return "Targets one Enemy Critter.";
  }
}

function attachmentText(effects: ResolvedEffectRef[]): string {
  return effects.map((effect) => `${effect.name}: ${effect.description}`).join(" ");
}

function attachmentRows(effects: ResolvedEffectRef[]): React.ReactNode {
  return effects.map((effect) => <span className="tooltip-description" key={effect.id}><strong>{effect.name}:</strong> {effect.description}</span>);
}

function EffectList({ effects, className = "" }: { effects: ResolvedEffectRef[]; className?: string }) {
  return (
    <span className={`effect-list ${className}`.trim()}>
      {effects.length
        ? effects.map((effect) => <span className="effect-list-row" key={effect.id}><strong>{effect.name}:</strong> {effect.description}</span>)
        : <span className="effect-list-row">No additional effect.</span>}
    </span>
  );
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
    const canRemoveCurrent = player.squadSlots.filter((row) => row.user_critter_id).length > 1;
    content = eligible.length ? <div className="candidate-grid">{eligible.map((owned) => {
      const critter = byId(data.catalog.critters, owned.critter_id)!;
      const selected = current === owned.id;
      const inSquad = assigned.has(owned.id);
      const disabled = saving || (inSquad && !selected) || (selected && !canRemoveCurrent);
      return <button className={`candidate-card ${selected ? "selected" : ""} ${inSquad && !selected ? "in-squad" : ""}`} key={owned.id} disabled={disabled} onClick={() => onEquip(() => setSquadSlot(target.slotIndex, selected ? null : owned.id))}>
        <SpriteFrame size="md" selected={selected}><Sprite name={critter.name} element={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>
        <CritterName data={data} critter={critter} /><span>Level {owned.level}</span>{selected ? <span className="state-badge remove-badge">Select again to remove</span> : inSquad && <span className="state-badge"><Check size={14} /> In squad</span>}
      </button>;
    })}</div> : <p className="empty-state">No critters available</p>;
  } else if (target.type === "skill") {
    const ids = player.unlockedSkillIdsByCritter[target.owned.id] ?? [];
    const rows = player.skillSlots.filter((row) => row.user_critter_id === target.owned.id);
    const current = rows.find((row) => row.slot_index === target.slotIndex)?.skill_id;
    const equippedElsewhere = new Set(rows.filter((row) => row.slot_index !== target.slotIndex).map((row) => row.skill_id));
    const equippedCount = rows.filter((row) => row.skill_id).length;
    const eligible = ids.map((id) => byId(data.catalog.skills, id)).filter((skill): skill is Skill => Boolean(skill));
    content = eligible.length ? <SkillTileGrid ariaLabel="Available skills" width={target.gridWidth}>{eligible.map((skill) => {
      const selected = current === skill.id;
      const equipped = selected || equippedElsewhere.has(skill.id);
      const cannotRemoveLast = selected && equippedCount <= 1;
      return <SkillTile
        key={skill.id}
        data={data}
        skill={skill}
        selected={selected}
        equipped={equipped}
        disabled={saving || equippedElsewhere.has(skill.id) || cannotRemoveLast}
        disabledReason={cannotRemoveLast ? "At least one skill must remain equipped." : equippedElsewhere.has(skill.id) ? "Equipped in another slot." : undefined}
        onClick={() => onEquip(() => setCritterSkillSlot(target.owned.id, target.slotIndex, selected ? null : skill.id))}
      />;
    })}</SkillTileGrid> : <p className="empty-state">No skills available</p>;
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
        <SpriteFrame size="md" selected={current === relic.id}><Sprite name={relic.name} element="metal" assetPath={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} /></SpriteFrame><strong>{relic.name}</strong><span>{relic.description}</span>{attachmentRows(data.catalog.effectsByRelic[relic.id] ?? [])}<span className="inventory-count">Owned {owned} · Equipped {used} · Available {owned - used}</span>
      </button>;
    })}</div> : <p className="empty-state">No relics available</p>;
  } else if (target.type === "ability") {
    const ids = player.unlockedAbilityIdsByRollcaster[target.owned.id] ?? [];
    const rows = player.abilitySlots.filter((row) => row.user_rollcaster_id === target.owned.id);
    const current = rows.find((row) => row.slot_index === target.slotIndex)?.ability_id;
    const equippedElsewhere = new Set(rows.filter((row) => row.slot_index !== target.slotIndex).map((row) => row.ability_id));
    const eligible = ids.map((id) => byId(data.catalog.rollcasterAbilities, id)).filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
    content = eligible.length ? <div className="ability-candidates">{eligible.map((ability) => {
      const selected = current === ability.id;
      const equipped = selected || equippedElsewhere.has(ability.id);
      return <button className={`ability-candidate ${selected ? "selected" : ""} ${equipped ? "equipped" : ""}`} key={ability.id} disabled={saving || equippedElsewhere.has(ability.id)} onClick={() => onEquip(() => setRollcasterAbilitySlot(target.owned.id, target.slotIndex, selected ? null : ability.id))}><span><strong>{ability.name}</strong><small>{ability.description}</small>{attachmentRows(data.catalog.effectsByAbility[ability.id] ?? [])}</span>{equipped && <Check size={18} />}</button>;
    })}</div> : <p className="empty-state">No abilities available</p>;
  } else {
    content = <div className="candidate-grid">{player.rollcasters.map((owned) => {
      const entry = byId(data.catalog.rollcasters, owned.rollcaster_id)!;
      const selected = player.profile.active_rollcaster_id === owned.id;
      return <button className={`candidate-card ${selected ? "selected" : ""}`} key={owned.id} disabled={saving || selected} onClick={() => onEquip(() => setActiveRollcaster(owned.id))}><SpriteFrame size="lg" selected={selected}><Sprite name={entry.name} element="basic" assetPath={catalogAssetPath(data, "rollcaster", entry.id, entry.asset_path)} size="large" fit="portrait" /></SpriteFrame><strong>{entry.name}</strong><span>Level {owned.level}</span></button>;
    })}</div>;
  }

  const currentRelic = target.type === "relic" ? player.relicSlots.find((row) => row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)?.relic_id : null;
  const currentAbility = target.type === "ability" ? player.abilitySlots.find((row) => row.user_rollcaster_id === target.owned.id && row.slot_index === target.slotIndex)?.ability_id : null;
  const canUnequip = (target.type === "relic" && Boolean(currentRelic)) || (target.type === "critter" && player.squadSlots.filter((row) => row.user_critter_id).length > 1) || (target.type === "skill" && player.skillSlots.filter((row) => row.user_critter_id === target.owned.id && row.skill_id).length > 1) || (target.type === "ability" && Boolean(currentAbility));
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
  onRefresh,
  onBack,
}: {
  data: AppData;
  tab: CollectionTab;
  setTab: (tab: CollectionTab) => void;
  detail: CollectionDetail | null;
  setDetail: (detail: CollectionDetail | null) => void;
  onRefresh: () => Promise<void>;
  onBack: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [elementId, setElementId] = useState<string | null>(null);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchesSearch = (entry: { id: string; name: string }) =>
    !normalizedQuery || entry.id.toLocaleLowerCase().includes(normalizedQuery) || entry.name.toLocaleLowerCase().includes(normalizedQuery);
  const rollcasters = sortByCollectibleId(data.catalog.rollcasters).filter(matchesSearch);
  const critters = sortByCollectibleId(data.catalog.critters).filter(
    (critter) => matchesSearch(critter) && (!elementId || critter.element_id === elementId),
  );
  const relics = sortByCollectibleId(data.catalog.relics).filter(matchesSearch);
  const displayedCount = tab === "rollcasters" ? rollcasters.length : tab === "critters" ? critters.length : relics.length;

  return (
    <section className="screen-stack collection-screen">
      <div className="screen-heading row">
        <div>
          <h1>Collection</h1>
          <p>Review owned and locked game pieces.</p>
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
      <div className="collection-tools">
        <label className="collection-search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">Search {tab} by name or ID</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={`Search ${tab} by name or ID`}
          />
        </label>
        <div className="collection-filter-slot">
          {tab === "critters"
            ? <ElementFilter data={data} selectedId={elementId} onChange={setElementId} />
            : <div className="collection-filter-placeholder" aria-hidden="true" />}
        </div>
      </div>
      <div className="collection-grid-content">
        {tab === "rollcasters" && <RollcasterGrid data={data} rollcasters={rollcasters} setDetail={setDetail} />}
        {tab === "critters" && <CritterGrid data={data} critters={critters} setDetail={setDetail} />}
        {tab === "relics" && <RelicGrid data={data} relics={relics} setDetail={setDetail} />}
        {displayedCount === 0 && <p className="collection-empty">No {tab} match the current filters.</p>}
      </div>
      {detail && <DetailModal data={data} detail={detail} onRefresh={onRefresh} onClose={() => setDetail(null)} />}
    </section>
  );
}

function ShopScreen({ data, tab, setTab, onBack, onRefresh }: { data: AppData; tab: ShopTab; setTab: (tab: ShopTab) => void; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const normalized = query.trim().toLocaleLowerCase();
  const authoredEntries = data.catalog.shopEntries.filter((entry) => entry.shop_type === tab);
  const validEntries = authoredEntries.filter((entry) => currencyFor(data, entry.currency_id) && collectibleTargetAvailable(data, entry.target_category, entry.target_id));
  const entries = validEntries.filter((entry) => !normalized
    || entry.name.toLocaleLowerCase().includes(normalized)
    || entry.target_id.toLocaleLowerCase().includes(normalized)
    || collectibleName(data, entry.target_category, entry.target_id).toLocaleLowerCase().includes(normalized));

  useEffect(() => {
    authoredEntries.filter((entry) => !validEntries.includes(entry)).forEach((entry) => {
      console.warn("Omitting shop entry with unavailable target or currency.", entry.id);
    });
  }, [authoredEntries.map((entry) => entry.id).join("|"), validEntries.map((entry) => entry.id).join("|")]);

  async function purchase(entry: ShopEntry) {
    setBusyEntry(entry.id); setFeedback(null);
    const requestId = requestIds.current.get(entry.id) ?? crypto.randomUUID();
    requestIds.current.set(entry.id, requestId);
    try {
      const receipt = await purchaseShopEntry(entry.id, requestId);
      requestIds.current.delete(entry.id);
      const hasDiscarded = receipt.discarded !== "0";
      setFeedback({
        tone: "success",
        message: hasDiscarded
          ? `Purchase complete. ${formatAmount(receipt.granted)} granted and ${formatAmount(receipt.discarded)} overflow discarded.`
          : `Purchase complete. ${formatAmount(receipt.granted)} granted.`,
      });
      await onRefresh();
    } catch (error) {
      setFeedback({ tone: "error", message: shopErrorMessage(error) });
    } finally {
      setBusyEntry(null);
    }
  }

  const groups: Array<{ type: CollectibleType; label: string }> = [
    { type: "critter", label: "Critter Shards" },
    { type: "rollcaster", label: "Rollcaster Shards" },
    { type: "relic", label: "Relic Shards" },
  ];

  return (
    <section className="screen-stack shop-screen">
      <div className="screen-heading row"><div><p className="eyebrow">Camp Market</p><h1>Shop</h1><p>Spend your currencies on shards and Relics.</p></div><button className="secondary-button" onClick={onBack}>Back</button></div>
      <div className="tabs shop-tabs" role="tablist" aria-label="Shop categories">
        <button className={tab === "shard" ? "active" : ""} onClick={() => setTab("shard")}>Shard Shop</button>
        <button className={tab === "relic" ? "active" : ""} onClick={() => setTab("relic")}>Relic Shop</button>
        <button className={tab === "lootbox" ? "active" : ""} disabled title="Coming later">Lootbox Shop <small>Coming later</small></button>
      </div>
      <label className="collection-search shop-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search shop entries by name or collectible ID</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by offer, collectible name, or ID" /></label>
      {feedback && <p className={`notice ${feedback.tone === "error" ? "error" : "success"}`} role="status">{feedback.message}</p>}
      {tab === "lootbox" ? <div className="shop-empty"><ShoppingBag size={38} /><h2>Lootbox Shop</h2><p>Coming later. Lootboxes, rolls, pity rules, and awards are intentionally reserved for a separate system.</p></div> : tab === "shard" ? (
        <div className="shop-groups">
          {groups.map((group) => {
            const grouped = entries.filter((entry) => entry.target_category === group.type);
            if (!grouped.length) return null;
            return <section className="shop-group" key={group.type}><h2>{group.label}</h2><div className="shop-grid">{grouped.map((entry) => <ShopEntryCard key={entry.id} data={data} entry={entry} busy={busyEntry === entry.id} onPurchase={() => purchase(entry)} />)}</div></section>;
          })}
          {entries.length === 0 && <ShopEmptyState hasAuthoredEntries={validEntries.length > 0} />}
        </div>
      ) : <div className="shop-grid">{entries.map((entry) => <ShopEntryCard key={entry.id} data={data} entry={entry} busy={busyEntry === entry.id} onPurchase={() => purchase(entry)} />)}{entries.length === 0 && <ShopEmptyState hasAuthoredEntries={validEntries.length > 0} />}</div>}
    </section>
  );
}

function ShopEmptyState({ hasAuthoredEntries }: { hasAuthoredEntries: boolean }) {
  return <div className="shop-empty"><ShoppingBag size={34} /><h2>{hasAuthoredEntries ? "No shop entries match" : "No offers available yet"}</h2><p>{hasAuthoredEntries ? "Try a different name or collectible ID." : "Active offers authored in Content Studio will appear here."}</p></div>;
}

function ShopEntryCard({ data, entry, busy, onPurchase }: { data: AppData; entry: ShopEntry; busy: boolean; onPurchase: () => void }) {
  const availability = shopAvailability(data, entry);
  const soldOut = availability.code === "COLLECTIBLE_ALREADY_UNLOCKED" || availability.code === "RELIC_MAX_OWNED_REACHED";
  const currency = currencyFor(data, entry.currency_id)!;
  const targetName = collectibleName(data, entry.target_category, entry.target_id);
  const description = entry.description?.trim();
  const showDescription = Boolean(description && !/\bshop offer for\b/i.test(description));
  const inventory = entry.target_category === "relic" ? data.player!.relicInventory.find((row) => row.relic_id === entry.target_id) : undefined;
  const relicChallenge = entry.shop_type === "relic" ? challengesFor(data, "relic", entry.target_id).find((row) => row.challenge_type === "shop_relic") : undefined;
  const ownershipLabel = entry.shop_type === "shard"
    ? `Shards: ${formatAmount(availability.current)} / ${formatAmount(availability.goal)}`
    : collectibleIsOwned(data, "relic", entry.target_id)
      ? `Owned: ${formatAmount(inventory?.quantity ?? 0)} / ${formatAmount(availability.goal)}`
      : `Owned: ${formatAmount(inventory?.quantity ?? 0)} / ${formatAmount(relicChallenge?.required_amount ?? 0)} to unlock`;
  return (
    <article className={`shop-entry-card ${soldOut ? "sold-out" : ""}`.trim()} data-shop-type={entry.shop_type} data-availability-code={availability.code ?? "AVAILABLE"}>
      <span className="shop-entry-category">{entry.target_category}</span>
      <CollectibleSprite data={data} type={entry.target_category} id={entry.target_id} size="md" shard={entry.shop_type === "shard"} />
      <div className="shop-entry-copy"><h3>{entry.name}</h3><p className="shop-target">{targetName} ({entry.target_id})</p>{showDescription && <p>{description}</p>}</div>
      <div className="shop-entry-meta">
        <strong>{formatAmount(entry.quantity)} × {entry.shop_type === "shard" ? "Shards" : targetName}</strong>
        <span className="shop-price"><AssetIcon path={catalogAssetPath(data, "currency", currency.id, currency.asset_path)} alt={currency.name} fallback={<Coins size={18} />} />{formatAmount(entry.price)}</span>
      </div>
      <p className="shop-owned">{ownershipLabel}</p>
      <button className="primary-button shop-purchase" disabled={busy || !availability.enabled} onClick={onPurchase}>{busy ? "Purchasing…" : "Purchase"}</button>
      {!availability.enabled && <p className="shop-unavailable">{availability.reason}</p>}
    </article>
  );
}

function ElementFilter({ data, selectedId, onChange }: { data: AppData; selectedId: string | null; onChange: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const selected = selectedId ? byId(data.catalog.elements, selectedId) : null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const elements = [...data.catalog.elements]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((element) => !normalizedQuery || element.name.toLocaleLowerCase().includes(normalizedQuery) || element.id.toLocaleLowerCase().includes(normalizedQuery));

  function select(id: string | null) {
    onChange(id);
    setQuery("");
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details className="element-filter" ref={detailsRef}>
      <summary>
        <span className="element-filter-value">
          {selected && <ElementIcon data={data} elementId={selected.id} />}
          <span>{selected?.name ?? "None"}</span>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="element-filter-menu">
        <label className="element-filter-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search elemental types</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search elements" />
        </label>
        <div className="element-filter-options" role="listbox" aria-label="Elemental type">
          <button type="button" className={!selectedId ? "selected" : ""} role="option" aria-selected={!selectedId} onClick={() => select(null)}>None</button>
          {elements.map((element) => (
            <button key={element.id} type="button" className={selectedId === element.id ? "selected" : ""} role="option" aria-selected={selectedId === element.id} onClick={() => select(element.id)}>
              <ElementIcon data={data} elementId={element.id} />
              <span>{element.name}</span>
            </button>
          ))}
          {elements.length === 0 && <span className="element-filter-empty">No elements found</span>}
        </div>
      </div>
    </details>
  );
}

function ElementIcon({ data, elementId }: { data: AppData; elementId: string }) {
  const element = byId(data.catalog.elements, elementId);
  const path = catalogAssetPath(data, "element", elementId, element?.asset_path, "icon");
  return <AssetIcon path={path} alt={`${element?.name ?? elementId} element`} fallback={<Sparkles size={16} />} />;
}

function CollectibleChallengeRows({ data, type, id, compact = true }: { data: AppData; type: CollectibleType; id: string; compact?: boolean }) {
  const challenges = challengesFor(data, type, id);
  if (!challenges.length) return <p className="collection-status challenge-empty">Not currently unlockable</p>;
  return (
    <div className={`challenge-rows ${compact ? "compact" : ""}`.trim()} aria-label={`${collectibleName(data, type, id)} unlock challenges`}>
      {challenges.map((challenge) => {
        const progress = progressFor(data, challenge.id);
        const gateBadge = challengeGateBadge(challenge);
        const blockedMessage = challengeGateBlockMessage(challenge, progress);
        return (
          <div className={`challenge-row ${progress.completed ? "complete" : ""} ${blockedMessage ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()} key={challenge.id}>
            <span className="challenge-row-copy">
              {(gateBadge || blockedMessage) && <span className="challenge-state-line">
                {gateBadge && <span className="gate-badge">{gateBadge}</span>}
                {blockedMessage && <span className="gate-blocked"><Lock size={11} />{blockedMessage}</span>}
              </span>}
              <span>{challengeDescription(data, challenge)}</span>
            </span>
            <strong>{formatAmount(progress.current)} / {formatAmount(progress.goal)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function RollcasterGrid({
  data,
  rollcasters,
  setDetail,
}: {
  data: AppData;
  rollcasters: AppData["catalog"]["rollcasters"];
  setDetail: (detail: { type: "rollcaster"; id: string }) => void;
}) {
  return (
    <div className="collection-grid">
      {rollcasters.map((rollcaster) => {
        const owned = data.player!.rollcasters.find((row) => row.rollcaster_id === rollcaster.id);
        const progress = xpProgress(
          data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id),
          owned?.level ?? 1,
          owned?.xp ?? 0,
        );
        return (
          <button key={rollcaster.id} className={`catalog-card rollcaster-card ${!owned ? "locked" : ""}`} onClick={() => setDetail({ type: "rollcaster", id: rollcaster.id })}>
            <span className="collectible-id">{rollcaster.id}</span>
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster.name} element="basic" assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} size="hero" fit="portrait" /></CardSprite>
            <CardName data={data} name={rollcaster.name} />
            {owned ? <><div className="collection-progression"><p>Level {owned.level}</p><ProgressBar progress={progress} /></div><PointCounter kind="ability" points={owned.ability_points} /></> : <CollectibleChallengeRows data={data} type="rollcaster" id={rollcaster.id} />}
          </button>
        );
      })}
    </div>
  );
}

function CritterGrid({
  data,
  critters,
  setDetail,
}: {
  data: AppData;
  critters: Critter[];
  setDetail: (detail: { type: "critter"; id: string }) => void;
}) {
  return (
    <div className="collection-grid">
      {critters.map((critter) => {
        const owned = data.player!.critters.find((row) => row.critter_id === critter.id);
        const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
        return (
          <button
            key={critter.id}
            className={`catalog-card critter-card ${!owned ? "locked challenge-locked" : ""}`}
            onClick={() => setDetail({ type: "critter", id: critter.id })}
          >
            <span className="collectible-id">{critter.id}</span>
            <CardSprite><Sprite
              name={critter.name}
              element={critter.element_id}
              assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)}
              size="large"
            /></CardSprite>
            <CardName data={data} name={critter.name} elementId={critter.element_id} />
            <div className="collection-card-state">
              {owned ? <div className="collection-progression critter-progression"><p>Level {owned.level}</p><ProgressBar progress={xpProgress(data.catalog.critterProgression.filter((row) => row.critter_id === critter.id), owned.level, owned.xp)} /></div> : <CollectibleChallengeRows data={data} type="critter" id={critter.id} />}
            </div>
            <StatGrid stats={stats} compact />
            <PointCounter kind="skill" points={owned?.skill_points ?? 0} />
          </button>
        );
      })}
    </div>
  );
}

function RelicGrid({ data, relics, setDetail }: { data: AppData; relics: Relic[]; setDetail: (detail: { type: "relic"; id: string }) => void }) {
  return (
    <div className="collection-grid">
      {relics.map((relic) => {
        const inventory = data.player!.relicInventory.find((row) => row.relic_id === relic.id);
        return <RelicCard key={relic.id} data={data} relic={relic} quantity={inventory?.quantity ?? 0} unlocked={inventory?.discovered_at != null} onClick={() => setDetail({ type: "relic", id: relic.id })} />;
      })}
    </div>
  );
}

function RelicCard({ data, relic, quantity, unlocked, onClick }: { data: AppData; relic: Relic; quantity: number; unlocked: boolean; onClick: () => void }) {
  const effects = data.catalog.effectsByRelic[relic.id] ?? [];
  return (
    <button className={`catalog-card relic-card ${!unlocked ? "locked" : ""}`} onClick={onClick}>
      <span className="collectible-id">{relic.id}</span>
      <CardSprite><Sprite name={relic.name} element="metal" assetPath={catalogAssetPath(data, "relic", relic.id, relic.asset_path)} size="large" /></CardSprite>
      <CardName data={data} name={relic.name} />
      <div className="collection-card-state">
        {unlocked ? <p>Owned {quantity} / {relic.max_owned}</p> : <CollectibleChallengeRows data={data} type="relic" id={relic.id} />}
      </div>
      <EffectList effects={effects} className="relic-card-effects" />
    </button>
  );
}

function PointCounter({ kind, points }: { kind: "skill" | "ability"; points: number }) {
  return <p className="point-counter"><strong>{points}</strong> {kind} point{points === 1 ? "" : "s"}</p>;
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

function CollectibleChallengePanel({ data, type, id, unlocked, onRefresh }: { data: AppData; type: CollectibleType; id: string; unlocked: boolean; onRefresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const challenges = challengesFor(data, type, id);
  if (!challenges.length) return <section className="collectible-challenge-panel"><h3>Collect</h3><p className="challenge-empty">Not currently unlockable through challenges.</p></section>;
  const required = requirementFor(data, type, id);
  const complete = challenges.filter((challenge) => progressFor(data, challenge.id).completed).length;
  const tracked = data.player!.collectibleSnapshot.tracked;
  const sameCollectibleTracked = tracked.some((row) => {
    const challenge = data.catalog.collectibleUnlockChallenges.find((candidate) => candidate.id === row.challenge_id);
    return challenge?.collectible_type === type && challenge.collectible_id === id;
  });
  const trackingFull = tracked.length >= 3 && !sameCollectibleTracked;

  async function changeTracking(challenge: CollectibleUnlockChallenge, currentlyTracked: boolean) {
    setBusyId(challenge.id); setPanelError(null);
    try {
      if (currentlyTracked) await untrackCollectibleChallenge(challenge.id);
      else await trackCollectibleChallenge(challenge.id);
      await onRefresh();
    } catch (error) {
      const raw = errorMessage(error, "Unable to update challenge tracking.");
      setPanelError(
        raw.includes("CHALLENGE_GATED")
          ? "Complete the required Gate Challenges before tracking this challenge."
          : raw.includes("TRACKING_LIMIT_REACHED")
            ? "3 challenge limit reached"
            : raw,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="collectible-challenge-panel">
      <div className="challenge-panel-heading">
        <div><p className="eyebrow">Collect</p><h3>Complete {required} of {challenges.length} challenges</h3></div>
        <strong>{complete} complete</strong>
      </div>
      {required === 0 && <p className="challenge-note">Automatic challenge unlocking is disabled for this collectible.</p>}
      {panelError && <p className="notice error" role="alert">{panelError}</p>}
      <div className="challenge-detail-rows">
        {challenges.map((challenge) => {
          const progress = progressFor(data, challenge.id);
          const slot = trackedSlotFor(data, challenge.id);
          const trackedFamily = isTrackableChallenge(challenge);
          const trackable = trackedFamily && progress.trackable !== false;
          const gateBadge = challengeGateBadge(challenge);
          const blockedMessage = challengeGateBlockMessage(challenge, progress);
          return (
            <article className={`challenge-detail-row ${progress.completed ? "complete" : ""} ${blockedMessage ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()} key={challenge.id}>
              <span className="challenge-detail-copy">
                {(gateBadge || blockedMessage) && <span className="challenge-state-line">
                  {gateBadge && <span className="gate-badge">{gateBadge}</span>}
                  {blockedMessage && <span className="gate-blocked"><Lock size={12} />{blockedMessage}</span>}
                </span>}
                <span>{challengeDescription(data, challenge)}</span>
              </span>
              <strong>{formatAmount(progress.current)} / {formatAmount(progress.goal)}</strong>
              {!unlocked && trackedFamily && (trackable || slot !== null) && <button
                className={slot ? "secondary-button" : "primary-button"}
                disabled={busyId === challenge.id || (!slot && trackingFull)}
                title={!slot && trackingFull ? "3 challenge limit reached" : undefined}
                onClick={() => changeTracking(challenge, slot !== null)}
              >{slot ? `Untrack · Slot ${slot}` : "Track"}</button>}
            </article>
          );
        })}
      </div>
      {!unlocked && trackingFull && <p className="challenge-note">3 challenge limit reached. Untrack one from the main page to add another collectible.</p>}
    </section>
  );
}

function DetailModal({
  data,
  detail,
  onRefresh,
  onClose,
}: {
  data: AppData;
  detail: CollectionDetail;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function purchaseSkill(owned: UserCritter, skillId: string, cost: number) {
    if (owned.skill_points < cost) {
      setDetailError(`Not enough skill points. This skill costs ${cost}.`);
      return;
    }
    setSaving(true);
    setDetailError(null);
    try {
      await unlockCritterSkill(owned.id, skillId);
      await onRefresh();
    } catch (error) {
      setDetailError(errorMessage(error, "Unable to unlock this skill."));
    } finally {
      setSaving(false);
    }
  }

  if (detail.type === "critter") {
    const critter = byId(data.catalog.critters, detail.id)!;
    const owned = data.player!.critters.find((row) => row.critter_id === critter.id);
    const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
    const skillIds = owned ? data.player!.unlockedSkillIdsByCritter[owned.id] ?? [] : [];
    return (
      <Modal title={critter.name} onClose={onClose}>
        {detailError && <p className="notice error" role="alert">{detailError}</p>}
        <CollectibleDetailHero data={data} id={critter.id} name={critter.name} elementId={critter.element_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} assetElement={critter.element_id} />
        <p className="detail-level">{owned ? `Level ${owned.level}` : "Locked"}</p>
        <CollectibleChallengePanel data={data} type="critter" id={critter.id} unlocked={Boolean(owned)} onRefresh={onRefresh} />
        <StatGrid stats={stats} />
        <PointCounter kind="skill" points={owned?.skill_points ?? 0} />
        <h3>Skills</h3>
        <div className="mini-grid">
          {data.catalog.critterSkillUnlocks
            .filter((row) => row.critter_id === critter.id)
            .sort((left, right) => left.sort_order - right.sort_order)
            .map((unlock) => {
              const skill = byId(data.catalog.skills, unlock.skill_id)!;
              const unlocked = skillIds.includes(skill.id);
              const canPurchase = Boolean(owned && owned.level >= unlock.unlock_level && !unlocked);
              return (
                <div key={skill.id} className={`detail-tile ${unlocked ? "unlocked" : "locked"} ${canPurchase ? "unlockable" : "level-locked"}`}>
                  <SkillTile data={data} skill={skill} />
                  <span className="unlock-requirement">Unlock level {unlock.unlock_level} · {unlock.unlock_cost} points</span>
                  {canPurchase && owned && <button className="primary-button skill-unlock-button" disabled={saving} onClick={() => purchaseSkill(owned, skill.id, unlock.unlock_cost)}>Unlock · {unlock.unlock_cost}</button>}
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
        <CollectibleChallengePanel data={data} type="relic" id={relic.id} unlocked={collectibleIsOwned(data, "relic", relic.id)} onRefresh={onRefresh} />
        <EffectList effects={data.catalog.effectsByRelic[relic.id] ?? []} className="effect-summary" />
      </Modal>
    );
  }

  const rollcaster = byId(data.catalog.rollcasters, detail.id)!;
  const owned = data.player!.rollcasters.find((row) => row.rollcaster_id === rollcaster.id);
  const abilityIds = owned ? data.player!.unlockedAbilityIdsByRollcaster[owned.id] ?? [] : [];
  return (
    <Modal title={rollcaster.name} onClose={onClose}>
      <CollectibleDetailHero data={data} id={rollcaster.id} name={rollcaster.name} assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} assetElement="basic" />
      <p className="detail-level">{owned ? `Level ${owned.level}` : "Locked"}</p>
      <CollectibleChallengePanel data={data} type="rollcaster" id={rollcaster.id} unlocked={Boolean(owned)} onRefresh={onRefresh} />
      {owned && <ProgressBar progress={xpProgress(data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id), owned.level, owned.xp)} />}
      <PointCounter kind="ability" points={owned?.ability_points ?? 0} />
      <h3>Abilities</h3>
      <div className="mini-grid">
        {data.catalog.rollcasterAbilityUnlocks
          .filter((row) => row.rollcaster_id === rollcaster.id)
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((unlock) => {
            const ability = byId(data.catalog.rollcasterAbilities, unlock.ability_id)!;
            const unlocked = abilityIds.includes(ability.id);
            return (
              <div key={ability.id} className={`detail-ability-tile ${unlocked ? "unlocked" : "locked"}`}>
                <article className={`detail-ability-card ${unlocked ? "unlocked" : "locked"}`}>
                  <span className="detail-ability-heading"><strong>{ability.name}</strong></span>
                  <span>{ability.description}</span>
                  <EffectList effects={data.catalog.effectsByAbility[ability.id] ?? []} />
                </article>
                <span className="unlock-requirement">Unlock level {unlock.unlock_level} · {unlock.unlock_cost} ability point{unlock.unlock_cost === 1 ? "" : "s"}</span>
              </div>
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
  onTurnResolved,
  onBack,
  onWin,
}: {
  data: AppData;
  combat: CombatState;
  setCombat: (state: CombatState) => void;
  onTurnResolved: (state: CombatState) => Promise<void>;
  onBack: () => void;
  onWin: () => void;
}) {
  const [actions, setActions] = useState<Record<string, CombatAction>>({});
  const [targeting, setTargeting] = useState<{ actorKey: string; skill: Skill; mode: "select" | "preview" } | null>(null);
  const [submittingProgress, setSubmittingProgress] = useState(false);
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
              statuses={combat.statuses.filter((status) => status.holderKey === unit.key)}
            />
          ))}
        </div>
        <div className="battle-column opponent-column">
          {combat.opponentUnits.map((unit) => (
            <BattleUnit key={unit.key} unit={unit} skills={unit.skills} data={data} opponent previewed={previewTargetKeys.has(unit.key)} previewKind={targeting?.skill.skill_type} statuses={combat.statuses.filter((status) => status.holderKey === unit.key)} />
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
              disabled={submittingProgress || Boolean(targeting) || totalCost > combat.playerMana}
              onClick={async () => {
                const submitted = activePlayer.map(
                  (unit) => actions[unit.key] ?? { actorKey: unit.key, type: "skip", cost: 0 },
                );
                const resolved = resolveTurn(combat, submitted);
                setSubmittingProgress(true);
                try { await onTurnResolved(resolved); } finally { setSubmittingProgress(false); }
              }}
            >
              {submittingProgress ? "Recording turn…" : "Continue"}
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
  statuses = [],
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
  statuses?: CombatState["statuses"];
}) {
  const pct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  return (
    <article className={`battle-unit ${!unit.active ? "bench" : ""} ${opponent ? "opponent" : ""} ${previewed ? `target-preview ${previewKind ?? "attack"}-preview` : ""}`}>
      <span className="combat-sprite-stack">
        <span className="combat-sprite-frame critter-combat-frame"><Sprite
          name={unit.name}
          element={unit.critter.element_id}
          assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)}
          size="medium"
          flipped={opponent}
        /></span>
        {unit.active && unit.hp > 0 && <StatusIconRow data={data} statuses={statuses} />}
      </span>
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

function StatusIconRow({ data, statuses }: { data: AppData; statuses: CombatState["statuses"] }) {
  const ordered = statuses
    .map((instance) => ({ instance, status: byId(data.catalog.statuses, instance.statusId) }))
    .filter((entry): entry is { instance: CombatState["statuses"][number]; status: NonNullable<typeof entry.status> } => Boolean(entry.status))
    .sort((left, right) => (left.status.sort_order ?? 0) - (right.status.sort_order ?? 0) || left.status.id.localeCompare(right.status.id));
  if (!ordered.length) return null;
  return <span className="status-icon-row" aria-label="Active statuses">{ordered.map(({ instance, status }) => {
    const effects = data.catalog.effectsByStatus[status.id] ?? [];
    const duration = instance.duration === null ? "Indefinite" : `${instance.duration} turn${instance.duration === 1 ? "" : "s"} remaining`;
    const iconPath = catalogAssetPath(data, "status", status.id, status.asset_path);
    const label = `${status.name}. ${duration}. ${attachmentText(effects)}`.trim();
    return <GameTooltip key={instance.instanceId} label={label} content={<><span className="tooltip-heading"><AssetIcon path={iconPath} alt="" fallback={<Sparkles size={16} />} /><strong>{status.name}</strong></span>{attachmentRows(effects)}<span className="status-duration">{duration}</span></>}>
      <span className="status-icon"><AssetIcon path={iconPath} alt={status.name} fallback={<Sparkles size={16} />} /><small>{instance.duration === null ? "∞" : instance.duration}</small></span>
    </GameTooltip>;
  })}</span>;
}

function UnlockNotification({ data, event, onClose }: { data: AppData; event: CollectibleUnlockEvent; onClose: () => void }) {
  const name = collectibleName(data, event.collectible_type, event.collectible_id);
  return (
    <Modal title="Collection Updated" description={`${name} unlocked`} onClose={onClose}>
      <div className="unlock-notification">
        <CollectibleSprite data={data} type={event.collectible_type} id={event.collectible_id} size="md" />
        <Sparkles size={28} />
        <h2>{name} unlocked!</h2>
        <p>Your new {event.collectible_type} is ready in the Collection.</p>
        <button className="primary-button" onClick={onClose}>Continue</button>
      </div>
    </Modal>
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
      data-sprite-box
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={`sprite-box__image ${fit === "portrait" ? "portrait-sprite-image" : ""}`.trim()}
          data-sprite-image
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

  if (!src && fallback === null) return null;
  return (
    <span className="asset-icon" data-sprite-box>
      {src ? (
        <img
          className="asset-icon__image sprite-box__image"
          src={src}
          alt={alt}
          data-sprite-image
          onError={() => setFailedAssetPath(path ?? null)}
        />
      ) : fallback}
    </span>
  );
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

function modificationTone(breakdown?: StatBreakdown): "positive" | "negative" | "mixed" | "" {
  if (!breakdown?.sources.length) return "";
  const positive = breakdown.sources.some((source) => source.amount > 0);
  const negative = breakdown.sources.some((source) => source.amount < 0);
  if (positive && negative) return "mixed";
  return positive ? "positive" : negative ? "negative" : "";
}

function signedAmount(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount}`;
}

function breakdownText(label: string, breakdown: StatBreakdown): string {
  return `${label}: ${breakdown.base} (Base) ${breakdown.sources.map((source) => `${signedAmount(source.amount)} (${source.sourceName})`).join(" ")}`;
}

function StatBreakdownLine({ label, breakdown }: { label?: string; breakdown: StatBreakdown }) {
  return (
    <span className="stat-breakdown-line">
      {label && <strong>{label}: </strong>}
      <span>{breakdown.base} (Base)</span>
      {breakdown.sources.map((source, index) => <strong className={source.amount > 0 ? "positive" : "negative"} key={`${source.sourceName}-${index}`}> {signedAmount(source.amount)} ({source.sourceName})</strong>)}
    </span>
  );
}

function StatCell({ label, value, className = "", breakdowns = [] }: { label: string; value: React.ReactNode; className?: string; breakdowns?: Array<{ label?: string; breakdown: StatBreakdown }> }) {
  const modified = breakdowns.some((entry) => entry.breakdown.sources.length > 0);
  const accessibleBreakdown = breakdowns.map((entry) => breakdownText(entry.label ?? label, entry.breakdown)).join(". ");
  return (
    <span className={`stat-cell ${className} ${modified ? "modified" : ""}`.trim()} tabIndex={modified ? 0 : undefined} aria-label={modified ? `${label} ${accessibleBreakdown}` : undefined}>
      <span className="stat-label">{label}</span>{value}
      {modified && <span className="game-tooltip stat-breakdown" role="tooltip">{breakdowns.map((entry, index) => <StatBreakdownLine key={`${entry.label ?? label}-${index}`} label={entry.label} breakdown={entry.breakdown} />)}</span>}
    </span>
  );
}

function StatGrid({ stats, compact, breakdowns = {} }: { stats: ReturnType<typeof critterStats>; compact?: boolean; breakdowns?: Partial<Record<LoadoutStatKey, StatBreakdown>> }) {
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
      <StatCell label="Block" value={<strong>{stats.blockCost}</strong>} />
      <StatCell label="Swap" value={<strong>{stats.swapCost}</strong>} />
      <StatCell label="Relics" value={<strong>{stats.relicSlots}</strong>} />
    </div>
  );
}

function ProgressBar({ progress, inline = false, className = "" }: { progress: XpProgress; inline?: boolean; className?: string }) {
  const pct = progress.isMaxLevel || progress.needed <= 0 ? 100 : Math.min(100, Math.round((progress.current / progress.needed) * 100));
  const progressText = progress.isMaxLevel ? "Max level" : `${progress.current} / ${progress.needed} XP`;
  return (
    <div className={`xp-progress ${inline ? "xp-progress-inline" : ""} ${className}`.trim()}>
      <div className="xp-bar" role="progressbar" aria-label="Experience progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={progressText}><span style={{ width: `${pct}%` }} /></div>
      <p>{progressText}</p>
    </div>
  );
}

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}
