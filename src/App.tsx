import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Coins,
  Dices,
  Gem,
  Gift,
  Info,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShoppingBag,
  Skull,
  Sparkles,
  Swords,
  Target,
  Ticket,
  UserRound,
  X,
} from "lucide-react";
import {
  acknowledgeCollectibleUnlockEvent,
  ensureUserGameState,
  getActiveDungeonRun,
  getGameAssetUrl,
  getSnapshotGameAssetUrl,
  getPromoCodeRedemptionHistory,
  getSession,
  hasSupabaseConfig,
  loadAppData,
  purchaseShopEntry,
  recordDungeonBattleResult,
  redeemPromoCode,
  saveDungeonRunState,
  setActiveRollcaster,
  setCritterRelicSlot,
  setCritterSkillSlot,
  setRollcasterAbilitySlot,
  setSquadSlot,
  selectStarterCritter,
  selectStarterRollcaster,
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
  unlockRollcasterAbility,
} from "./lib/supabase";
import {
  byId,
  critterElementIds,
  critterStats,
  isSingleTarget,
  matchesSelectedElements,
  skillTargets,
  squadCritters,
  type CombatState,
} from "./lib/game";
import {
  advanceDungeonEvent,
  applyDungeonBattleResult,
  confirmDungeonLeads,
  continueAfterEncounterRewards,
  continueAfterRoll,
  createDungeonRunState,
  currentDungeonEvent,
  dungeonBattleSubmission,
  revealDungeonSwapEvent,
  restoreDungeonRunState,
  rollDungeonDice,
  serializeDungeonRunState,
  submitDungeonActions,
  toggleDungeonLead,
  type DungeonRunState,
} from "./lib/dungeon-run";
import {
  battlefieldSlotsForCount,
  dropAmountLabel,
  effectiveDungeons,
  formatProbability,
  type EffectiveDungeon,
} from "./lib/dungeons";
import { calculateLoadoutStats, type LoadoutStatKey, type StatBreakdown } from "./lib/loadout";
import { relicSlotUnlocks, xpProgress, type XpProgress } from "./lib/progression";
import { createRequestId } from "./lib/uuid";
import {
  challengeDescription,
  challengeGateBadge,
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
  sortByCollectibleId,
  trackedSlotFor,
} from "./lib/collectibles";
import {
  promoCodeErrorMessage,
  promoRewardOutcomeLabel,
  promoRewardTypeLabel,
} from "./lib/promo-codes";
import type {
  AppData,
  CombatAction,
  CollectibleUnlockEvent,
  CollectibleType,
  CollectibleUnlockChallenge,
  Critter,
  Dungeon,
  DungeonDrop,
  DungeonRewardSummary,
  PlayerState,
  PromoCodeRedemption,
  PromoCodeReward,
  Relic,
  ResolvedEffectRef,
  Rollcaster,
  Skill,
  ShopEntry,
  UserCritter,
  UserRollcaster,
  View,
} from "./lib/types";
import rollcastersLogoUrl from "./assets/rollcasters-logo.webp";

type CollectionTab = "rollcasters" | "critters" | "relics";
type ShopTab = "shard" | "relic" | "lootbox" | "promo";
type CollectionDetail = { type: "critter" | "rollcaster" | "relic"; id: string };
type PromoRenderState = {
  historyStatus: "idle" | "loading" | "loaded" | "error";
  historyCount: number;
  claiming: boolean;
  error: string | null;
  claimedCode: string | null;
  claimedRewards: number;
  claimedPlayerUses: string | null;
  claimedPlayerUsesRemaining: string | null;
  claimedGlobalUsesRemaining: string | null;
};
type BannerNotification =
  | {
      id: string;
      kind: "collectible-unlock";
      event: CollectibleUnlockEvent;
    }
  | {
      id: string;
      kind: "shop-reward";
      targetCategory: CollectibleType;
      targetId: string;
      shard: boolean;
      granted: string;
      discarded: string;
    }
  | {
      id: string;
      kind: "promo-reward";
      redemption: PromoCodeRedemption;
    };

const BANNER_NOTIFICATION_DURATION_MS = 5_000;

function routeFromLocation(): { view: View; shopTab: ShopTab } {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const shopTab: ShopTab = requestedTab === "relic" || requestedTab === "lootbox" || requestedTab === "promo"
    ? requestedTab
    : "shard";
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

function requiredStarterView(player: PlayerState | null | undefined): View | null {
  if (!player?.profile.starter_rollcaster_selected_at) return "starter-rollcaster";
  if (!player.profile.starter_selected_at) return "starter";
  return null;
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
  const [combat, setCombat] = useState<DungeonRunState | null>(null);
  const [notificationQueue, setNotificationQueue] = useState<BannerNotification[]>([]);
  const [promoState, setPromoState] = useState<PromoRenderState>({
    historyStatus: "idle",
    historyCount: 0,
    claiming: false,
    error: null,
    claimedCode: null,
    claimedRewards: 0,
    claimedPlayerUses: null,
    claimedPlayerUsesRemaining: null,
    claimedGlobalUsesRemaining: null,
  });
  const seenUnlockEvents = useRef(new Set<string>());
  const combatRef = useRef<DungeonRunState | null>(null);
  const combatSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const lastPersistedCombat = useRef("");

  function enqueueNotification(notification: BannerNotification) {
    setNotificationQueue((current) => {
      if (current.some((queued) => queued.id === notification.id)) return current;
      if (notification.kind !== "shop-reward") return [...current, notification];

      const firstShopRewardIndex = current.findIndex((queued) => queued.kind === "shop-reward");
      if (firstShopRewardIndex === -1) return [...current, notification];

      const withoutOlderShopRewards = current.filter((queued) => queued.kind !== "shop-reward");
      const insertionIndex = Math.min(firstShopRewardIndex, withoutOlderShopRewards.length);
      return [
        ...withoutOlderShopRewards.slice(0, insertionIndex),
        notification,
        ...withoutOlderShopRewards.slice(insertionIndex),
      ];
    });
  }

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
      const requiredView = requiredStarterView(loaded.player);
      if (requiredView) {
        setView(requiredView);
      } else if (nextView) {
        setView(nextView);
      } else {
        const route = routeFromLocation();
        setShopTab(route.shopTab);
        if (route.view === "play") {
          const active = await getActiveDungeonRun();
          if (active) {
            const dungeon = loaded.catalog.dungeons.find((candidate) => candidate.id === active.run.dungeonId);
            if (dungeon) {
              const persisted = restoreDungeonRunState(active.combatState, loaded.catalog, active.run);
              const resumed = persisted
                ?? createDungeonRunState(loaded.catalog, loaded.player!, dungeon, active.run);
              lastPersistedCombat.current = persisted
                ? JSON.stringify(serializeDungeonRunState(persisted))
                : "";
              setCombat(resumed);
              setView("combat");
              return;
            }
          }
        }
        setView(route.view);
      }
    } catch (err) {
      console.error("Unable to load game data.", err);
      setError(errorMessage(err, "Unable to load game data."));
    } finally {
      setLoading(false);
    }
  }

  async function beginDungeon(dungeon: Dungeon) {
    if (!data?.player) return;
    setLoading(true);
    setError(null);
    try {
      const run = await startDungeonRun(dungeon.id);
      const initialCombat = createDungeonRunState(data.catalog, data.player, dungeon, run);
      await snapshotDungeonRunEffects(run.id, initialCombat.battle.snapshot);
      lastPersistedCombat.current = "";
      setCombat(initialCombat);
      setView("combat");
    } catch (err) {
      setError(errorMessage(err, "Unable to start dungeon."));
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
      if (!isAuthed || !data?.player) return;
      const requiredView = requiredStarterView(data.player);
      if (requiredView) {
        setView(requiredView);
        return;
      }
      const route = routeFromLocation();
      setShopTab(route.shopTab);
      setView(route.view);
    }
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, [
    isAuthed,
    data?.player?.profile.starter_rollcaster_selected_at,
    data?.player?.profile.starter_selected_at,
  ]);

  const pendingUnlockIds = data?.player?.collectibleSnapshot.unlock_events.map((event) => event.id).join("|") ?? "";
  useEffect(() => {
    const pending = data?.player?.collectibleSnapshot.unlock_events ?? [];
    const additions = pending.filter((event) => !seenUnlockEvents.current.has(event.id));
    if (!additions.length) return;
    additions.forEach((event) => seenUnlockEvents.current.add(event.id));
    setNotificationQueue((current) => [
      ...current,
      ...additions
        .filter((event) => !current.some((queued) => queued.id === `unlock:${event.id}`))
        .map((event): BannerNotification => ({
          id: `unlock:${event.id}`,
          kind: "collectible-unlock",
          event,
        })),
    ]);
    additions.forEach((event) => {
      void acknowledgeCollectibleUnlockEvent(event.id).catch((ackError) => {
        console.error("Unable to acknowledge collectible unlock event.", ackError);
      });
    });
  }, [pendingUnlockIds]);

  const activeNotificationId = notificationQueue[0]?.id;
  useEffect(() => {
    if (!activeNotificationId) return;
    const timeout = window.setTimeout(() => {
      setNotificationQueue((current) => current[0]?.id === activeNotificationId ? current.slice(1) : current);
    }, BANNER_NOTIFICATION_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [activeNotificationId]);

  useEffect(() => {
    combatRef.current = combat;
    if (
      !combat
      || combat.run.status !== "started"
      || combat.phase === "battle_result"
      || combat.phase === "dungeon_complete"
      || combat.phase === "dungeon_failed"
    ) return;
    const serialized = serializeDungeonRunState(combat);
    const signature = JSON.stringify(serialized);
    if (signature === lastPersistedCombat.current) return;

    combatSaveQueue.current = combatSaveQueue.current
      .then(async () => {
        const latest = combatRef.current;
        if (
          !latest
          || latest.run.status !== "started"
          || latest.phase === "battle_result"
          || latest.phase === "dungeon_complete"
          || latest.phase === "dungeon_failed"
        ) return;
        const latestSerialized = serializeDungeonRunState(latest);
        const latestSignature = JSON.stringify(latestSerialized);
        if (latestSignature === lastPersistedCombat.current) return;
        const saved = await saveDungeonRunState(latest.run, latestSerialized);
        lastPersistedCombat.current = latestSignature;
        const latestCurrent = combatRef.current;
        if (latestCurrent?.run.id === latest.run.id) {
          combatRef.current = { ...latestCurrent, run: saved.run };
        }
        setCombat((current) => current?.run.id === latest.run.id
          ? { ...current, run: saved.run }
          : current);
      })
      .catch((saveError) => {
        console.error("Unable to persist Dungeon combat state.", saveError);
        setError(errorMessage(saveError, "Unable to save Dungeon progress."));
      });
  }, [combat]);

  useEffect(() => {
    window.render_game_to_text = () =>
      JSON.stringify({
        view,
        loading,
        authed: isAuthed,
        catalogRelease: data?.catalogRelease ?? null,
        playerStateRevision: data?.player?.playerStateRevision ?? null,
        serverCatalogVersion: data?.player?.serverCatalogVersion ?? null,
        starterRollcasterSelected: data?.player?.profile.starter_rollcaster_selected_at != null,
        starterSelected: data?.player?.profile.starter_selected_at != null,
        onboarding: view === "starter-rollcaster"
          ? {
              stage: "rollcaster",
              options: data?.catalog.starterRollcasterOptions.map((option) => option.rollcaster_id) ?? [],
            }
          : view === "starter"
            ? {
                stage: "critter",
                options: data?.catalog.starterOptions.map((option) => option.critter_id) ?? [],
              }
            : null,
        coins: data?.player?.profile.coins ?? 0,
        currencies: data?.player?.collectibleSnapshot.currencies ?? [],
        trackedChallenges: data?.player?.collectibleSnapshot.tracked ?? [],
        shop: view === "shop"
          ? {
              tab: shopTab,
              offers: data?.catalog.shopEntries.filter((entry) => entry.shop_type === shopTab).length ?? 0,
              promo: shopTab === "promo" ? promoState : null,
            }
          : null,
        unlockNotification: notificationQueue[0]?.kind === "collectible-unlock"
          ? notificationQueue[0].event
          : null,
        rewardNotification: notificationQueue[0]?.kind === "shop-reward"
          ? {
              kind: "shop",
              targetCategory: notificationQueue[0].targetCategory,
              targetId: notificationQueue[0].targetId,
              granted: notificationQueue[0].granted,
              discarded: notificationQueue[0].discarded,
            }
          : notificationQueue[0]?.kind === "promo-reward"
            ? {
                kind: "promo",
                code: notificationQueue[0].redemption.code,
                rewards: notificationQueue[0].redemption.rewards.length,
              }
            : null,
        combat: combat
          ? {
              phase: combat.phase,
              coordinateSystem: "Fixed battlefield slots run top-to-bottom from 0 to 2 on each side.",
              dungeonId: combat.dungeon.id,
              effectiveMode: combat.run.effectiveMode,
              encounter: combat.run.battleIndex,
              encounterCount: combat.run.battleCount,
              turn: combat.battle.turn,
              playerMana: combat.battle.playerMana,
              opponentMana: combat.battle.opponentMana,
              requiredLeadCount: combat.requiredLeadCount,
              selectedLeadIds: combat.selectedLeadIds,
              narration: currentDungeonEvent(combat)?.message ?? null,
              player: combat.battle.playerUnits.map((unit) => ({
                key: unit.key,
                id: unit.userCritter?.id,
                name: unit.name,
                elementIds: critterElementIds(unit.critter),
                hp: unit.hp,
                maxHp: unit.maxHp,
                active: unit.active,
                slot: unit.battlefieldSlot,
                roll: unit.manaRoll,
                stats: unit.stats,
              })),
              opponents: combat.phase === "lead_selection"
                ? combat.battle.opponentUnits.map((_unit, slot) => ({ slot, hidden: true }))
                : combat.battle.opponentUnits.map((unit) => ({
                    key: unit.key,
                    name: unit.name,
                    elementIds: critterElementIds(unit.critter),
                    hp: unit.hp,
                    maxHp: unit.maxHp,
                    active: unit.active,
                    slot: unit.battlefieldSlot,
                    roll: unit.manaRoll,
                    stats: unit.stats,
                  })),
              statuses: combat.battle.statuses.map((status) => ({ statusId: status.statusId, holder: status.holderKey, duration: status.duration })),
              presentation: currentDungeonEvent(combat)
                ? {
                    id: currentDungeonEvent(combat)!.id,
                    kind: currentDungeonEvent(combat)!.kind,
                    actorKey: currentDungeonEvent(combat)!.actorKey ?? null,
                    targetKeys: currentDungeonEvent(combat)!.targetKeys,
                    swap: currentDungeonEvent(combat)!.swap
                      ? {
                          ...currentDungeonEvent(combat)!.swap!,
                          revealed: combat.battle.playerUnits.some((unit) => (
                            unit.key === currentDungeonEvent(combat)!.swap!.incomingKey
                            && unit.active
                            && unit.battlefieldSlot === currentDungeonEvent(combat)!.swap!.battlefieldSlot
                          )),
                        }
                      : null,
                  }
                : null,
              rngState: combat.battle.rngState,
            }
          : null,
      });
    window.advanceTime = () => undefined;
  }, [view, shopTab, loading, isAuthed, data, combat, notificationQueue, promoState]);

  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!sessionReady) return <Shell><Loading message="Checking session..." /></Shell>;
  if (!isAuthed) return <Shell><AuthScreen onAuthed={() => refresh()} error={error} setError={setError} /></Shell>;
  if (!data?.player) return <Shell><Loading message="Loading Rollcasters..." error={error} /></Shell>;

  return (
    <Shell className={
      view === "collection" || view === "shop"
        ? "collection-shell"
        : view === "combat"
          ? "combat-shell"
          : ""
    }>
      <TopBar
        data={data}
        player={data.player}
        refreshing={loading}
        onHome={() => navigate(requiredStarterView(data.player) ?? "home")}
        onSignOut={async () => {
          await signOut();
          setIsAuthed(false);
        }}
      />
      {error && <div className="notice error">{error}</div>}
      {view === "starter-rollcaster" && (
        <StarterRollcasterScreen
          data={data}
          onSelect={async (rollcasterId) => {
            setLoading(true);
            try {
              await selectStarterRollcaster(rollcasterId);
              await refresh("starter");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Starter Rollcaster selection failed.");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
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
          onPromoStateChange={setPromoState}
          onNotify={enqueueNotification}
        />
      )}
      {view === "play" && (
        <PlayScreen
          data={data}
          onBack={() => navigate("home")}
          onStart={beginDungeon}
        />
      )}
      {view === "combat" && combat && (
        <CombatScreen
          data={data}
          combat={combat}
          setCombat={setCombat}
          onTurnResolved={async (resolved) => {
            const turn = resolved.pendingBattle ?? resolved.battle;
            if (turn.turnEvents.length === 0) return;
            try {
              await submitCollectibleCombatEvents(resolved.run.id, resolved.battle.turn, turn.turnEvents);
              await refresh("combat");
            } catch (progressError) {
              console.error("Unable to submit collectible combat progress.", progressError);
              setError(errorMessage(progressError, "Unable to update challenge progress."));
            }
          }}
          onBattleResult={async (resolved) => {
            setLoading(true);
            setError(null);
            try {
              await combatSaveQueue.current;
              const result = await recordDungeonBattleResult(
                resolved.run,
                dungeonBattleSubmission(resolved),
              );
              const loaded = await loadAppData();
              setData(loaded);
              setCombat(applyDungeonBattleResult(resolved, result, loaded.catalog, loaded.player!));
            } catch (resultError) {
              setError(errorMessage(resultError, "Unable to record the encounter result."));
            } finally {
              setLoading(false);
            }
          }}
          onBack={() => navigate("play")}
          onHome={() => { setCombat(null); navigate("home"); }}
          onReplay={() => beginDungeon(combat.dungeon)}
          onNextDungeon={(dungeonId) => {
            const next = data.catalog.dungeons.find((dungeon) => dungeon.id === dungeonId);
            if (next) void beginDungeon(next);
          }}
        />
      )}
      {notificationQueue[0] && (
        <BannerNotificationView
          key={notificationQueue[0].id}
          data={data}
          notification={notificationQueue[0]}
        />
      )}
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

function useViewportFitScale(bottomGutter = 4) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let animationFrame = 0;

    const fit = () => {
      const naturalHeight = node.scrollHeight;
      const availableHeight = Math.max(0, window.innerHeight - node.getBoundingClientRect().top - bottomGutter);
      const scale = naturalHeight > 0 ? Math.min(1, availableHeight / naturalHeight) : 1;
      const roundedScale = Math.floor(scale * 10_000) / 10_000;
      node.style.setProperty("--combat-fit-scale", String(roundedScale));
      node.dataset.viewportFitScale = String(roundedScale);
      node.dataset.viewportScaled = roundedScale < 0.9999 ? "true" : "false";
    };
    const scheduleFit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(fit);
    };

    fit();
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(node);
    const mutationObserver = new MutationObserver(scheduleFit);
    mutationObserver.observe(node, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", scheduleFit);
    window.visualViewport?.addEventListener("resize", scheduleFit);
    void document.fonts?.ready.then(scheduleFit);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
      window.visualViewport?.removeEventListener("resize", scheduleFit);
    };
  }, [bottomGutter]);

  return ref;
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

function StarterRollcasterScreen({ data, onSelect }: { data: AppData; onSelect: (rollcasterId: string) => void }) {
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
                  assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)}
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

function StarterScreen({ data, onSelect }: { data: AppData; onSelect: (critterId: string) => void }) {
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
            <CardSprite><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} size="large" /></CardSprite>
            <CardName data={data} name={critter.name} critter={critter} />
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
  const element = critter?.element_1_id ?? (type === "relic" ? "metal" : "basic");
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
          <SpriteFrame size="md" className="loadout-critter-frame"><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} size="small" /></SpriteFrame>
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
  return <span className="critter-name">{!unknown && <CritterElementLogos data={data} critter={critter} />}<strong>{unknown ? "???" : critter.name}</strong></span>;
}

function GameTooltip({ label, content, children }: { label: string; content: React.ReactNode; children: React.ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  function showTooltip() {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    tooltip.classList.add("viewport-tooltip-visible");
    tooltip.style.left = "12px";
    tooltip.style.top = "12px";
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const gutter = 10;
    const left = Math.max(
      gutter,
      Math.min(
        anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
        window.innerWidth - tooltipRect.width - gutter,
      ),
    );
    const preferredAbove = anchorRect.top - tooltipRect.height - 8;
    const top = preferredAbove >= gutter
      ? preferredAbove
      : Math.min(anchorRect.bottom + 8, window.innerHeight - tooltipRect.height - gutter);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(gutter, top)}px`;
  }

  function hideTooltip() {
    tooltipRef.current?.classList.remove("viewport-tooltip-visible");
  }

  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      tabIndex={0}
      aria-label={label}
      aria-describedby={tooltipId}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      <span ref={tooltipRef} id={tooltipId} className="game-tooltip viewport-game-tooltip" role="tooltip">{content}</span>
    </span>
  );
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
    const eligible = sortByCollectibleId(player.critters, (owned) => owned.critter_id);
    const current = player.squadSlots.find((row) => row.slot_index === target.slotIndex)?.user_critter_id;
    const canRemoveCurrent = player.squadSlots.filter((row) => row.user_critter_id).length > 1;
    content = eligible.length ? <div className="candidate-grid">{eligible.map((owned) => {
      const critter = byId(data.catalog.critters, owned.critter_id)!;
      const selected = current === owned.id;
      const inSquad = assigned.has(owned.id);
      const disabled = saving || (inSquad && !selected) || (selected && !canRemoveCurrent);
      return <button className={`candidate-card ${selected ? "selected" : ""} ${inSquad && !selected ? "in-squad" : ""}`} key={owned.id} disabled={disabled} onClick={() => onEquip(() => setSquadSlot(target.slotIndex, selected ? null : owned.id))}>
        <SpriteFrame size="md" selected={selected}><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>
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
    const eligible = sortByCollectibleId(data.catalog.relics).filter(
      (relic) => (player.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0) > 0,
    );
    content = eligible.length ? <div className="candidate-grid">{eligible.map((relic) => {
      const owned = player.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
      const used = player.relicSlots.filter((row) => row.relic_id === relic.id).length;
      const selected = current === relic.id;
      const available = owned - used;
      return <button className={`candidate-card ${selected ? "selected" : ""}`} key={relic.id} disabled={saving || selected || available <= 0} onClick={() => onEquip(() => setCritterRelicSlot(target.owned.id, target.slotIndex, relic.id))}>
        <SpriteFrame size="md" selected={selected}><Sprite name={relic.name} element="metal" assetPath={findAssetPath(data, "relic", relic.id, "card") ?? catalogAssetPath(data, "relic", relic.id, relic.asset_path)} /></SpriteFrame><strong>{relic.name}</strong><span>{relic.description}</span>{attachmentRows(data.catalog.effectsByRelic[relic.id] ?? [])}<span className="inventory-count">Owned {owned} · Equipped {used} · Available {available}</span>
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
    content = <div className="candidate-grid">{sortByCollectibleId(player.rollcasters, (owned) => owned.rollcaster_id).map((owned) => {
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
  const selectedElementIds = new Set(elementId ? [elementId] : []);
  const matchesSearch = (entry: { id: string; name: string }) =>
    !normalizedQuery || entry.id.toLocaleLowerCase().includes(normalizedQuery) || entry.name.toLocaleLowerCase().includes(normalizedQuery);
  const rollcasters = sortByCollectibleId(data.catalog.rollcasters).filter(matchesSearch);
  const critters = sortByCollectibleId(data.catalog.critters).filter(
    (critter) => matchesSearch(critter) && matchesSelectedElements(critter, selectedElementIds),
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
        {tab === "rollcasters" && <RollcasterGrid data={data} rollcasters={rollcasters} setDetail={setDetail} onRefresh={onRefresh} />}
        {tab === "critters" && <CritterGrid data={data} critters={critters} setDetail={setDetail} onRefresh={onRefresh} />}
        {tab === "relics" && <RelicGrid data={data} relics={relics} setDetail={setDetail} onRefresh={onRefresh} />}
        {displayedCount === 0 && <p className="collection-empty">No {tab} match the current filters.</p>}
      </div>
      {detail && <DetailModal data={data} detail={detail} onRefresh={onRefresh} onClose={() => setDetail(null)} />}
    </section>
  );
}

function ShopScreen({
  data,
  tab,
  setTab,
  onBack,
  onRefresh,
  onPromoStateChange,
  onNotify,
}: {
  data: AppData;
  tab: ShopTab;
  setTab: (tab: ShopTab) => void;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onPromoStateChange: (state: PromoRenderState) => void;
  onNotify: (notification: BannerNotification) => void;
}) {
  const [query, setQuery] = useState("");
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const normalized = query.trim().toLocaleLowerCase();
  const authoredEntries = data.catalog.shopEntries.filter((entry) => (
    tab === "shard" || tab === "relic"
  ) && entry.shop_type === tab);
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
    setBusyEntry(entry.id); setPurchaseError(null);
    const requestId = requestIds.current.get(entry.id) ?? createRequestId();
    requestIds.current.set(entry.id, requestId);
    try {
      const receipt = await purchaseShopEntry(entry.id, requestId);
      requestIds.current.delete(entry.id);
      onNotify({
        id: `shop:${receipt.request_id}`,
        kind: "shop-reward",
        targetCategory: receipt.target_category,
        targetId: receipt.target_id,
        shard: receipt.shop_type === "shard",
        granted: receipt.granted,
        discarded: receipt.discarded,
      });
      await onRefresh();
    } catch (error) {
      setPurchaseError(shopErrorMessage(error));
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
      <div className="screen-heading row"><div><p className="eyebrow">Camp Market</p><h1>Shop</h1><p>Find shards, Relics, and special rewards.</p></div><button className="secondary-button" onClick={onBack}>Back</button></div>
      <div className="tabs shop-tabs" role="tablist" aria-label="Shop categories">
        <button role="tab" aria-selected={tab === "shard"} className={tab === "shard" ? "active" : ""} onClick={() => setTab("shard")}>Shard Shop</button>
        <button role="tab" aria-selected={tab === "relic"} className={tab === "relic" ? "active" : ""} onClick={() => setTab("relic")}>Relic Shop</button>
        <button role="tab" aria-selected={tab === "lootbox"} className={tab === "lootbox" ? "active" : ""} disabled title="Coming later">Lootbox Shop <small>Coming later</small></button>
        <button role="tab" aria-selected={tab === "promo"} className={tab === "promo" ? "active" : ""} onClick={() => setTab("promo")}><Ticket size={17} aria-hidden="true" /> Promo Codes</button>
      </div>
      {(tab === "shard" || tab === "relic") && <label className="collection-search shop-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search shop entries by name or collectible ID</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by offer, collectible name, or ID" /></label>}
      {(tab === "shard" || tab === "relic") && purchaseError && <p className="notice error" role="alert">{purchaseError}</p>}
      {tab === "promo" ? (
        <PromoCodesPanel
          data={data}
          onRefresh={onRefresh}
          onStateChange={onPromoStateChange}
          onNotify={onNotify}
        />
      ) : tab === "lootbox" ? <div className="shop-empty"><ShoppingBag size={38} /><h2>Lootbox Shop</h2><p>Coming later. Lootboxes, rolls, pity rules, and awards are intentionally reserved for a separate system.</p></div> : tab === "shard" ? (
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

function PromoCodesPanel({
  data,
  onRefresh,
  onStateChange,
  onNotify,
}: {
  data: AppData;
  onRefresh: () => Promise<void>;
  onStateChange: (state: PromoRenderState) => void;
  onNotify: (notification: BannerNotification) => void;
}) {
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<PromoCodeRedemption[]>([]);
  const [historyStatus, setHistoryStatus] = useState<PromoRenderState["historyStatus"]>("loading");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [lastClaim, setLastClaim] = useState<PromoCodeRedemption | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadHistory() {
    setHistoryStatus("loading");
    setHistoryError(null);
    try {
      setHistory(await getPromoCodeRedemptionHistory());
      setHistoryStatus("loaded");
    } catch (error) {
      console.error("Unable to load Promo Code history.", error);
      setHistoryError("We couldn’t load your redeemed codes. Try again.");
      setHistoryStatus("error");
    }
  }

  useEffect(() => {
    let active = true;
    setHistoryStatus("loading");
    getPromoCodeRedemptionHistory()
      .then((redemptions) => {
        if (!active) return;
        setHistory(redemptions);
        setHistoryStatus("loaded");
      })
      .catch((error) => {
        if (!active) return;
        console.error("Unable to load Promo Code history.", error);
        setHistoryError("We couldn’t load your redeemed codes. Try again.");
        setHistoryStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onStateChange({
      historyStatus,
      historyCount: history.length,
      claiming,
      error: claimError ?? historyError,
      claimedCode: lastClaim?.code ?? null,
      claimedRewards: lastClaim?.rewards.length ?? 0,
      claimedPlayerUses: lastClaim?.playerUses ?? null,
      claimedPlayerUsesRemaining: lastClaim?.playerUsesRemaining ?? null,
      claimedGlobalUsesRemaining: lastClaim?.globalUsesRemaining ?? null,
    });
  }, [
    historyStatus,
    history.length,
    claiming,
    claimError,
    historyError,
    lastClaim?.redemptionId,
    onStateChange,
  ]);

  useEffect(() => {
    if (!claiming && lastClaim) inputRef.current?.focus();
  }, [claiming, lastClaim?.redemptionId]);

  function revealClaim(redemption: PromoCodeRedemption) {
    setLastClaim(redemption);
    setCode("");
    setHistory((current) => [
      redemption,
      ...current.filter((row) => row.redemptionId !== redemption.redemptionId),
    ]);
    onNotify({
      id: `promo:${redemption.redemptionId}`,
      kind: "promo-reward",
      redemption,
    });
  }

  async function claim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const enteredCode = code.trim();
    if (!enteredCode || claiming) return;
    const knownRedemptionIds = new Set(history.map((redemption) => redemption.redemptionId));
    setClaiming(true);
    setClaimError(null);
    try {
      const redemption = await redeemPromoCode(enteredCode);
      revealClaim(redemption);
      try {
        setHistory(await getPromoCodeRedemptionHistory());
        setHistoryStatus("loaded");
        setHistoryError(null);
      } catch (historyLoadError) {
        console.error("Promo Code was claimed, but history could not be refreshed.", historyLoadError);
        setHistoryStatus("error");
        setHistoryError("Your rewards were claimed, but redeemed-code history could not be refreshed.");
      }
      await onRefresh();
    } catch (error) {
      let recovered: PromoCodeRedemption | undefined;
      try {
        const latestHistory = await getPromoCodeRedemptionHistory();
        setHistory(latestHistory);
        setHistoryStatus("loaded");
        setHistoryError(null);
        recovered = latestHistory.find((redemption) => (
          !knownRedemptionIds.has(redemption.redemptionId)
          && redemption.code === enteredCode.toUpperCase()
        ));
      } catch (historyLoadError) {
        console.error("Unable to confirm Promo Code history after a failed claim response.", historyLoadError);
      }
      if (recovered) {
        revealClaim(recovered);
        await onRefresh();
      } else {
        setClaimError(promoCodeErrorMessage(error));
      }
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="promo-codes-panel">
      <section className="promo-claim-card" aria-labelledby="promo-codes-heading">
        <div className="promo-section-heading">
          <span className="promo-heading-icon" aria-hidden="true"><Ticket /></span>
          <div>
            <h2 id="promo-codes-heading">Promo Codes</h2>
            <p>Enter a code to claim rewards.</p>
          </div>
        </div>
        <form className="promo-claim-form" onSubmit={claim}>
          <label htmlFor="promo-code-input">Promo Code</label>
          <div className="promo-claim-controls">
            <input
              ref={inputRef}
              id="promo-code-input"
              className="promo-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              disabled={claiming}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter code..."
            />
            <button className="primary-button promo-claim-button" disabled={claiming || code.trim().length === 0}>
              {claiming ? <><RefreshCw className="promo-spinner" size={17} aria-hidden="true" /> Claiming…</> : "Claim"}
            </button>
          </div>
        </form>
        {claimError && <p className="promo-message promo-error" role="alert">{claimError}</p>}
      </section>

      <section className="promo-history-section" aria-labelledby="redeemed-codes-heading">
        <div className="promo-history-heading">
          <div>
            <p className="eyebrow">Claim history</p>
            <h2 id="redeemed-codes-heading">Redeemed Codes</h2>
          </div>
          {historyStatus === "error" && <button className="secondary-button" onClick={() => void loadHistory()}>Retry</button>}
        </div>
        <div className="promo-history-pane">
          {historyError && <p className="promo-message promo-history-error" role="alert">{historyError}</p>}
          {historyStatus === "loading" ? <PromoHistorySkeleton /> : history.length > 0 ? (
            <div className="promo-history-list">
              {history.map((redemption) => <PromoRedemptionCard key={redemption.redemptionId} data={data} redemption={redemption} />)}
            </div>
          ) : historyStatus === "loaded" ? (
            <div className="promo-history-empty">
              <Gift size={34} aria-hidden="true" />
              <h3>No redeemed codes yet</h3>
              <p>Your claimed rewards will appear here.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function promoClaimUsageLabel(redemption: PromoCodeRedemption): string {
  const personal = redemption.playerUsesRemaining === null
    ? "Unlimited uses for your account"
    : redemption.playerUsesRemaining === "0"
      ? "Account claim limit reached"
      : `${formatAmount(redemption.playerUsesRemaining)} account ${redemption.playerUsesRemaining === "1" ? "use" : "uses"} remaining`;
  const global = redemption.globalUsesRemaining === null
    ? "Unlimited total claims"
    : `${formatAmount(redemption.globalUsesRemaining)} total ${redemption.globalUsesRemaining === "1" ? "claim" : "claims"} remaining`;
  return `Claim ${formatAmount(redemption.playerUses ?? "0")} · ${personal} · ${global}`;
}

function PromoHistorySkeleton() {
  return (
    <div className="promo-history-skeleton" role="status" aria-label="Loading redeemed codes">
      {[0, 1].map((row) => (
        <div className="promo-skeleton-card" key={row}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function PromoRedemptionCard({ data, redemption }: { data: AppData; redemption: PromoCodeRedemption }) {
  const redeemedAt = new Date(redemption.redeemedAt);
  const formattedDate = Number.isNaN(redeemedAt.getTime())
    ? redemption.redeemedAt
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(redeemedAt);
  return (
    <article className="promo-redemption-card" tabIndex={0}>
      <header>
        <div><Ticket size={18} aria-hidden="true" /><code>{redemption.code}</code></div>
        <time dateTime={redemption.redeemedAt}>{formattedDate}</time>
      </header>
      <PromoRewardGrid data={data} rewards={redemption.rewards} />
    </article>
  );
}

function PromoRewardGrid({ data, rewards }: { data: AppData; rewards: PromoCodeReward[] }) {
  return (
    <div className="promo-reward-grid">
      {rewards.map((reward, index) => {
        const outcome = promoRewardOutcomeLabel(reward);
        return (
          <article
            className="promo-reward-row"
            key={`${reward.type}:${reward.targetCategory ?? ""}:${reward.targetId}:${index}`}
            aria-label={`${reward.name}, ${formatAmount(reward.quantity)} granted. ${outcome}.`}
          >
            <PromoRewardArt data={data} reward={reward} />
            <div className="promo-reward-copy">
              <h3>{reward.name}</h3>
              <span>{outcome}</span>
            </div>
            <strong>×{formatAmount(reward.quantity)}</strong>
          </article>
        );
      })}
    </div>
  );
}

function PromoRewardArt({ data, reward }: { data: AppData; reward: PromoCodeReward }) {
  const fallback = reward.type === "currency"
    ? <Coins aria-hidden="true" />
    : reward.type === "shard"
      ? <Gem aria-hidden="true" />
      : reward.type === "relic"
        ? <Shield aria-hidden="true" />
        : reward.type === "rollcaster"
          ? <Dices aria-hidden="true" />
          : <Sparkles aria-hidden="true" />;
  const snapshotPath = getSnapshotGameAssetUrl(reward.assetPath);
  const category = reward.type === "shard" ? reward.targetCategory : reward.type;
  const currentVariant = category
    ? findAssetPath(data, category, reward.targetId, category === "currency" || category === "relic" ? "icon" : "thumb")
    : null;
  const art = <AssetIcon path={currentVariant ?? snapshotPath} alt="" fallback={fallback} />;
  if (reward.type === "shard") {
    return (
      <span className="promo-shard-art" aria-hidden="true">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="2,50 50,2 98,50 50,98" />
        </svg>
        <span>{art}</span>
        <Gem className="promo-shard-overlay" />
      </span>
    );
  }
  return <SpriteFrame size="sm" className={`promo-reward-art promo-reward-art-${promoRewardTypeLabel(reward.type).toLocaleLowerCase()}`}>{art}</SpriteFrame>;
}

function ShopEmptyState({ hasAuthoredEntries }: { hasAuthoredEntries: boolean }) {
  return <div className="shop-empty"><ShoppingBag size={34} /><h2>{hasAuthoredEntries ? "No shop entries match" : "No offers available yet"}</h2><p>{hasAuthoredEntries ? "Try a different name or collectible ID." : "Active offers authored in Content Studio will appear here."}</p></div>;
}

function ShopEntryCard({ data, entry, busy, onPurchase }: { data: AppData; entry: ShopEntry; busy: boolean; onPurchase: () => void }) {
  const availability = shopAvailability(data, entry);
  const soldOut = availability.code === "COLLECTIBLE_ALREADY_UNLOCKED" || availability.code === "RELIC_MAX_OWNED_REACHED";
  const currency = currencyFor(data, entry.currency_id)!;
  const targetName = collectibleName(data, entry.target_category, entry.target_id);
  const targetCritter = entry.target_category === "critter"
    ? byId(data.catalog.critters, entry.target_id)
    : undefined;
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
      <div className="shop-entry-copy">
        <h3>{entry.name}</h3>
        <p className="shop-target">
          {targetCritter
            ? (
                <span className="shop-target-identity">
                  <CritterName data={data} critter={targetCritter} />
                  <span className="shop-target-id">({entry.target_id})</span>
                </span>
              )
            : <>{targetName} ({entry.target_id})</>}
        </p>
        {showDescription && <p>{description}</p>}
      </div>
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

function CollectibleChallengeRows({ data, type, id, onRefresh, compact = true }: { data: AppData; type: CollectibleType; id: string; onRefresh: () => Promise<void>; compact?: boolean }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const challenges = challengesFor(data, type, id);
  if (!challenges.length) return <p className="collection-status challenge-empty">Not currently unlockable</p>;
  const tracked = data.player!.collectibleSnapshot.tracked;
  const sameCollectibleTracked = tracked.some((row) => {
    const challenge = data.catalog.collectibleUnlockChallenges.find((candidate) => candidate.id === row.challenge_id);
    return challenge?.collectible_type === type && challenge.collectible_id === id;
  });
  const trackingFull = tracked.length >= 3 && !sameCollectibleTracked;
  const firstBlockedChallengeId = challenges.find((challenge) => progressFor(data, challenge.id).eligible === false)?.id ?? null;

  async function changeTracking(challenge: CollectibleUnlockChallenge, currentlyTracked: boolean) {
    setBusyId(challenge.id);
    setTrackingError(null);
    try {
      if (currentlyTracked) await untrackCollectibleChallenge(challenge.id);
      else await trackCollectibleChallenge(challenge.id);
      await onRefresh();
    } catch (error) {
      const raw = errorMessage(error, "Unable to update challenge tracking.");
      setTrackingError(
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
    <div className={`challenge-rows ${compact ? "compact" : ""}`.trim()} aria-label={`${collectibleName(data, type, id)} unlock challenges`}>
      {trackingError && <p className="grid-challenge-error" role="alert">{trackingError}</p>}
      {challenges.map((challenge) => {
        const progress = progressFor(data, challenge.id);
        const blocked = progress.eligible === false;
        const slot = trackedSlotFor(data, challenge.id);
        const trackedFamily = isTrackableChallenge(challenge);
        const trackable = trackedFamily && progress.trackable !== false;
        return (
          <Fragment key={challenge.id}>
            {challenge.id === firstBlockedChallengeId && <div className="challenge-gate-boundary">
              <span className="gate-blocked"><Lock size={11} />Complete all above challenges first</span>
            </div>}
            <div className={`challenge-row ${progress.completed ? "complete" : ""} ${blocked ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()}>
              <span className="challenge-row-description">{challengeDescription(data, challenge)}</span>
              <strong>{formatAmount(progress.current)} / {formatAmount(progress.goal)}</strong>
              {trackedFamily && (trackable || slot !== null) && <button
                type="button"
                className="grid-challenge-track"
                aria-label={`${slot ? "Untrack" : "Track"} ${challengeDescription(data, challenge)}`}
                aria-pressed={slot !== null}
                disabled={busyId === challenge.id || (!slot && trackingFull)}
                title={!slot && trackingFull ? "3 challenge limit reached" : slot ? `Tracked in Slot ${slot}` : undefined}
                onClick={() => changeTracking(challenge, slot !== null)}
              >{busyId === challenge.id ? "…" : slot ? "Untrack" : "Track"}</button>}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

type CollectionScrollMetrics = {
  overflow: boolean;
  scrollTop: number;
  maxScroll: number;
  thumbHeight: number;
  thumbTop: number;
};

function CollectionCardState({ children, showScrollbar = false }: { children: React.ReactNode; showScrollbar?: boolean }) {
  const scrollId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);
  const [metrics, setMetrics] = useState<CollectionScrollMetrics>({ overflow: false, scrollTop: 0, maxScroll: 0, thumbHeight: 0, thumbTop: 0 });

  function syncScrollMetrics() {
    const pane = scrollRef.current;
    if (!pane) return;
    const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const overflow = maxScroll > 1;
    const trackHeight = Math.max(0, pane.clientHeight - 4);
    const thumbHeight = showScrollbar
      ? overflow ? Math.min(trackHeight, Math.max(22, trackHeight * pane.clientHeight / pane.scrollHeight)) : trackHeight
      : 0;
    const thumbTravel = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxScroll > 0 ? thumbTravel * pane.scrollTop / maxScroll : 0;
    const next = { overflow, scrollTop: pane.scrollTop, maxScroll, thumbHeight, thumbTop };
    setMetrics((current) => Object.keys(next).every((key) => current[key as keyof CollectionScrollMetrics] === next[key as keyof CollectionScrollMetrics]) ? current : next);
  }

  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    syncScrollMetrics();
    const resizeObserver = new ResizeObserver(syncScrollMetrics);
    resizeObserver.observe(pane);
    if (pane.firstElementChild) resizeObserver.observe(pane.firstElementChild);
    return () => resizeObserver.disconnect();
  }, [children, showScrollbar]);

  function handleScrollbarPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.target !== event.currentTarget) return;
    const pane = scrollRef.current;
    if (!pane || metrics.maxScroll <= 0) return;
    const track = event.currentTarget.getBoundingClientRect();
    const thumbTravel = Math.max(0, track.height - metrics.thumbHeight);
    const nextThumbTop = Math.min(thumbTravel, Math.max(0, event.clientY - track.top - metrics.thumbHeight / 2));
    pane.scrollTop = thumbTravel > 0 ? metrics.maxScroll * nextThumbTop / thumbTravel : 0;
  }

  function handleThumbPointerDown(event: React.PointerEvent<HTMLSpanElement>) {
    const pane = scrollRef.current;
    if (!pane) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: pane.scrollTop };
  }

  function handleThumbPointerMove(event: React.PointerEvent<HTMLSpanElement>) {
    const pane = scrollRef.current;
    const drag = dragRef.current;
    if (!pane || !drag || drag.pointerId !== event.pointerId) return;
    const trackHeight = Math.max(0, pane.clientHeight - 4);
    const thumbTravel = Math.max(1, trackHeight - metrics.thumbHeight);
    pane.scrollTop = drag.startScrollTop + (event.clientY - drag.startY) * metrics.maxScroll / thumbTravel;
  }

  function stopThumbDrag(event: React.PointerEvent<HTMLSpanElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleScrollbarKeyDown(event: React.KeyboardEvent<HTMLSpanElement>) {
    const pane = scrollRef.current;
    if (!pane) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      pane.scrollTop = event.key === "Home" ? 0 : metrics.maxScroll;
      return;
    }
    const increments: Partial<Record<string, number>> = {
      ArrowUp: -32,
      ArrowDown: 32,
      PageUp: -pane.clientHeight * .85,
      PageDown: pane.clientHeight * .85,
    };
    const increment = increments[event.key];
    if (increment == null) return;
    event.preventDefault();
    pane.scrollTop += increment;
  }

  return (
    <div className={`collection-card-state ${showScrollbar ? "with-scrollbar" : ""} ${metrics.overflow ? "scrollable" : ""}`.trim()}>
      <div
        id={scrollId}
        ref={scrollRef}
        className="collection-card-state-scroll"
        tabIndex={metrics.overflow ? 0 : undefined}
        onScroll={syncScrollMetrics}
      >{children}</div>
      {showScrollbar && <span
        className="collection-card-scrollbar"
        role="scrollbar"
        tabIndex={metrics.overflow ? 0 : -1}
        aria-label="Scroll collectible challenges"
        aria-controls={scrollId}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(metrics.maxScroll)}
        aria-valuenow={Math.round(metrics.scrollTop)}
        aria-disabled={!metrics.overflow}
        onKeyDown={handleScrollbarKeyDown}
        onPointerDown={handleScrollbarPointerDown}
      ><span
        className="collection-card-scrollbar-thumb"
        style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={stopThumbDrag}
        onPointerCancel={stopThumbDrag}
      /></span>}
    </div>
  );
}

function RollcasterGrid({
  data,
  rollcasters,
  setDetail,
  onRefresh,
}: {
  data: AppData;
  rollcasters: AppData["catalog"]["rollcasters"];
  setDetail: (detail: { type: "rollcaster"; id: string }) => void;
  onRefresh: () => Promise<void>;
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
          <article key={rollcaster.id} className={`catalog-card rollcaster-card ${!owned ? "locked" : ""}`} onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            setDetail({ type: "rollcaster", id: rollcaster.id });
          }}>
            <button type="button" className="catalog-card-details" aria-label={`View ${rollcaster.name} details`} onClick={() => setDetail({ type: "rollcaster", id: rollcaster.id })}><Search size={14} aria-hidden="true" /></button>
            <span className="collectible-id">{rollcaster.id}</span>
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster.name} element="basic" assetPath={findAssetPath(data, "rollcaster", rollcaster.id, "card") ?? catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} size="hero" fit="portrait" /></CardSprite>
            <CardName data={data} name={rollcaster.name} />
            <CollectionCardState showScrollbar={!owned}>
              {owned ? <div className="collection-progression"><p>Level {owned.level}</p><ProgressBar progress={progress} /></div> : <CollectibleChallengeRows data={data} type="rollcaster" id={rollcaster.id} onRefresh={onRefresh} />}
            </CollectionCardState>
            <PointCounter kind="ability" points={owned?.ability_points ?? 0} />
          </article>
        );
      })}
    </div>
  );
}

function CritterGrid({
  data,
  critters,
  setDetail,
  onRefresh,
}: {
  data: AppData;
  critters: Critter[];
  setDetail: (detail: { type: "critter"; id: string }) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="collection-grid">
      {critters.map((critter) => {
        const owned = data.player!.critters.find((row) => row.critter_id === critter.id);
        const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
        return (
          <article
            key={critter.id}
            className={`catalog-card critter-card ${!owned ? "locked challenge-locked" : ""}`}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              setDetail({ type: "critter", id: critter.id });
            }}
          >
            <button type="button" className="catalog-card-details" aria-label={`View ${critter.name} details`} onClick={() => setDetail({ type: "critter", id: critter.id })}><Search size={14} aria-hidden="true" /></button>
            <span className="collectible-id">{critter.id}</span>
            <CardSprite><Sprite
              name={critter.name}
              element={critter.element_1_id}
              assetPath={findAssetPath(data, "critter", critter.id, "card") ?? catalogAssetPath(data, "critter", critter.id, critter.asset_path)}
              size="large"
            /></CardSprite>
            <CardName data={data} name={critter.name} critter={critter} />
            <CollectionCardState showScrollbar={!owned}>
              {owned ? <div className="collection-progression critter-progression"><p>Level {owned.level}</p><ProgressBar progress={xpProgress(data.catalog.critterProgression.filter((row) => row.critter_id === critter.id), owned.level, owned.xp)} /></div> : <CollectibleChallengeRows data={data} type="critter" id={critter.id} onRefresh={onRefresh} />}
            </CollectionCardState>
            <StatGrid stats={stats} compact />
            <PointCounter kind="skill" points={owned?.skill_points ?? 0} />
          </article>
        );
      })}
    </div>
  );
}

function RelicGrid({ data, relics, setDetail, onRefresh }: { data: AppData; relics: Relic[]; setDetail: (detail: { type: "relic"; id: string }) => void; onRefresh: () => Promise<void> }) {
  return (
    <div className="collection-grid">
      {relics.map((relic) => {
        const inventory = data.player!.relicInventory.find((row) => row.relic_id === relic.id);
        return <RelicCard key={relic.id} data={data} relic={relic} quantity={inventory?.quantity ?? 0} unlocked={inventory?.discovered_at != null} onClick={() => setDetail({ type: "relic", id: relic.id })} onRefresh={onRefresh} />;
      })}
    </div>
  );
}

function RelicCard({ data, relic, quantity, unlocked, onClick, onRefresh }: { data: AppData; relic: Relic; quantity: number; unlocked: boolean; onClick: () => void; onRefresh: () => Promise<void> }) {
  const effects = data.catalog.effectsByRelic[relic.id] ?? [];
  return (
    <article className={`catalog-card relic-card ${!unlocked ? "locked" : ""}`} onClick={(event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      onClick();
    }}>
      <button type="button" className="catalog-card-details" aria-label={`View ${relic.name} details`} onClick={onClick}><Search size={14} aria-hidden="true" /></button>
      <span className="collectible-id">{relic.id}</span>
      <CardSprite><Sprite name={relic.name} element="metal" assetPath={findAssetPath(data, "relic", relic.id, "card") ?? catalogAssetPath(data, "relic", relic.id, relic.asset_path)} size="large" /></CardSprite>
      <CardName data={data} name={relic.name} />
      <CollectionCardState showScrollbar={!unlocked}>
        {unlocked ? <p>Owned {quantity} / {relic.max_owned}</p> : <CollectibleChallengeRows data={data} type="relic" id={relic.id} onRefresh={onRefresh} />}
      </CollectionCardState>
      <EffectList effects={effects} className="relic-card-effects" />
    </article>
  );
}

function PointCounter({ kind, points }: { kind: "skill" | "ability"; points: number }) {
  return <p className="point-counter"><strong>{points}</strong> {kind} point{points === 1 ? "" : "s"}</p>;
}

function CardSprite({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`card-sprite-frame ${className}`.trim()}>{children}</span>;
}

function CardName({ data, name, critter }: { data: AppData; name: string; critter?: Critter }) {
  return (
    <span className="card-name-row">
      {critter && <CritterElementLogos data={data} critter={critter} />}
      <strong>{name}</strong>
    </span>
  );
}

function CritterElementLogos({ data, critter }: { data: AppData; critter: Critter }) {
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
  const firstBlockedChallengeId = challenges.find((challenge) => progressFor(data, challenge.id).eligible === false)?.id ?? null;

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
          const blocked = progress.eligible === false;
          return (
            <Fragment key={challenge.id}>
              {challenge.id === firstBlockedChallengeId && <div className="challenge-gate-boundary challenge-detail-gate-boundary">
                <span className="gate-blocked"><Lock size={12} />Complete all above challenges first</span>
              </div>}
              <article className={`challenge-detail-row ${progress.completed ? "complete" : ""} ${blocked ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()}>
                <span className="challenge-detail-copy">
                  {gateBadge && <span className="challenge-state-line">
                    <span className="gate-badge">{gateBadge}</span>
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
            </Fragment>
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

  async function purchaseAbility(owned: UserRollcaster, abilityId: string, cost: number) {
    if (owned.ability_points < cost) {
      setDetailError(`Not enough ability points. This ability costs ${cost}.`);
      return;
    }
    setSaving(true);
    setDetailError(null);
    try {
      await unlockRollcasterAbility(owned.id, abilityId);
      await onRefresh();
    } catch (error) {
      setDetailError(errorMessage(error, "Unable to unlock this ability."));
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
        <CollectibleDetailHero data={data} id={critter.id} name={critter.name} critter={critter} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} assetElement={critter.element_1_id} />
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
        <CollectibleDetailHero data={data} id={relic.id} name={relic.name} assetPath={findAssetPath(data, "relic", relic.id, "card") ?? catalogAssetPath(data, "relic", relic.id, relic.asset_path)} assetElement="metal" />
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
      {detailError && <p className="notice error" role="alert">{detailError}</p>}
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
            const canPurchase = Boolean(owned && owned.level >= unlock.unlock_level && !unlocked);
            return (
              <div key={ability.id} className={`detail-ability-tile ${unlocked ? "unlocked" : "locked"} ${canPurchase ? "unlockable" : "level-locked"}`}>
                <article className={`detail-ability-card ${unlocked ? "unlocked" : "locked"}`}>
                  <span className="detail-ability-heading"><strong>{ability.name}</strong></span>
                  <span>{ability.description}</span>
                  <EffectList effects={data.catalog.effectsByAbility[ability.id] ?? []} />
                </article>
                <span className="unlock-requirement">Unlock level {unlock.unlock_level} · {unlock.unlock_cost} ability point{unlock.unlock_cost === 1 ? "" : "s"}</span>
                {canPurchase && owned && <button className="primary-button ability-unlock-button" disabled={saving} onClick={() => purchaseAbility(owned, ability.id, unlock.unlock_cost)}>Unlock · {unlock.unlock_cost}</button>}
              </div>
            );
          })}
      </div>
    </Modal>
  );
}

function CollectibleDetailHero({ data, id, name, critter, assetPath, assetElement }: { data: AppData; id: string; name: string; critter?: Critter; assetPath: string | null; assetElement: string }) {
  return (
    <div className="collectible-detail-hero">
      <span className="collectible-id">{id}</span>
      <CardSprite className={assetElement === "basic" && !critter ? "rollcaster-sprite-frame" : ""}><Sprite name={name} element={assetElement} assetPath={assetPath} size="hero" fit={assetElement === "basic" && !critter ? "portrait" : "contain"} /></CardSprite>
      <CardName data={data} name={name} critter={critter} />
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
  const [infoDungeon, setInfoDungeon] = useState<EffectiveDungeon | null>(null);
  const dungeons = effectiveDungeons(data.player!, data.catalog.dungeons, data.catalog.dungeonOpponents);
  return (
    <section className="screen-stack dungeon-select-screen">
      <div className="screen-heading row">
        <div>
          <h1>Dungeons</h1>
          <p>Choose an expedition. Your squad begins each run at full HP, then carries its wounds between encounters.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>Back</button>
      </div>
      <div className="dungeon-grid">
        {dungeons.map((entry) => (
          <article
            key={entry.dungeon.id}
            className={`dungeon-card dungeon-grid-card ${!entry.enterable ? "locked" : ""} ${(entry.progress?.clear_count ?? 0) > 0 ? "completed" : ""}`}
          >
            <span className="collectible-id">{entry.dungeon.id}</span>
            <button
              type="button"
              className="catalog-card-details dungeon-info-button"
              aria-label={`View ${entry.dungeon.name} information`}
              onClick={() => setInfoDungeon(entry)}
            >
              <Info size={16} aria-hidden="true" />
            </button>
            <span className={`dungeon-logo-frame ${entry.mode}`} role="img" aria-label={`${entry.mode === "boss" ? "Boss" : "Regular"} Dungeon`}>
              {entry.logoPath
                ? <AssetIcon path={entry.logoPath} alt="" fallback={entry.mode === "boss" ? <Skull /> : <Swords />} />
                : entry.mode === "boss" ? <Skull /> : <Swords />}
            </span>
            <h2>{entry.dungeon.name}</h2>
            <p className="dungeon-description">{entry.dungeon.description || "\u00a0"}</p>
            <div className="dungeon-stat-grid">
              <span><small>Difficulty</small><strong>{entry.difficulty}</strong></span>
              <span><small>Format</small><strong>{entry.dungeon.battle_format}</strong></span>
              <span><small>Encounters</small><strong>{entry.battleCount}</strong></span>
              <span><small>Clears</small><strong>{entry.progress?.clear_count ?? 0}</strong></span>
            </div>
            <p className="dungeon-entry-state locked">{entry.lockedReason ?? "\u00a0"}</p>
            <button className="primary-button dungeon-enter-button" disabled={!entry.enterable} onClick={() => onStart(entry.dungeon)}>
              {entry.enterable ? "Enter Dungeon" : <><Lock size={15} /> Locked</>}
            </button>
          </article>
        ))}
      </div>
      {infoDungeon && <DungeonInfoDialog data={data} entry={infoDungeon} onClose={() => setInfoDungeon(null)} />}
    </section>
  );
}

function DungeonInfoDialog({ data, entry, onClose }: { data: AppData; entry: EffectiveDungeon; onClose: () => void }) {
  return (
    <Modal
      eyebrow="Dungeon briefing"
      title={`${entry.dungeon.id} · ${entry.dungeon.name}`}
      description={`${entry.dungeon.battle_format} · ${entry.battleCount} encounter${entry.battleCount === 1 ? "" : "s"} · Difficulty ${entry.difficulty}`}
      onClose={onClose}
    >
      <div className="dungeon-info-summary">
        <span className={`dungeon-logo-frame ${entry.mode}`}>
          {entry.logoPath
            ? <AssetIcon path={entry.logoPath} alt="" fallback={entry.mode === "boss" ? <Skull /> : <Swords />} />
            : entry.mode === "boss" ? <Skull /> : <Swords />}
        </span>
        <div>
          <p className="eyebrow">{entry.mode === "boss" ? "First-clear lineup" : "Regular encounter pool"}</p>
          <h3>{entry.pool.length} opponent{entry.pool.length === 1 ? "" : "s"}</h3>
          {entry.mode === "boss" && <p>Opponents arrive in fixed Boss Order.</p>}
        </div>
      </div>
      <div className="dungeon-opponent-list">
        {entry.pool.map((opponent, index) => {
          const critter = byId(data.catalog.critters, opponent.critter_id);
          if (!critter) return null;
          return (
            <details className="dungeon-opponent-entry" key={opponent.id}>
              <summary>
                <SpriteFrame size="sm"><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>
                <span className="dungeon-opponent-identity">
                  <span className="collectible-id">{critter.id}</span>
                  <CritterName data={data} critter={critter} />
                  <small>Level {opponent.critter_level}</small>
                </span>
                <strong className="dungeon-opponent-rate">
                  {entry.mode === "boss" ? `Boss position ${index + 1}` : formatProbability(opponent.probability ?? 0)}
                </strong>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="dungeon-opponent-drop-panel">
                <div className="dungeon-xp-drops">
                  <span><Sparkles size={16} /> {opponent.critter_xp_reward} Critter XP</span>
                  <span><UserRound size={16} /> {opponent.rollcaster_xp_reward} Rollcaster XP</span>
                </div>
                {[...opponent.currencyDrops, ...opponent.itemDrops].length
                  ? <div className="dungeon-drop-list">{[...opponent.currencyDrops, ...opponent.itemDrops].map((drop) => <DungeonDropRow key={drop.id} data={data} drop={drop} />)}</div>
                  : <p className="dungeon-no-drops">No item or Currency drops.</p>}
              </div>
            </details>
          );
        })}
      </div>
    </Modal>
  );
}

function DungeonDropRow({ data, drop }: { data: AppData; drop: DungeonDrop }) {
  const currency = drop.kind === "currency" ? currencyFor(data, drop.targetId) : undefined;
  const targetName = drop.kind === "currency"
    ? currency?.name ?? drop.targetId
    : collectibleName(data, drop.targetCategory ?? "relic", drop.targetId);
  return (
    <div className="dungeon-drop-row">
      {drop.kind === "currency"
        ? <AssetIcon path={catalogAssetPath(data, "currency", currency?.id, currency?.asset_path, "icon")} alt="" fallback={<Coins size={17} />} />
        : <CollectibleSprite data={data} type={drop.targetCategory ?? "relic"} id={drop.targetId} size="xs" shard={drop.kind === "shard"} />}
      <span>
        <strong>{dropAmountLabel(drop.minAmount, drop.maxAmount)} {drop.kind === "shard" ? `${targetName} Shards` : targetName}</strong>
        <small>{Math.round(drop.probability * 10000) / 100}% chance</small>
        {drop.kind !== "currency" && drop.dupeCurrencyId && <small>Duplicates convert to {drop.dupeCurrencyAmount ?? 0} {currencyFor(data, drop.dupeCurrencyId)?.name ?? drop.dupeCurrencyId} each.</small>}
      </span>
    </div>
  );
}

function CombatScreen({
  data,
  combat,
  setCombat,
  onTurnResolved,
  onBattleResult,
  onBack,
  onHome,
  onReplay,
  onNextDungeon,
}: {
  data: AppData;
  combat: DungeonRunState;
  setCombat: (state: DungeonRunState) => void;
  onTurnResolved: (state: DungeonRunState) => Promise<void>;
  onBattleResult: (state: DungeonRunState) => Promise<void>;
  onBack: () => void;
  onHome: () => void;
  onReplay: () => void;
  onNextDungeon: (dungeonId: string) => void;
}) {
  const [actions, setActions] = useState<Record<string, CombatAction>>({});
  const [menu, setMenu] = useState<"actions" | "skills" | "swap">("actions");
  const [targeting, setTargeting] = useState<{ actorKey: string; skill: Skill } | null>(null);
  const [submittingProgress, setSubmittingProgress] = useState(false);
  const [recordingResult, setRecordingResult] = useState(false);
  const [resultAttempt, setResultAttempt] = useState(0);
  const [diceSettled, setDiceSettled] = useState(true);
  const [eventSettled, setEventSettled] = useState(true);
  const [swapMotion, setSwapMotion] = useState<{
    eventId: string;
    actorKey: string;
    x: number;
    y: number;
  } | null>(null);
  const battle = combat.battle;
  const activePlayer = battle.playerUnits.filter((unit) => unit.active && unit.hp > 0);
  const totalCost = Object.values(actions).reduce((sum, action) => sum + action.cost, 0);
  const manaAssetPath = findAssetPath(data, "mana", "mana");
  const activeOwnedRollcaster = data.player!.rollcasters.find((row) => row.id === data.player!.profile.active_rollcaster_id) ?? data.player!.rollcasters[0];
  const activeRollcaster = byId(data.catalog.rollcasters, activeOwnedRollcaster?.rollcaster_id);
  const activeAbilities = data.player!.abilitySlots
    .filter((slot) => slot.user_rollcaster_id === activeOwnedRollcaster?.id && slot.ability_id)
    .sort((left, right) => left.slot_index - right.slot_index)
    .map((slot) => byId(data.catalog.rollcasterAbilities, slot.ability_id))
    .filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
  const legalTargets = targeting ? skillTargets(battle, targeting.actorKey, targeting.skill) : [];
  const legalTargetKeys = new Set(legalTargets.map((unit) => unit.key));
  const queuedSwapIds = new Set(Object.values(actions).map((action) => action.swapToId).filter(Boolean));
  const currentActor = activePlayer.find((unit) => !actions[unit.key]);
  const currentActorIndex = currentActor ? activePlayer.findIndex((unit) => unit.key === currentActor.key) : activePlayer.length;
  const event = currentDungeonEvent(combat);
  const swapRevealed = Boolean(event?.swap && battle.playerUnits.some((unit) => (
    unit.key === event.swap!.incomingKey
    && unit.active
    && unit.battlefieldSlot === event.swap!.battlefieldSlot
  )));
  const playerFieldSlots = battlefieldSlotsForCount(battle.dungeon.player_active_count);
  const opponentFieldSlots = battlefieldSlotsForCount(battle.dungeon.opponent_active_count);
  const viewportFitRef = useViewportFitScale();
  const actionsReady = combat.phase === "select_player_actions"
    && !submittingProgress
    && !targeting
    && totalCost <= battle.playerMana
    && activePlayer.length > 0
    && Object.keys(actions).length === activePlayer.length;

  useEffect(() => {
    setActions({});
    setTargeting(null);
    setMenu("actions");
  }, [combat.run.battleIndex, battle.turn, combat.phase === "select_player_actions"]);

  useEffect(() => {
    if (combat.phase !== "battle_result" || recordingResult) return;
    setRecordingResult(true);
    void onBattleResult(combat).finally(() => setRecordingResult(false));
  }, [combat.phase, combat.run.battleIndex, resultAttempt]);

  useEffect(() => {
    if (combat.phase !== "roll_result") {
      setDiceSettled(true);
      return;
    }
    setDiceSettled(false);
    const timer = window.setTimeout(() => setDiceSettled(true), 650);
    return () => window.clearTimeout(timer);
  }, [combat.phase, battle.turn, combat.rollSummary?.player, combat.rollSummary?.opponent]);

  useEffect(() => {
    if (combat.phase !== "event_playback" || !event || !["skill", "damage", "heal", "swap"].includes(event.kind)) {
      setEventSettled(true);
      return;
    }
    setEventSettled(false);
    if (event.kind === "swap" && event.swap) {
      if (swapRevealed) {
        setEventSettled(true);
        return;
      }
      const revealTimer = window.setTimeout(() => {
        setCombat(revealDungeonSwapEvent(combat));
      }, 720);
      const settleTimer = window.setTimeout(() => setEventSettled(true), 1_180);
      return () => {
        window.clearTimeout(revealTimer);
        window.clearTimeout(settleTimer);
      };
    }
    const timer = window.setTimeout(() => setEventSettled(true), event.kind === "skill" ? 620 : 720);
    return () => window.clearTimeout(timer);
  }, [combat.phase, event?.id]);

  useLayoutEffect(() => {
    setSwapMotion(null);
    if (combat.phase !== "event_playback" || event?.kind !== "swap" || !event.swap) return;
    const root = viewportFitRef.current;
    if (!root) return;
    const actor = [...root.querySelectorAll<HTMLElement>("[data-combat-unit-key]")]
      .find((node) => node.dataset.combatUnitKey === event.swap!.outgoingKey);
    const source = actor?.querySelector<HTMLElement>(".critter-combat-frame");
    const destination = root.querySelector<HTMLElement>(".rollcaster-combat-frame");
    if (!source || !destination) return;
    const sourceRect = source.getBoundingClientRect();
    const destinationRect = destination.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    if (!Number.isFinite(scale) || scale <= 0) return;
    setSwapMotion({
      eventId: event.id,
      actorKey: event.swap.outgoingKey,
      x: ((destinationRect.left + destinationRect.width / 2) - (sourceRect.left + sourceRect.width / 2)) / scale,
      y: ((destinationRect.top + destinationRect.height / 2) - (sourceRect.top + sourceRect.height / 2)) / scale,
    });
  }, [combat.phase, event?.id]);

  function setAction(action: CombatAction) {
    setActions((current) => ({ ...current, [action.actorKey]: action }));
    setTargeting(null);
    setMenu("actions");
  }

  function chooseSkill(actorKey: string, skill: Skill) {
    const targets = skillTargets(battle, actorKey, skill);
    if (isSingleTarget(skill) && targets.length > 1) {
      setTargeting({ actorKey, skill });
      return;
    }
    setAction({ actorKey, type: "skill", skillId: skill.id, targetKey: isSingleTarget(skill) ? targets[0]?.key : undefined, cost: skill.mana_cost });
  }

  function backToPreviousActor() {
    if (currentActorIndex < 1) {
      setMenu("actions");
      setTargeting(null);
      return;
    }
    const previousIndex = currentActorIndex - 1;
    setActions((current) => Object.fromEntries(
      Object.entries(current).filter(([actorKey]) => activePlayer.findIndex((unit) => unit.key === actorKey) < previousIndex),
    ));
    setMenu("actions");
    setTargeting(null);
  }

  function reselectAction(actorKey: string) {
    const actorIndex = activePlayer.findIndex((unit) => unit.key === actorKey);
    if (actorIndex < 0) return;
    setActions((current) => Object.fromEntries(
      Object.entries(current).filter(([selectedActorKey]) => (
        activePlayer.findIndex((unit) => unit.key === selectedActorKey) < actorIndex
      )),
    ));
    setMenu("actions");
    setTargeting(null);
  }

  async function submitActions() {
    if (!actionsReady) return;
    const resolved = submitDungeonActions(combat, activePlayer.map((unit) => actions[unit.key]));
    setCombat(resolved);
    setSubmittingProgress(true);
    try { await onTurnResolved(resolved); } finally { setSubmittingProgress(false); }
  }

  if (combat.phase === "dungeon_complete" || combat.phase === "dungeon_failed") {
    const complete = combat.phase === "dungeon_complete";
    return (
      <DungeonOutcomeScreen
        data={data}
        combat={combat}
        complete={complete}
        onHome={onHome}
        onReplay={onReplay}
        onNextDungeon={onNextDungeon}
      />
    );
  }

  return (
    <section className="combat-screen">
      <div ref={viewportFitRef} className="combat-viewport-fit">
        <div className="combat-header">
          <button className="secondary-button" onClick={onBack}><ChevronLeft size={16} /> Dungeons</button>
          <div>
            <p className="eyebrow">{combat.run.effectiveMode === "boss" ? "Boss expedition" : "Dungeon expedition"}</p>
            <h1>{combat.dungeon.name}</h1>
            <p>Encounter {combat.run.battleIndex} / {combat.run.battleCount} · Turn {battle.turn} · {combat.run.battleFormat}</p>
          </div>
          <span className="combat-phase-badge">{combat.phase.replace(/_/g, " ")}</span>
        </div>

        <div className="combat-board">
          <aside className="combat-mana-panel rollcaster-mana-panel">
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
            <h3>{activeRollcaster?.name ?? "Rollcaster"}</h3>
            <strong className="combat-mana-total"><AssetIcon path={manaAssetPath} alt="Player Mana" fallback={<Gem />} /> {battle.playerMana}</strong>
            <div className="combat-ability-list">
              {activeAbilities.length
                ? activeAbilities.map((ability) => (
                  <GameTooltip
                    key={ability.id}
                    label={`${ability.name}. ${ability.description} ${attachmentText(data.catalog.effectsByAbility[ability.id] ?? [])}`}
                    content={<><strong>{ability.name}</strong><span>{ability.description}</span>{attachmentRows(data.catalog.effectsByAbility[ability.id] ?? [])}</>}
                  >
                    <span className="combat-ability-slot">{ability.name}</span>
                  </GameTooltip>
                ))
                : <span className="combat-ability-slot empty">No Ability equipped</span>}
            </div>
          </aside>
          <div className="battle-column player-column">
            {[0, 1, 2].map((slot) => {
              const unit = battle.playerUnits.find((candidate) => candidate.active && candidate.battlefieldSlot === slot);
              if (!unit || !playerFieldSlots.includes(slot)) return <CombatEmptySlot key={slot} label="Inactive player slot" />;
              return <BattleUnit
                key={unit.key}
                unit={unit}
                data={data}
                allUnits={[...battle.playerUnits, ...battle.opponentUnits]}
                action={actions[unit.key]}
                interactive={combat.phase === "select_player_actions" && currentActor?.key === unit.key && !targeting}
                waiting={combat.phase === "select_player_actions" && unit.active && unit.hp > 0 && currentActor?.key !== unit.key && !actions[unit.key]}
                menu={currentActor?.key === unit.key ? menu : "actions"}
                setMenu={setMenu}
                bench={battle.playerUnits.filter((candidate) => !candidate.active && candidate.hp > 0 && !queuedSwapIds.has(candidate.userCritter?.id))}
                availableMana={battle.playerMana - totalCost}
                onAction={setAction}
                onChooseSkill={chooseSkill}
                onBack={backToPreviousActor}
                canGoBack={currentActorIndex > 0 || menu !== "actions"}
                onReselectAction={combat.phase === "select_player_actions" && actions[unit.key]
                  ? () => reselectAction(unit.key)
                  : undefined}
                targetable={legalTargetKeys.has(unit.key)}
                onTarget={() => targeting && setAction({ actorKey: targeting.actorKey, type: "skill", skillId: targeting.skill.id, targetKey: unit.key, cost: targeting.skill.mana_cost })}
                statuses={battle.statuses.filter((status) => status.holderKey === unit.key)}
                manaAssetPath={manaAssetPath}
                presentation={event}
                swapMotion={swapMotion !== null && swapMotion.eventId === event?.id && swapMotion.actorKey === unit.key
                  ? swapMotion
                  : undefined}
              />;
            })}
          </div>
          <div className="battle-column opponent-column">
            {[0, 1, 2].map((slot) => {
              const unit = battle.opponentUnits.find((candidate) => candidate.active && candidate.battlefieldSlot === slot);
              if (combat.phase === "lead_selection" && opponentFieldSlots.includes(slot)) {
                return <CombatHiddenOpponentSlot key={slot} />;
              }
              return unit
                ? <BattleUnit
                    key={unit.key}
                    unit={unit}
                    data={data}
                    allUnits={[...battle.playerUnits, ...battle.opponentUnits]}
                    opponent
                    targetable={legalTargetKeys.has(unit.key)}
                    onTarget={() => targeting && setAction({ actorKey: targeting.actorKey, type: "skill", skillId: targeting.skill.id, targetKey: unit.key, cost: targeting.skill.mana_cost })}
                    statuses={battle.statuses.filter((status) => status.holderKey === unit.key)}
                    manaAssetPath={manaAssetPath}
                    presentation={event}
                  />
                : <CombatEmptySlot key={slot} label="Inactive enemy slot" opponent />;
            })}
          </div>
          <aside className="combat-mana-panel enemy-mana-panel">
            <span className="enemy-mana-emblem"><Skull size={44} /></span>
            <h3>Enemy Mana</h3>
            <strong className="combat-mana-total"><AssetIcon path={manaAssetPath} alt="Enemy Mana" fallback={<Gem />} /> {battle.opponentMana}</strong>
          </aside>
        </div>

        <CombatDiceRow
          data={data}
          combat={combat}
          manaAssetPath={manaAssetPath}
          rolling={!diceSettled}
          onRoll={() => {
            setDiceSettled(false);
            setCombat(rollDungeonDice(combat));
          }}
          canSubmit={actionsReady}
          submitting={submittingProgress}
          onSubmit={submitActions}
        />

        <button
          type="button"
          className={`combat-narration ${combat.phase === "event_playback" || combat.phase === "roll_result" ? "advanceable" : ""}`}
          disabled={
            (combat.phase !== "event_playback" && combat.phase !== "roll_result")
            || (combat.phase === "roll_result" && !diceSettled)
            || (combat.phase === "event_playback" && (submittingProgress || !eventSettled))
          }
          onClick={() => setCombat(combat.phase === "event_playback" ? advanceDungeonEvent(combat) : continueAfterRoll(combat))}
        >
          <span>
            {combat.phase === "lead_selection" && `Choose ${combat.requiredLeadCount} healthy lead Critter${combat.requiredLeadCount === 1 ? "" : "s"} before revealing the enemy lineup.`}
            {combat.phase === "forced_replacements" && `Choose ${combat.requiredLeadCount - combat.fixedLeadIds.length} replacement${combat.requiredLeadCount - combat.fixedLeadIds.length === 1 ? "" : "s"} for the knocked-out active slot${combat.requiredLeadCount - combat.fixedLeadIds.length === 1 ? "" : "s"}.`}
            {combat.phase === "await_roll" && `Roll the Dice to start Turn ${battle.turn}.`}
            {combat.phase === "roll_result" && (!diceSettled
              ? "Rolling…"
              : `User rolled ${combat.rollSummary?.player ?? 0} mana and enemy rolled ${combat.rollSummary?.opponent ?? 0} mana.`)}
            {combat.phase === "select_player_actions" && (targeting ? `Choose a legal target for ${targeting.skill.name}.` : currentActor ? `Choose ${currentActor.name}'s action.` : "All actions are ready. Submit when prepared.")}
            {combat.phase === "event_playback" && (submittingProgress ? "Saving the resolved turn…" : event?.message)}
            {combat.phase === "battle_result" && (recordingResult ? "Committing encounter rewards…" : "Encounter resolved.")}
            {combat.phase === "encounter_rewards" && `Encounter ${combat.run.battleIndex - 1} cleared.`}
          </span>
          {(combat.phase === "event_playback" || combat.phase === "roll_result") && <ChevronRight size={24} aria-label="Next" />}
        </button>

        {combat.phase === "battle_result" && !recordingResult && (
          <div className="combat-command-row">
            <button className="primary-button" onClick={() => setResultAttempt((attempt) => attempt + 1)}>
              <RefreshCw size={17} /> Retry Save
            </button>
          </div>
        )}
      </div>
      {combat.phase === "encounter_rewards" && combat.lastBattleRewards && (
        <CombatResultDialog
          data={data}
          title={`Encounter ${combat.run.battleIndex - 1} / ${combat.run.battleCount} cleared`}
          rewards={combat.lastBattleRewards}
          actionLabel="Next Encounter"
          onAction={() => setCombat(continueAfterEncounterRewards(combat))}
        />
      )}
      {(combat.phase === "lead_selection" || combat.phase === "forced_replacements") && (
        <CombatLeadDialog
          data={data}
          combat={combat}
          onToggle={(id) => setCombat(toggleDungeonLead(combat, id))}
          onConfirm={() => setCombat(confirmDungeonLeads(combat))}
        />
      )}
    </section>
  );
}

function CombatLeadDialog({
  data,
  combat,
  onToggle,
  onConfirm,
}: {
  data: AppData;
  combat: DungeonRunState;
  onToggle: (id: string) => void;
  onConfirm: () => void;
}) {
  const replacementCount = combat.requiredLeadCount - combat.fixedLeadIds.length;
  const choosingReplacements = combat.phase === "forced_replacements";
  const requestedCount = choosingReplacements ? replacementCount : combat.requiredLeadCount;
  return (
    <div className="combat-lead-overlay" role="dialog" aria-modal="true" aria-labelledby="combat-lead-title">
      <section className="combat-lead-dialog">
        <p className="eyebrow">{choosingReplacements ? "Party replacement" : "Choose your lead"}</p>
        <h2 id="combat-lead-title">Select {requestedCount} Critter{requestedCount === 1 ? "" : "s"}</h2>
        <p>
          {choosingReplacements
            ? "Choose healthy equipped Critters to fill the open active slots."
            : `Your ${combat.run.battleFormat} formation will place the selected lead${combat.requiredLeadCount === 1 ? "" : "s"} in the active battlefield slot${combat.requiredLeadCount === 1 ? "" : "s"}.`}
        </p>
        <div className="combat-lead-grid">
          {combat.battle.playerUnits.filter((unit) => unit.userCritter).map((unit) => {
            const ownedId = unit.userCritter!.id;
            const selected = combat.selectedLeadIds.includes(ownedId);
            const fixed = combat.fixedLeadIds.includes(ownedId);
            return (
              <button
                type="button"
                key={unit.key}
                className={`combat-lead-option ${selected ? "selected" : ""}`}
                disabled={unit.hp <= 0 || fixed}
                aria-pressed={selected}
                onClick={() => onToggle(ownedId)}
              >
                <SpriteFrame size="md"><Sprite name={unit.name} element={unit.critter.element_1_id} assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)} /></SpriteFrame>
                <span className="combat-lead-option-copy">
                  <CritterName data={data} critter={unit.critter} />
                  <small>Lv {unit.level} · {unit.hp} / {unit.maxHp} HP</small>
                  {unit.hp <= 0 && <strong>Knocked out</strong>}
                  {fixed && <strong>Already active</strong>}
                </span>
                {selected && <Check size={19} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        <button className="primary-button combat-lead-confirm" disabled={combat.selectedLeadIds.length !== combat.requiredLeadCount} onClick={onConfirm}>
          {choosingReplacements ? "Resume Encounter" : "Start Encounter"}
        </button>
      </section>
    </div>
  );
}

function BattleUnit({
  unit,
  data,
  allUnits = [],
  action,
  interactive = false,
  waiting = false,
  menu = "actions",
  setMenu,
  bench = [],
  onAction,
  onChooseSkill,
  onBack,
  canGoBack = false,
  onReselectAction,
  opponent = false,
  availableMana = 0,
  selected = false,
  selectable = false,
  onSelect,
  targetable = false,
  onTarget,
  statuses = [],
  manaAssetPath,
  presentation,
  swapMotion,
}: {
  unit: CombatState["playerUnits"][number];
  data: AppData;
  allUnits?: CombatState["playerUnits"];
  action?: CombatAction;
  interactive?: boolean;
  waiting?: boolean;
  menu?: "actions" | "skills" | "swap";
  setMenu?: (menu: "actions" | "skills" | "swap") => void;
  bench?: CombatState["playerUnits"];
  onAction?: (action: CombatAction) => void;
  onChooseSkill?: (actorKey: string, skill: Skill) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  onReselectAction?: () => void;
  opponent?: boolean;
  availableMana?: number;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
  targetable?: boolean;
  onTarget?: () => void;
  statuses?: CombatState["statuses"];
  manaAssetPath: string | null;
  presentation?: ReturnType<typeof currentDungeonEvent>;
  swapMotion?: { x: number; y: number };
}) {
  const pct = Math.max(0, Math.round((unit.hp / unit.maxHp) * 100));
  const healthTone = pct > 65 ? "healthy" : pct > 35 ? "wounded" : "critical";
  const summary = action ? combatActionSummary(data, allUnits, unit, action) : null;
  const acting = presentation?.kind === "skill" && presentation.actorKey === unit.key;
  const swappingOut = presentation?.kind === "swap"
    && presentation.swap?.outgoingKey === unit.key
    && unit.active;
  const swappingIn = presentation?.kind === "swap"
    && presentation.swap?.incomingKey === unit.key
    && unit.active;
  const reacting = presentation?.targetKeys.includes(unit.key) ?? false;
  const reactionClass = reacting && presentation
    ? presentation.kind === "damage"
      ? "taking-damage"
      : presentation.kind === "heal"
        ? "receiving-heal"
        : presentation.kind === "status"
          ? "receiving-status"
          : ""
    : "";
  return (
    <article
      className={`battle-unit ${interactive ? "combat-unit-interactive" : ""} ${!unit.active ? "bench" : ""} ${unit.hp <= 0 ? "knocked-out" : ""} ${opponent ? "opponent" : ""} ${selected ? "selected-lead" : ""} ${selectable ? "selectable" : ""} ${targetable ? "legal-target" : ""} ${waiting ? "waiting-turn" : ""} ${acting ? "acting-skill" : ""} ${swappingOut ? "swapping-out" : ""} ${swappingIn ? "swapping-in" : ""} ${reactionClass}`}
      data-combat-unit-key={unit.key}
      style={swapMotion ? ({
        "--combat-swap-x": `${swapMotion.x}px`,
        "--combat-swap-y": `${swapMotion.y}px`,
      } as React.CSSProperties) : undefined}
      onClick={targetable ? onTarget : selectable ? onSelect : undefined}
      role={targetable || selectable ? "button" : undefined}
      tabIndex={targetable || selectable ? 0 : undefined}
      onKeyDown={(event) => {
        if ((targetable || selectable) && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          (targetable ? onTarget : onSelect)?.();
        }
      }}
    >
      <div className="combat-unit-top">
        <span className="combat-sprite-stack">
        <span className="combat-sprite-frame critter-combat-frame"><Sprite
          name={unit.name}
          element={unit.critter.element_1_id}
          assetPath={catalogAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path)}
          size="medium"
          flipped={opponent}
        /></span>
        {unit.active && unit.hp > 0 && <StatusIconRow data={data} statuses={statuses} />}
        </span>
        <div className="battle-unit-info">
          <span className="combat-identity-row">
            <CritterName data={data} critter={unit.critter} />
            <strong className="combat-level">Lv {unit.level}</strong>
            <span className="mana-roll-stat"><AssetIcon path={manaAssetPath} alt="Mana Roll" fallback={<Gem />} /> {unit.stats.diceMin}–{unit.stats.diceMax}</span>
          </span>
          <div className={`hp-bar ${healthTone}`} role="progressbar" aria-label={`${unit.name} health`} aria-valuemin={0} aria-valuemax={unit.maxHp} aria-valuenow={unit.hp} aria-valuetext={`${unit.hp} of ${unit.maxHp} HP`}><span style={{ width: `${pct}%` }} /></div>
          <p>{unit.hp} / {unit.maxHp} HP {unit.blocking ? "· Blocking" : ""}</p>
        </div>
      </div>
      <div className="combat-action-space">
        {interactive && onAction && (
          <>
            <button className="combat-back-row" disabled={!canGoBack} onClick={(event) => { event.stopPropagation(); onBack?.(); }}>
              <ChevronLeft size={14} /> {menu === "actions" ? "Back to previous Critter" : "Back to Action Menu"}
            </button>
            {menu === "actions" && <div className="combat-primary-actions">
              <button onClick={(event) => { event.stopPropagation(); setMenu?.("skills"); }}><Swords size={16} /> Skill</button>
              <button disabled={unit.stats.blockCost > availableMana} onClick={(event) => { event.stopPropagation(); onAction({ actorKey: unit.key, type: "block", cost: unit.stats.blockCost }); }}><Shield size={16} /> Block <ManaCost path={manaAssetPath} amount={unit.stats.blockCost} /></button>
              <button disabled={bench.length === 0 || unit.stats.swapCost > availableMana} onClick={(event) => { event.stopPropagation(); setMenu?.("swap"); }}><RefreshCw size={16} /> Swap <ManaCost path={manaAssetPath} amount={unit.stats.swapCost} /></button>
              <button onClick={(event) => { event.stopPropagation(); onAction({ actorKey: unit.key, type: "skip", cost: 0 }); }}><ChevronRight size={16} /> Skip <ManaCost path={manaAssetPath} amount={0} /></button>
            </div>}
            {menu === "skills" && <div className="combat-skill-actions">
              {[0, 1, 2, 3].map((slot) => {
                const skill = unit.skills[slot];
                return skill
                  ? <SkillTile
                      key={skill.id}
                      data={data}
                      skill={skill}
                      disabled={skill.mana_cost > availableMana}
                      disabledReason={skill.mana_cost > availableMana ? "Insufficient Mana." : undefined}
                      onClick={(event) => { event.stopPropagation(); onChooseSkill?.(unit.key, skill); }}
                    />
                  : <button key={slot} className="combat-empty-skill" disabled>-----</button>;
              })}
            </div>}
            {menu === "swap" && <div className="combat-swap-actions">
              {bench.map((candidate) => <button key={candidate.key} data-swap-to-id={candidate.userCritter?.id} onClick={(event) => {
                event.stopPropagation();
                onAction({ actorKey: unit.key, type: "swap", swapToId: candidate.userCritter?.id, cost: unit.stats.swapCost });
              }}>
                <SpriteFrame size="xs"><Sprite name={candidate.name} element={candidate.critter.element_1_id} assetPath={catalogAssetPath(data, "critter", candidate.critter.id, candidate.critter.asset_path)} /></SpriteFrame>
                <span>Swap to <strong>{candidate.name}</strong></span>
              </button>)}
            </div>}
          </>
        )}
        {!interactive && (
          <div className={`combat-action-status-row ${onReselectAction ? "editable" : ""}`}>
            {onReselectAction && (
              <button
                type="button"
                className="combat-reselect-action"
                aria-label={`Reselect ${unit.name}'s action`}
                onClick={(event) => {
                  event.stopPropagation();
                  onReselectAction();
                }}
              >
                <ChevronLeft size={15} />
              </button>
            )}
            <span className="combat-action-summary">{summary?.content ?? (swappingIn ? "Swap complete" : opponent ? "Enemy intent hidden" : unit.active ? "Awaiting action" : "Inactive")}</span>
          </div>
        )}
      </div>
      {selected && <span className="combat-selection-label"><Check size={14} /> Selected</span>}
      {targetable && <span className="combat-selection-label target"><Target size={14} /> Legal target</span>}
    </article>
  );
}

function CombatEmptySlot({ label, opponent = false }: { label: string; opponent?: boolean }) {
  return (
    <article className={`battle-unit combat-empty-slot ${opponent ? "opponent" : ""}`} aria-label={label}>
      <Lock size={22} aria-hidden="true" />
    </article>
  );
}

function CombatHiddenOpponentSlot() {
  return (
    <article className="battle-unit combat-empty-slot combat-hidden-opponent opponent" aria-label="Hidden enemy slot">
      <span className="hidden-opponent-mark">?</span>
    </article>
  );
}

function ManaCost({ path, amount }: { path: string | null; amount: number }) {
  return <span className="combat-mana-cost"><AssetIcon path={path} alt="Mana" fallback={<Gem />} /> {amount}</span>;
}

function combatActionSummary(
  data: AppData,
  allUnits: CombatState["playerUnits"],
  actor: CombatState["playerUnits"][number],
  action: CombatAction,
): { content: React.ReactNode } {
  if (action.type === "block") return { content: "Blocking" };
  if (action.type === "skip") return { content: "Skipping" };
  if (action.type === "swap") {
    const target = data.player!.critters.find((owned) => owned.id === action.swapToId);
    const critter = byId(data.catalog.critters, target?.critter_id);
    return {
      content: <>Swapping to <strong className="combat-action-target friendly">{critter?.name ?? "Critter"}</strong></>,
    };
  }
  const skill = actor.skills.find((candidate) => candidate.id === action.skillId);
  const target = action.targetKey ? allUnits.find((unit) => unit.key === action.targetKey) : null;
  const targetTone = target
    ? target.side === actor.side ? "friendly" : "enemy"
    : skill?.skill_type === "support" ? "friendly" : "enemy";
  return {
    content: (
      <>
        <strong>{skill?.name ?? "Skill"}</strong>
        <span aria-hidden="true">→</span>
        <strong className={`combat-action-target ${targetTone}`}>
          {target?.name ?? (skill ? targetingDescription(skill) : "target")}
        </strong>
      </>
    ),
  };
}

function CombatDiceRow({
  data,
  combat,
  manaAssetPath,
  rolling,
  onRoll,
  canSubmit,
  submitting,
  onSubmit,
}: {
  data: AppData;
  combat: DungeonRunState;
  manaAssetPath: string | null;
  rolling: boolean;
  onRoll: () => void;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void | Promise<void>;
}) {
  const playerDice = combat.battle.playerUnits.filter((unit) => unit.active && unit.hp > 0);
  const enemiesHidden = combat.phase === "lead_selection";
  const opponentDice = enemiesHidden
    ? []
    : combat.battle.opponentUnits.filter((unit) => unit.active && unit.hp > 0);
  return (
    <div className="combat-dice-row">
      <div className="combat-dice-side player">
        {playerDice.map((unit) => <CombatDie key={unit.key} data={data} unit={unit} rolling={rolling} manaAssetPath={manaAssetPath} />)}
      </div>
      <span className="combat-dice-center">
        {combat.phase === "await_roll"
          ? <button className="primary-button roll-dice-button" onClick={onRoll}><Dices size={18} /> Roll Dice</button>
          : combat.phase === "select_player_actions"
            ? (
              <button
                className="primary-button combat-submit-actions"
                disabled={!canSubmit}
                onClick={() => void onSubmit()}
              >
                {submitting ? "Submitting…" : "Submit Actions"}
              </button>
            )
            : <strong>Turn {combat.battle.turn}</strong>}
      </span>
      <div className="combat-dice-side opponent">
        {enemiesHidden
          ? <span className="combat-dice-hidden"><Lock size={15} /> Enemy dice hidden</span>
          : opponentDice.map((unit) => <CombatDie key={unit.key} data={data} unit={unit} rolling={rolling} manaAssetPath={manaAssetPath} opponent />)}
      </div>
    </div>
  );
}

function CombatDie({ data, unit, rolling, manaAssetPath, opponent = false }: { data: AppData; unit: CombatState["playerUnits"][number]; rolling: boolean; manaAssetPath: string | null; opponent?: boolean }) {
  return (
    <span className={`combat-die ${rolling ? "rolling" : "landed"}`}>
      <span className="combat-die-value"><strong>{rolling ? "?" : unit.manaRoll || "–"}</strong><AssetIcon path={manaAssetPath} alt="Mana" fallback={<Gem />} /></span>
      <span className="combat-die-label"><CritterElementLogos data={data} critter={unit.critter} /><small>{opponent ? "Enemy " : ""}{unit.name}</small></span>
    </span>
  );
}

function CombatResultDialog({ data, title, rewards, actionLabel, onAction }: { data: AppData; title: string; rewards: DungeonRewardSummary; actionLabel: string; onAction: () => void }) {
  return (
    <div className="combat-result-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <section className="combat-result-dialog">
        <Sparkles size={28} />
        <p className="eyebrow">Encounter rewards committed</p>
        <h2>{title}</h2>
        <RewardSummary data={data} rewards={rewards} />
        <XpGainSection data={data} rewards={rewards} />
        <button className="primary-button" onClick={onAction}>{actionLabel} <ChevronRight size={16} /></button>
      </section>
    </div>
  );
}

function RewardSummary({ data, rewards }: { data: AppData; rewards: DungeonRewardSummary }) {
  const dropEntries = rewards.entries.filter((entry) => entry.kind !== "critter_xp" && entry.kind !== "rollcaster_xp");
  if (!dropEntries.length) return <p className="dungeon-no-drops">No encounter drops were earned.</p>;
  return (
    <div className="combat-reward-list">
      {dropEntries.map((entry) => {
        const label = entry.kind === "critter_xp"
          ? `${entry.amount} Critter XP`
          : entry.kind === "rollcaster_xp"
            ? `${entry.amount} Rollcaster XP`
            : entry.kind === "currency"
              ? `${entry.amount} ${currencyFor(data, entry.targetId)?.name ?? entry.targetId}`
              : `${entry.amount} ${entry.kind === "shard" ? `${collectibleName(data, entry.targetCategory ?? "relic", entry.targetId)} Shards` : collectibleName(data, "relic", entry.targetId)}`;
        return <span key={entry.id}><RewardEntryIcon data={data} entry={entry} /><strong>{label}</strong>{entry.source === "duplicate_conversion" && <small>Duplicate conversion</small>}</span>;
      })}
    </div>
  );
}

type XpThreshold = {
  level: number;
  total_required_xp: number;
};

function xpStateAtTotal(progression: XpThreshold[], totalXp: number): { level: number; progress: XpProgress } {
  const ordered = [...progression].sort((left, right) => left.level - right.level);
  const level = [...ordered].reverse().find((row) => row.total_required_xp <= totalXp)?.level ?? 1;
  return { level, progress: xpProgress(ordered, level, totalXp) };
}

function XpGainSection({ data, rewards }: { data: AppData; rewards: DungeonRewardSummary }) {
  const equippedCritters = squadCritters(data.player!);
  const ownedRollcaster = data.player!.rollcasters.find((row) => row.id === data.player!.profile.active_rollcaster_id)
    ?? data.player!.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, ownedRollcaster?.rollcaster_id);
  return (
    <section className="combat-xp-section" aria-label="Party experience">
      <div className="combat-xp-heading">
        <span><Sparkles size={17} aria-hidden="true" /></span>
        <h3>Party XP</h3>
      </div>
      <div className="combat-xp-grid">
        {ownedRollcaster && rollcaster && (
          <XpGainCard
            key={ownedRollcaster.id}
            name={rollcaster.name}
            gain={rewards.rollcasterXp}
            finalTotal={ownedRollcaster.xp}
            progression={data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id)}
            sprite={<SpriteFrame size="sm"><Sprite name={rollcaster.name} element="basic" assetPath={catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} fit="portrait" /></SpriteFrame>}
            identity={<strong>{rollcaster.name}</strong>}
            rollcaster
          />
        )}
        {equippedCritters.map((owned) => {
          const critter = byId(data.catalog.critters, owned.critter_id);
          if (!critter) return null;
          const gain = rewards.critterXp[owned.id] ?? 0;
          return (
            <XpGainCard
              key={owned.id}
              name={critter.name}
              gain={gain}
              finalTotal={owned.xp}
              progression={data.catalog.critterProgression.filter((row) => row.critter_id === critter.id)}
              sprite={<SpriteFrame size="sm"><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>}
              identity={<CritterName data={data} critter={critter} />}
            />
          );
        })}
      </div>
    </section>
  );
}

function XpGainCard({
  name,
  gain,
  finalTotal,
  progression,
  sprite,
  identity,
  rollcaster = false,
}: {
  name: string;
  gain: number;
  finalTotal: number;
  progression: XpThreshold[];
  sprite: React.ReactNode;
  identity: React.ReactNode;
  rollcaster?: boolean;
}) {
  const startingTotal = Math.max(0, finalTotal - gain);
  const [displayedTotal, setDisplayedTotal] = useState(startingTotal);

  useEffect(() => {
    setDisplayedTotal(startingTotal);
    if (gain <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayedTotal(finalTotal);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const duration = 1900;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedTotal(Math.round(startingTotal + gain * eased));
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [startingTotal, finalTotal, gain]);

  const state = xpStateAtTotal(progression, displayedTotal);
  const pct = state.progress.isMaxLevel || state.progress.needed <= 0
    ? 100
    : Math.min(100, Math.round((state.progress.current / state.progress.needed) * 100));
  const progressText = state.progress.isMaxLevel
    ? "Max level"
    : `${state.progress.current} / ${state.progress.needed} XP`;

  return (
    <article
      className={`combat-xp-card ${gain > 0 ? "gained" : ""} ${rollcaster ? "rollcaster" : ""}`}
      data-xp-recipient={name}
      data-xp-gain={gain}
    >
      {sprite}
      <div className="combat-xp-card-copy">
        <span className="combat-xp-identity">{identity}<small>Lv {state.level}</small></span>
        <div className="combat-xp-bar xp-bar" role="progressbar" aria-label={`${name} experience`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={progressText}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="combat-xp-values"><small>{progressText}</small><strong>{gain > 0 ? `+${gain} XP` : "No XP gained"}</strong></span>
      </div>
    </article>
  );
}

function RewardEntryIcon({ data, entry }: { data: AppData; entry: DungeonRewardSummary["entries"][number] }) {
  if (entry.kind === "currency") {
    const currency = currencyFor(data, entry.targetId);
    return <AssetIcon path={catalogAssetPath(data, "currency", currency?.id, currency?.asset_path, "icon")} alt="" fallback={<Coins size={15} />} />;
  }
  if (entry.kind === "critter_xp") return <Sparkles size={15} />;
  if (entry.kind === "rollcaster_xp") return <UserRound size={15} />;
  return <CollectibleSprite
    data={data}
    type={entry.targetCategory ?? "relic"}
    id={entry.targetId}
    size="xs"
    shard={entry.kind === "shard"}
  />;
}

function DungeonOutcomeScreen({ data, combat, complete, onHome, onReplay, onNextDungeon }: { data: AppData; combat: DungeonRunState; complete: boolean; onHome: () => void; onReplay: () => void; onNextDungeon: (id: string) => void }) {
  return (
    <section className={`combat-screen dungeon-outcome-screen ${complete ? "victory" : "failure"}`}>
      <div className="dungeon-outcome-emblem">{complete ? <Sparkles size={42} /> : <Skull size={42} />}</div>
      <p className="eyebrow">{complete ? "Dungeon complete" : "Expedition failed"}</p>
      <h1>{complete ? `${combat.dungeon.name} cleared!` : "Your squad has fallen."}</h1>
      <p>{complete ? `All ${combat.run.battleCount} encounters are complete. Rewards below are already saved.` : "Rewards from defeated opponents are saved. Retrying starts a fresh run at full HP."}</p>
      <div className="dungeon-outcome-rewards">
        {combat.lastBattleRewards && <section><h2>Final Encounter</h2><RewardSummary data={data} rewards={combat.lastBattleRewards} /></section>}
        {combat.dungeonRewards && <section><h2>{combat.dungeonRewards.completionPhase === "first_time" ? "First-clear Rewards" : "Completion Rewards"}</h2><RewardSummary data={data} rewards={combat.dungeonRewards} /></section>}
      </div>
      {combat.lastBattleRewards && <XpGainSection data={data} rewards={combat.lastBattleRewards} />}
      <div className="dungeon-outcome-actions">
        <button className="secondary-button" onClick={onHome}>Back to Home</button>
        <button className="primary-button" onClick={onReplay}><RefreshCw size={16} /> {complete ? "Replay Dungeon" : "Retry Dungeon"}</button>
        {complete && combat.nextDungeonId && <button className="primary-button next-dungeon-button" onClick={() => onNextDungeon(combat.nextDungeonId!)}>Next Dungeon <ChevronRight size={16} /></button>}
      </div>
    </section>
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

function BannerNotificationView({ data, notification }: { data: AppData; notification: BannerNotification }) {
  if (notification.kind === "collectible-unlock") {
    const event = notification.event;
    const name = collectibleName(data, event.collectible_type, event.collectible_id);
    const critter = event.collectible_type === "critter"
      ? byId(data.catalog.critters, event.collectible_id)
      : undefined;
    return (
      <aside className="unlock-notification" role="status" aria-live="polite" aria-atomic="true">
        <CollectibleSprite data={data} type={event.collectible_type} id={event.collectible_id} size="xs" />
        <div className="unlock-notification-copy">
          <span className="unlock-notification-label"><Sparkles size={14} aria-hidden="true" /> Collectible unlocked</span>
          <h2>{critter ? <><CritterName data={data} critter={critter} /> <span>unlocked!</span></> : `${name} unlocked!`}</h2>
        </div>
      </aside>
    );
  }

  if (notification.kind === "shop-reward") {
    const name = collectibleName(data, notification.targetCategory, notification.targetId);
    const rewardName = notification.shard ? `${name} Shards` : name;
    return (
      <aside className="unlock-notification reward-notification" role="status" aria-live="polite" aria-atomic="true">
        <CollectibleSprite data={data} type={notification.targetCategory} id={notification.targetId} size="xs" />
        <div className="unlock-notification-copy">
          <span className="unlock-notification-label"><ShoppingBag size={14} aria-hidden="true" /> Shop reward</span>
          <h2>×{formatAmount(notification.granted)} {rewardName} added</h2>
          {notification.discarded !== "0" && (
            <p className="unlock-notification-detail">×{formatAmount(notification.discarded)} overflow discarded</p>
          )}
        </div>
      </aside>
    );
  }

  const rewardCount = notification.redemption.rewards.length;
  return (
    <aside className="unlock-notification reward-notification" role="status" aria-live="polite" aria-atomic="true">
      <span className="notification-banner-icon" aria-hidden="true"><Gift size={25} /></span>
      <div className="unlock-notification-copy">
        <span className="unlock-notification-label"><Ticket size={14} aria-hidden="true" /> Promo code {notification.redemption.code}</span>
        <h2>{rewardCount} {rewardCount === 1 ? "reward" : "rewards"} added!</h2>
        {notification.redemption.playerUses !== null && (
          <p className="unlock-notification-detail">{promoClaimUsageLabel(notification.redemption)}</p>
        )}
      </div>
    </aside>
  );
}

function Modal({
  eyebrow = "Loadout & collection",
  title,
  description = "Item details",
  children,
  onClose,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
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
          <div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2><p id={`${titleId}-description`}>{description}</p></div>
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
          decoding="async"
          loading={size === "hero" ? "eager" : "lazy"}
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
          decoding="async"
          loading="lazy"
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
  const path = directPath ?? (ownerId ? findAssetRecord(data, category, ownerId, variant)?.path : null);
  return versionedAssetPath(data, path);
}

function findAssetPath(data: AppData, category: string, ownerId: string, variant = "icon"): string | null {
  return versionedAssetPath(data, findAssetRecord(data, category, ownerId, variant)?.path ?? null);
}

function findAssetRecord(data: AppData, category: string, ownerId: string, variant: string) {
  return data.catalog.gameAssets.find(
    (asset) =>
      asset.category === category &&
      asset.owner_id === ownerId &&
      asset.variant === variant &&
      asset.is_active,
  );
}

function versionedAssetPath(data: AppData, path: string | null | undefined): string | null {
  if (!path || /^https?:\/\//i.test(path)) return path ?? null;
  const [objectPath] = path.split("?", 1);
  const asset = data.catalog.gameAssets.find((candidate) => candidate.path === objectPath && candidate.is_active);
  const version = asset?.checksum || asset?.updated_at;
  if (!version) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(version)}`;
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
