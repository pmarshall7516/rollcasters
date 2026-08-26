import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Coins,
  CircleHelp,
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
  acquireGameplaySession,
  desktopProfile,
  ensureUserGameState,
  getActiveDungeonRunWithTimeout,
  getGameAssetUrl,
  getGameUpdateStatus,
  getSnapshotGameAssetUrl,
  getPromoCodeRedemptionHistory,
  getSession,
  flushPlayerMutations,
  flushPlayerMutationsWithTimeout,
  heartbeatGameplaySession,
  hasSupabaseConfig,
  currentGameVersion,
  loadAppData,
  openLootbox,
  purchaseShopEntry,
  recordDungeonBattleResult,
  redeemPromoCode,
  resolveDungeonRunWithTimeout,
  releaseGameplaySession,
  setActiveRollcaster,
  setCritterRelicSlot,
  setCritterSkillSlot,
  setRollcasterAbilitySlot,
  setSquadSlot,
  selectStarterCritter,
  selectStarterRollcaster,
  saveDungeonRunStateWithTimeout,
  signIn,
  signOut,
  signUp,
  snapshotDungeonRunEffectsWithRecovery,
  startDungeonRunWithRecovery,
  submitCollectibleCombatEvents,
  supabase,
  syncLocalServerCompatibility,
  trackCollectibleChallenge,
  untrackCollectibleChallenge,
  unlockCritterSkill,
  unlockRollcasterAbility,
  type GameplaySessionResult,
} from "./lib/supabase";
import {
  byId,
  calculateActionCostBreakdown,
  combatEffectSummaries,
  critterElementIds,
  critterStats,
  isActorRecharging,
  isSingleTarget,
  healthyFriendlySwapTargets,
  matchesSelectedElements,
  orderedActiveCombatUnits,
  skillAvailability,
  skillHasPostAttackSwap,
  skillTargets,
  squadCritters,
  type ActionCostBreakdown,
  type CombatState,
  type RunEffectSnapshot,
} from "./lib/game";
import { effectMatchesSourceCritter, sourceElementIds } from "./lib/effects";
import {
  advanceDungeonEvent,
  applyDungeonBattleResult,
  confirmDungeonLeads,
  continueAfterEncounterRewards,
  continueDungeonDialogue,
  continueAfterRoll,
  createDungeonRunState,
  currentDungeonEvent,
  currentDungeonDialogue,
  dungeonBattleSubmission,
  revealDungeonSwapEvent,
  restoreDungeonRunState,
  serializeDungeonRunState,
  rollDungeonDice,
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
import { calculateLoadoutStats, equippedRelicIdsForCritter, nextOpenSquadSlot, type LoadoutStatKey, type StatBreakdown } from "./lib/loadout";
import { applyDungeonXpRewards, relicSlotUnlocks, xpProgress, type XpProgress } from "./lib/progression";
import { aggregateDungeonRewardEntries, combineDungeonRewards } from "./lib/dungeon-rewards";
import { createRequestId } from "./lib/uuid";
import { loadSeenChallengeCompletions, rememberSeenChallengeCompletion, type NotificationStorage } from "./lib/notifications";
import { combatLoadingNarration, combatSwapTravelOffset } from "./lib/presentation";
import { updateOpponentRevealState } from "./lib/combat-visibility";
import {
  challengeDescription,
  completedTrackedChallengeIds,
  challengesFor,
  collectibleAssetPath,
  collectibleIsUnlocked,
  collectibleName,
  collectibleTargetAvailable,
  currencyBalance,
  currencyFor,
  formatAmount,
  isTrackableChallenge,
  orderedCurrencies,
  progressFor,
  requirementFor,
  safeBigInt,
  shardProgress,
  shopAvailability,
  shopPurchaseQuantityLimit,
  shopErrorMessage,
  sortByCollectibleId,
  trackedChallengesForDisplay,
  trackedSlotFor,
} from "./lib/collectibles";
import {
  applyShopPurchaseReceipt,
  partialShopPurchaseReceipt,
  shopPurchaseItemQuantity,
  shopPurchasePrice,
} from "./lib/shop";
import {
  promoCodeErrorMessage,
  promoRewardOutcomeLabel,
  promoRewardTypeLabel,
} from "./lib/promo-codes";
import type {
  AppData,
  ActiveDungeonRun,
  CombatAction,
  CollectibleUnlockEvent,
  CurrencyDef,
  CollectibleType,
  CollectibleUnlockChallenge,
  Critter,
  Dungeon,
  DungeonDrop,
  DungeonRewardSummary,
  Lootbox,
  LootboxOpeningReceipt,
  LootboxPoolEntry,
  PlayerState,
  PromoCodeRedemption,
  PromoCodeReward,
  Relic,
  ResolvedEffectRef,
  Rollcaster,
  RollcasterAbility,
  Skill,
  ShopEntry,
  ShopPurchaseReceipt,
  UserCritter,
  UserRollcaster,
  View,
} from "./lib/types";
import rollcastersLogoUrl from "./assets/rollcasters-logo.webp";
import { checkForDesktopUpdate, isTauriDesktop, resolveDesktopUpdateGate, type DesktopUpdate } from "./lib/desktop-updater";
import { downloadDiagnosticReport } from "./lib/diagnostics";

type CollectionTab = "rollcasters" | "critters" | "relics";
type BagTab = "currency" | "shards" | "lootboxes";
type ShopTab = "shard" | "relic" | "lootbox" | "promo";
const SHOP_PURCHASE_LEDGER_PREFIX = "rollcasters:shop-purchases:";

function clearLegacyShopPurchaseLedger(userId: string) {
  try {
    window.localStorage.removeItem(`${SHOP_PURCHASE_LEDGER_PREFIX}${userId}`);
  } catch {
    // A blocked storage API cannot contain a readable legacy Shop ledger.
  }
}
type CollectionDetail = { type: "critter" | "rollcaster" | "relic"; id: string };
type DungeonEntryState = {
  dungeon: Dungeon;
  phase: "starting" | "recovering" | "confirming";
  attempt: number;
  maxAttempts: number;
  requestId: string;
  runId?: string;
};
type DungeonExitDestination = "play" | "home";
type ActiveDungeonPrompt = {
  active: ActiveDungeonRun;
  dungeon: Dungeon;
};
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
      kind: "challenge-completed";
      challengeId: string;
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
    }
  | {
      id: string;
      kind: "shop-error";
      message: string;
    };

const BANNER_NOTIFICATION_DURATION_MS = 5_000;

function createShopErrorNotification(error: unknown): BannerNotification {
  return {
    id: `shop-error:${createRequestId()}`,
    kind: "shop-error",
    message: shopErrorMessage(error),
  };
}

function routeFromLocation(): { view: View; shopTab: ShopTab } {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const shopTab: ShopTab = requestedTab === "relic" || requestedTab === "lootbox" || requestedTab === "promo"
    ? requestedTab
    : "shard";
  if (window.location.pathname === "/shop") return { view: "shop", shopTab };
  if (window.location.pathname === "/collection") return { view: "collection", shopTab };
  if (window.location.pathname === "/bag") return { view: "bag", shopTab };
  if (window.location.pathname === "/play") return { view: "play", shopTab };
  return { view: "home", shopTab };
}

function viewUrl(view: View, shopTab: ShopTab): string {
  if (view === "shop") return `/shop?tab=${shopTab}`;
  if (view === "collection") return "/collection";
  if (view === "bag") return "/bag";
  if (view === "play") return "/play";
  return "/";
}

function requiredStarterView(player: PlayerState | null | undefined): View | null {
  if (!player?.profile.starter_rollcaster_selected_at) return "starter-rollcaster";
  if (!player.profile.starter_selected_at) return "starter";
  return null;
}

export function App() {
  const [desktopGate, setDesktopGate] = useState<"checking" | "ready" | "required" | "error">(() => isTauriDesktop() ? "checking" : "ready");
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdate | null>(null);
  const [desktopGateError, setDesktopGateError] = useState<string | null>(null);
  const [lootboxOperationActive, setLootboxOperationActive] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [sessionConflict, setSessionConflict] = useState<GameplaySessionResult | null>(null);
  const [accountMoved, setAccountMoved] = useState(false);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [view, setView] = useState<View>("auth");
  const [data, setData] = useState<AppData | null>(null);
  const shopPurchaseRevisionRef = useRef(0);
  const shopPurchaseRequestIdsRef = useRef(new Map<string, string>());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("critters");
  const [bagTab, setBagTab] = useState<BagTab>("currency");
  const [shopTab, setShopTab] = useState<ShopTab>(() => routeFromLocation().shopTab);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [combat, setCombat] = useState<DungeonRunState | null>(null);
  const [dungeonEntry, setDungeonEntry] = useState<DungeonEntryState | null>(null);
  const [activeDungeonPrompt, setActiveDungeonPrompt] = useState<ActiveDungeonPrompt | null>(null);
  const [activeDungeonPromptBusy, setActiveDungeonPromptBusy] = useState<"continue" | "abandon" | null>(null);
  const [dungeonExitPrompt, setDungeonExitPrompt] = useState<DungeonExitDestination | null>(null);
  const [dungeonExitPromptBusy, setDungeonExitPromptBusy] = useState(false);
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
  const seenChallengeCompletions = useRef(new Set<string>());
  const seenChallengeCompletionUserId = useRef<string | null>(null);
  const combatRef = useRef<DungeonRunState | null>(null);
  const appKeyboardRootRef = useRef<HTMLDivElement>(null);
  const appKeyboardFocusRef = useRef<HTMLElement | null>(null);
  const appKeyboardFocusProxyRef = useRef<HTMLElement | null>(null);
  const appInvalidFocusTimerRef = useRef<number | null>(null);
  const combatProgressQueue = useRef<Promise<void>>(Promise.resolve());
  const combatSaveTimerRef = useRef<number | null>(null);
  const combatSavePromiseRef = useRef<Promise<void> | null>(null);
  const combatSavePendingRef = useRef(false);
  const combatSaveDisabledRef = useRef(false);
  const combatSaveSignatureRef = useRef<string | null>(null);
  const dungeonAbandonRequestRef = useRef<string | null>(null);
  const flushCombatSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const clearedLegacyShopLedgerUserRef = useRef<string | null>(null);
  const dungeonEntryRequestRef = useRef<string | null>(null);
  const closeRequestedRef = useRef(false);
  const sessionStoppingRef = useRef(false);

  function startBestEffortShutdownCleanup(): void {
    // Closing the desktop window is the higher-priority operation. These
    // network-backed cleanup calls must never hold either close path open.
    void releaseGameplaySession().catch(() => undefined);
    void flushCombatSaveRef.current().catch((saveError) => {
      console.warn("Unable to flush the current Dungeon state before closing.", saveError);
    });
  }

  async function closeRollcasters(): Promise<void> {
    sessionStoppingRef.current = true;
    closeRequestedRef.current = true;
    startBestEffortShutdownCleanup();
    if (isTauriDesktop()) {
      await getCurrentWindow().destroy();
      return;
    }
    window.close();
  }

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(async (event) => {
        if (closeRequestedRef.current) return;
        closeRequestedRef.current = true;
        sessionStoppingRef.current = true;
        event.preventDefault();
        startBestEffortShutdownCleanup();
        await getCurrentWindow().destroy();
      }))
      .then((removeListener) => {
        if (disposed) removeListener();
        else unlisten = removeListener;
      })
      .catch((closeListenerError) => {
        console.error("Unable to register the desktop close handler.", closeListenerError);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    if (desktopProfile.profile === "local") {
      setDesktopGate("ready");
      return;
    }
    let active = true;
    Promise.all([checkForDesktopUpdate(), getGameUpdateStatus()])
      .then(([update, status]) => {
        if (!active) return;
        const decision = resolveDesktopUpdateGate(status, currentGameVersion, update);
        if (decision.kind === "maintenance" || decision.kind === "error") {
          setDesktopGateError(decision.message);
          setDesktopGate("error");
          return;
        }
        setDesktopUpdate(decision.kind === "required" ? decision.update : null);
        setDesktopGate(decision.kind === "required" ? "required" : "ready");
      })
      .catch((updateError) => {
        if (!active) return;
        console.error("Desktop startup update check failed.", updateError);
        setDesktopGateError("Rollcasters could not securely verify the required Game Update. Check your connection and try again.");
        setDesktopGate("error");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onLootboxBoundary = (event: Event) => {
      const phase = (event as CustomEvent<string>).detail;
      setLootboxOperationActive(phase !== "idle" && phase !== "closed");
    };
    window.addEventListener("rollcasters:lootbox-phase", onLootboxBoundary);
    return () => window.removeEventListener("rollcasters:lootbox-phase", onLootboxBoundary);
  }, []);

  useEffect(() => {
    if (!isTauriDesktop() || desktopGate !== "ready") return;
    let active = true;
    const check = async () => {
      try {
        const [update, status] = await Promise.all([checkForDesktopUpdate(), getGameUpdateStatus()]);
        if (!active) return;
        const decision = resolveDesktopUpdateGate(status, currentGameVersion, update);
        if (decision.kind === "maintenance") {
          setDesktopGateError(decision.message);
          setDesktopGate("error");
          return;
        }
        if (decision.kind === "error") throw new Error(decision.message);
        if (decision.kind !== "required") return;
        setDesktopUpdate(decision.update);
        if (!combatRef.current && !dungeonEntryRequestRef.current && !lootboxOperationActive) setDesktopGate("required");
      } catch (updateError) {
        // A failed periodic check does not invalidate a session that already
        // passed the fail-closed startup gate. Retry on the next interval.
        console.error("Desktop periodic update check failed.", updateError);
      }
    };
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [desktopGate, lootboxOperationActive]);

  useEffect(() => {
    if (desktopGate === "ready" && desktopUpdate && !combat && !lootboxOperationActive) {
      setDesktopGate("required");
    }
  }, [combat, desktopGate, desktopUpdate, lootboxOperationActive]);

  useEffect(() => {
    const userId = data?.player?.profile.user_id;
    if (!userId || clearedLegacyShopLedgerUserRef.current === userId) return;
    clearLegacyShopPurchaseLedger(userId);
    clearedLegacyShopLedgerUserRef.current = userId;
  }, [data?.player?.profile.user_id]);

  async function purchaseShopItem(entry: ShopEntry, quantity: number): Promise<ShopPurchaseReceipt> {
    if (desktopUpdate) throw new Error("A required Game Update is ready. Finish the current safe-boundary operation and update before making another purchase.");
    await flushPlayerMutations();
    const intentKey = `${entry.id}:${quantity}`;
    const requestId = shopPurchaseRequestIdsRef.current.get(intentKey) ?? createRequestId();
    shopPurchaseRequestIdsRef.current.set(intentKey, requestId);
    let receipt: ShopPurchaseReceipt;
    try {
      receipt = await purchaseShopEntry(entry.id, requestId, quantity);
    } catch (purchaseError) {
      // An ambiguous command keeps its request ID so a later click can recover
      // the same receipt instead of creating a second economic command.
      if (!errorMessage(purchaseError, "").includes("SHOP_PURCHASE_PENDING")) {
        shopPurchaseRequestIdsRef.current.delete(intentKey);
      }
      throw purchaseError;
    }
    shopPurchaseRequestIdsRef.current.delete(intentKey);
    shopPurchaseRevisionRef.current += 1;
    setData((current) => current ? applyShopPurchaseReceipt(current, entry, receipt) : current);
    if (receipt.shop_type !== "lootbox" && receipt.target_category !== "lootbox") {
      enqueueNotification({
        id: `shop:${receipt.request_id}`,
        kind: "shop-reward",
        targetCategory: receipt.target_category,
        targetId: receipt.target_id,
        shard: receipt.shop_type === "shard",
        granted: receipt.granted,
        discarded: receipt.discarded,
      });
    }
    void refresh(undefined, { showLoading: false }).catch((refreshFailure) => {
      console.error("Shop purchase succeeded but refresh failed.", refreshFailure);
    });
    return receipt;
  }

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

  function localNotificationStorage(): NotificationStorage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function commitLoadedData(loaded: AppData) {
    const previous = data;
    const userId = loaded.player?.profile.user_id;
    const storage = localNotificationStorage();
    const previousForNotifications = previous?.player?.profile.user_id === userId ? previous : null;
    if (userId && seenChallengeCompletionUserId.current !== userId) {
      seenChallengeCompletionUserId.current = userId;
      seenChallengeCompletions.current = storage
        ? loadSeenChallengeCompletions(storage, userId)
        : new Set();
    }
    completedTrackedChallengeIds(previousForNotifications, loaded).forEach((challengeId) => {
      if (seenChallengeCompletions.current.has(challengeId)) return;
      const challenge = loaded.catalog.collectibleUnlockChallenges.find((row) => row.id === challengeId);
      if (!challenge) return;
      if (userId && storage) rememberSeenChallengeCompletion(storage, userId, seenChallengeCompletions.current, challengeId);
      else seenChallengeCompletions.current.add(challengeId);
      enqueueNotification({
        id: `challenge-completed:${challengeId}`,
        kind: "challenge-completed",
        challengeId,
      });
    });
    setData(loaded);
  }

  function navigate(nextView: View, nextShopTab = shopTab, replace = false) {
    if (nextView !== "combat") setError(null);
    if (nextView === "shop") setShopTab(nextShopTab);
    setView(nextView);
    if (["home", "collection", "bag", "shop", "play"].includes(nextView)) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", viewUrl(nextView, nextShopTab));
    }
  }

  function showActiveDungeonPrompt(active: ActiveDungeonRun | null, dungeons: Dungeon[]): boolean {
    if (!active) {
      setActiveDungeonPrompt(null);
      return false;
    }
    const dungeon = dungeons.find((candidate) => candidate.id === active.run.dungeonId);
    if (!dungeon) {
      setActiveDungeonPrompt(null);
      return false;
    }
    setActiveDungeonPrompt({ active, dungeon });
    return true;
  }

  function cancelCombatSave() {
    combatSaveDisabledRef.current = true;
    combatSavePendingRef.current = false;
    if (combatSaveTimerRef.current !== null) {
      window.clearTimeout(combatSaveTimerRef.current);
      combatSaveTimerRef.current = null;
    }
  }

  async function drainCombatSave(): Promise<void> {
    if (combatSaveDisabledRef.current) return;
    if (combatSavePromiseRef.current) {
      await combatSavePromiseRef.current;
      if (combatSavePendingRef.current) await drainCombatSave();
      return;
    }
    if (combatSaveTimerRef.current !== null) {
      window.clearTimeout(combatSaveTimerRef.current);
      combatSaveTimerRef.current = null;
    }
    const latest = combatRef.current;
    if (!latest || latest.run.status !== "started") {
      combatSavePendingRef.current = false;
      return;
    }
    combatSavePendingRef.current = false;
    const serialized = serializeDungeonRunState(latest);
    const signature = JSON.stringify(serialized);
    const savePromise = (async () => {
      try {
        const saved = await saveDungeonRunStateWithTimeout(latest.run, serialized);
        setCombat((current) => {
          if (!current || current.run.id !== saved.run.id || current.run.version > saved.run.version) return current;
          return { ...current, run: saved.run };
        });
        combatSaveSignatureRef.current = signature;
      } catch (saveError) {
        // A transient save failure must not interrupt combat. The next combat
        // state change, or the desktop close flush, will retry the latest state.
        combatSaveSignatureRef.current = null;
        console.warn("Unable to persist the current Dungeon state.", saveError);
        window.setTimeout(() => {
          if (!combatSaveDisabledRef.current) void drainCombatSave();
        }, 1_000);
      }
    })();
    combatSavePromiseRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      combatSavePromiseRef.current = null;
    }
    if (combatSavePendingRef.current) await drainCombatSave();
  }

  function scheduleCombatSave() {
    combatSavePendingRef.current = true;
    if (combatSaveDisabledRef.current || combatSaveTimerRef.current !== null || combatSavePromiseRef.current) return;
    combatSaveTimerRef.current = window.setTimeout(() => {
      combatSaveTimerRef.current = null;
      void drainCombatSave();
    }, 350);
  }

  function requestDungeonExit(destination: DungeonExitDestination) {
    const activeRun = combat?.run.status === "started" || Boolean(dungeonEntry);
    if (!activeRun) {
      setCombat(null);
      setDungeonEntry(null);
      navigate(destination);
      return;
    }
    setDungeonExitPrompt(destination);
  }

  async function confirmDungeonExit() {
    const destination = dungeonExitPrompt;
    if (!destination || dungeonExitPromptBusy) return;
    setDungeonExitPromptBusy(true);
    setError(null);
    cancelCombatSave();
    const entryRequestId = dungeonEntry?.requestId ?? dungeonEntryRequestRef.current;
    if (entryRequestId) dungeonAbandonRequestRef.current = entryRequestId;
    try {
      let runId = combat?.run.id ?? dungeonEntry?.runId;
      if (!runId) {
        const active = await getActiveDungeonRunWithTimeout();
        runId = active?.run.id;
      }
      if (runId) await resolveDungeonRunWithTimeout(runId);
      setDungeonExitPrompt(null);
      setActiveDungeonPrompt(null);
      setCombat(null);
      setDungeonEntry(null);
      navigate(destination);
    } catch (exitError) {
      console.error("Unable to abandon the current Dungeon run.", exitError);
      combatSaveDisabledRef.current = false;
      if (combat) scheduleCombatSave();
      setError(errorMessage(exitError, "Unable to abandon the current Dungeon run."));
    } finally {
      setDungeonExitPromptBusy(false);
    }
  }

  flushCombatSaveRef.current = drainCombatSave;

  function appKeyboardScope(): HTMLElement | null {
    const root = appKeyboardRootRef.current;
    if (!root) return null;
    return root.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']") ?? root;
  }

  function appKeyboardControls(scope: HTMLElement): HTMLElement[] {
    const selectors = "button, input, select, textarea, summary, [role='button'], [role='tab'], [role='option'], [tabindex]:not([tabindex='-1'])";
    return [...new Set([...scope.querySelectorAll<HTMLElement>(selectors)])]
      .filter((control) => control.getClientRects().length > 0)
      .filter((control) => !control.closest("[aria-hidden='true']"));
  }

  function clearAppKeyboardFocusVisual() {
    const previous = appKeyboardFocusRef.current;
    previous?.classList.remove("app-keyboard-focused");
    previous?.closest<HTMLElement>(".tooltip-anchor")?.classList.remove("app-keyboard-focused");
    appKeyboardFocusProxyRef.current?.classList.remove("app-keyboard-focus-proxy");
    appKeyboardFocusProxyRef.current = null;
  }

  function dismissAppKeyboardFocus() {
    const root = appKeyboardRootRef.current;
    const active = document.activeElement;
    const shouldBlur = active instanceof HTMLElement
      && root?.contains(active)
      && Boolean(appKeyboardFocusRef.current);
    clearAppKeyboardFocusVisual();
    appKeyboardFocusRef.current = null;
    if (shouldBlur) active.blur();
  }

  function setAppKeyboardFocus(control: HTMLElement) {
    clearAppKeyboardFocusVisual();
    appKeyboardFocusRef.current = control;
    control.classList.add("app-keyboard-focused");
    control.closest<HTMLElement>(".tooltip-anchor")?.classList.add("app-keyboard-focused");
    if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") {
      const proxy = control.closest<HTMLElement>(".tooltip-anchor") ?? control.parentElement;
      if (proxy && proxy !== control) {
        proxy.tabIndex = -1;
        proxy.classList.add("app-keyboard-focus-proxy");
        appKeyboardFocusProxyRef.current = proxy;
        proxy.focus();
      }
    } else {
      control.focus();
    }
    control.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function focusFirstAppKeyboardControl() {
    const scope = appKeyboardScope();
    const controls = scope ? appKeyboardControls(scope) : [];
    const first = scope?.matches("[role='dialog'][aria-modal='true']")
      ? controls.find((control) => !control.matches("button[aria-label='Close']") && !["INPUT", "TEXTAREA", "SELECT"].includes(control.tagName)) ?? controls[0]
      : controls[0];
    if (first) setAppKeyboardFocus(first);
    return first;
  }

  function moveAppKeyboardFocus(direction: "up" | "down" | "left" | "right") {
    const scope = appKeyboardScope();
    if (!scope) return;
    const controls = appKeyboardControls(scope);
    if (!controls.length) return;
    const focused = appKeyboardFocusRef.current;
    const active = focused && scope.contains(focused) && controls.includes(focused) ? focused : null;
    if (!active) {
      focusFirstAppKeyboardControl();
      return;
    }
    const source = active.getBoundingClientRect();
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    const candidates = controls
      .filter((control) => control !== active)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dx = x - sourceX;
        const dy = y - sourceY;
        const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
        const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        const isForward = direction === "right" ? dx > 2
          : direction === "left" ? dx < -2
            : direction === "down" ? dy > 2
              : dy < -2;
        return { control, primary, cross, distance: Math.hypot(dx, dy), isForward };
      })
      .filter((candidate) => candidate.isForward)
      .sort((left, right) => left.cross - right.cross || left.primary - right.primary || left.distance - right.distance);
    setAppKeyboardFocus(candidates[0]?.control ?? active);
  }

  function flashInvalidAppKeyboardControl(control: HTMLElement) {
    if (appInvalidFocusTimerRef.current !== null) window.clearTimeout(appInvalidFocusTimerRef.current);
    control.classList.remove("app-keyboard-invalid");
    void control.offsetWidth;
    control.classList.add("app-keyboard-invalid");
    appInvalidFocusTimerRef.current = window.setTimeout(() => {
      control.classList.remove("app-keyboard-invalid");
      appInvalidFocusTimerRef.current = null;
    }, 360);
  }

  function activateAppKeyboardControl(control: HTMLElement) {
    if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") {
      flashInvalidAppKeyboardControl(control);
      return;
    }
    control.click();
  }

  useEffect(() => {
    function handleMouseMove() {
      if (appKeyboardFocusRef.current) dismissAppKeyboardFocus();
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    function handleAppKeyboard(event: KeyboardEvent) {
      if (view === "combat") return;
      const root = appKeyboardRootRef.current;
      if (!root) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      const active = document.activeElement;
      const scope = appKeyboardScope();
      const focusInsideApp = (active instanceof HTMLElement && root.contains(active)) || Boolean(appKeyboardFocusRef.current && root.contains(appKeyboardFocusRef.current));
      if (!focusInsideApp && active !== document.body) return;

      if (event.code === "ShiftLeft") {
        if (event.repeat) return;
        event.preventDefault();
        const dialog = root.querySelector<HTMLElement>("[role='dialog'][aria-modal='true']");
        const close = dialog?.querySelector<HTMLButtonElement>("button[aria-label='Close']");
        if (close) {
          close.click();
          return;
        }
        const openDetails = root.querySelector<HTMLDetailsElement>("details[open]");
        if (openDetails) {
          openDetails.removeAttribute("open");
          return;
        }
        if (["collection", "bag", "shop", "play"].includes(view)) navigate("home");
        return;
      }

      const direction = event.code === "ArrowUp" || event.code === "KeyW" ? "up"
        : event.code === "ArrowDown" || event.code === "KeyS" ? "down"
          : event.code === "ArrowLeft" || event.code === "KeyA" ? "left"
            : event.code === "ArrowRight" || event.code === "KeyD" ? "right"
              : null;
      if (direction) {
        event.preventDefault();
        moveAppKeyboardFocus(direction);
        return;
      }

      if (event.code !== "Space" || event.repeat) return;
      if (target?.closest("button, summary, [role='button'], [role='tab'], [role='option']")) return;
      const control = appKeyboardFocusRef.current && scope?.contains(appKeyboardFocusRef.current)
        ? appKeyboardFocusRef.current
        : focusFirstAppKeyboardControl();
      if (!control) return;
      event.preventDefault();
      activateAppKeyboardControl(control);
    }
    window.addEventListener("keydown", handleAppKeyboard);
    return () => window.removeEventListener("keydown", handleAppKeyboard);
  }, [view]);

  async function refresh(nextView?: View, options: { showLoading?: boolean } = {}) {
    if (!hasSupabaseConfig) return;
    const showLoading = options.showLoading ?? true;
    if (showLoading) setLoading(true);
    setError(null);
    const shopPurchaseRevisionAtStart = shopPurchaseRevisionRef.current;
    try {
      await ensureUserGameState();
      const loaded = await loadAppData();
      if (shopPurchaseRevisionAtStart !== shopPurchaseRevisionRef.current) return;
      commitLoadedData(loaded);
      const requiredView = requiredStarterView(loaded.player);
      if (requiredView) {
        setView(requiredView);
      } else if (nextView) {
        setView(nextView);
      } else {
        const route = routeFromLocation();
        setShopTab(route.shopTab);
        if (route.view === "play") {
          const active = await getActiveDungeonRunWithTimeout();
          showActiveDungeonPrompt(active, loaded.catalog.dungeons);
        }
        setView(route.view);
      }
    } catch (err) {
      console.error("Unable to load game data.", err);
      setError(errorMessage(err, "Unable to load game data."));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function openPlay(): Promise<void> {
    if (dungeonEntryRequestRef.current) return;
    navigate("play");
    try {
      const active = await getActiveDungeonRunWithTimeout();
      showActiveDungeonPrompt(active, data?.catalog.dungeons ?? []);
    } catch (err) {
      setError(dungeonEntryErrorMessage(err));
    }
  }

  async function continueActiveDungeon(): Promise<void> {
    const prompt = activeDungeonPrompt;
    if (!prompt || activeDungeonPromptBusy) return;
    if (!data?.player) return;
    setActiveDungeonPromptBusy("continue");
    setError(null);
    const requestId = createRequestId();
    dungeonEntryRequestRef.current = requestId;
    combatSaveDisabledRef.current = false;
    combatSaveSignatureRef.current = null;
    try {
      const dungeon = data.catalog.dungeons.find((candidate) => candidate.id === prompt.active.run.dungeonId) ?? prompt.dungeon;
      setActiveDungeonPrompt(null);
      setDungeonEntry({ dungeon, phase: "recovering", attempt: 1, maxAttempts: 1, requestId });
      setCombat(null);
      setView("combat");
      const persisted = restoreDungeonRunState(prompt.active.combatState, data.catalog, prompt.active.run);
      const resumed = persisted
        ?? createDungeonRunState(data.catalog, data.player, dungeon, prompt.active.run);
      const authoritative = applyAuthoritativeDungeonEffectSnapshot(resumed, prompt.active.effectSnapshot);
      if (dungeonEntryRequestRef.current !== requestId) return;
      setCombat(authoritative);
      setDungeonEntry(null);
    } catch (err) {
      console.error("Unable to continue Dungeon run.", { runId: prompt.active.run.id, error: err });
      setActiveDungeonPrompt(null);
      setCombat(null);
      setDungeonEntry(null);
      setError(dungeonEntryErrorMessage(err));
      setView("play");
    } finally {
      if (dungeonEntryRequestRef.current === requestId) dungeonEntryRequestRef.current = null;
      setActiveDungeonPromptBusy(null);
    }
  }

  async function abandonActiveDungeon(): Promise<void> {
    const prompt = activeDungeonPrompt;
    if (!prompt || activeDungeonPromptBusy) return;
    setActiveDungeonPromptBusy("abandon");
    setError(null);
    try {
      await resolveDungeonRunWithTimeout(prompt.active.run.id);
      setActiveDungeonPrompt(null);
      setCombat(null);
      setDungeonEntry(null);
      navigate("play");
    } catch (err) {
      console.error("Unable to abandon Dungeon run.", { runId: prompt.active.run.id, error: err });
      setError(errorMessage(err, "Unable to abandon the Dungeon run."));
    } finally {
      setActiveDungeonPromptBusy(null);
    }
  }

  async function beginDungeon(dungeon: Dungeon) {
    if (!data?.player) return;
    if (desktopUpdate) {
      setError("A required Game Update is ready. Update before starting another Dungeon.");
      return;
    }
    if (dungeonEntryRequestRef.current) return;
    const requestId = createRequestId();
    dungeonEntryRequestRef.current = requestId;
    combatSaveDisabledRef.current = false;
    combatSaveSignatureRef.current = null;
    setDungeonEntry({ dungeon, phase: "starting", attempt: 1, maxAttempts: 3, requestId });
    setCombat(null);
    setView("combat");
    setError(null);
    try {
      const activeBeforeStart = await getActiveDungeonRunWithTimeout();
      if (activeBeforeStart) {
        const activeDungeon = data.catalog.dungeons.find((candidate) => candidate.id === activeBeforeStart.run.dungeonId);
        if (!activeDungeon) throw new Error("An active Dungeon run is unavailable in this release.");
        showActiveDungeonPrompt(activeBeforeStart, data.catalog.dungeons);
        setDungeonEntry(null);
        setCombat(null);
        setView("play");
        if (dungeonEntryRequestRef.current === requestId) dungeonEntryRequestRef.current = null;
        return;
      }
      await flushPlayerMutationsWithTimeout();
    } catch (err) {
      console.error("Unable to check for an existing Dungeon run.", { dungeonId: dungeon.id, error: err });
      setDungeonEntry(null);
      setCombat(null);
      setView("play");
      setError(dungeonEntryErrorMessage(err));
      if (dungeonEntryRequestRef.current === requestId) dungeonEntryRequestRef.current = null;
      return;
    }
    try {
      const run = await startDungeonRunWithRecovery(dungeon.id, requestId, (attempt) => {
        setDungeonEntry((current) => current?.requestId === requestId
          ? { ...current, phase: attempt.phase, attempt: attempt.attempt, maxAttempts: attempt.maxAttempts }
          : current);
      });
      setDungeonEntry((current) => current?.requestId === requestId
        ? { ...current, runId: run.id }
        : current);
      if (dungeonAbandonRequestRef.current === requestId) {
        await resolveDungeonRunWithTimeout(run.id);
        return;
      }
      setDungeonEntry((current) => current?.requestId === requestId
        ? { ...current, phase: "confirming" }
        : current);
      const initialCombat = createDungeonRunState(data.catalog, data.player, dungeon, run);
      const confirmedSnapshot = await snapshotDungeonRunEffectsWithRecovery(run.id, initialCombat.battle.snapshot, (attempt) => {
        setDungeonEntry((current) => current?.requestId === requestId
          ? { ...current, phase: attempt.phase, attempt: attempt.attempt, maxAttempts: attempt.maxAttempts }
          : current);
      });
      if (dungeonAbandonRequestRef.current === requestId) {
        await resolveDungeonRunWithTimeout(run.id);
        return;
      }
      if (dungeonEntryRequestRef.current !== requestId) return;
      setCombat(applyAuthoritativeDungeonEffectSnapshot(initialCombat, confirmedSnapshot));
      setDungeonEntry(null);
    } catch (err) {
      if (dungeonAbandonRequestRef.current === requestId) return;
      console.error("Unable to initialize Dungeon entry.", { dungeonId: dungeon.id, requestId, error: err });
      setCombat(null);
      setDungeonEntry(null);
      setError(dungeonEntryErrorMessage(err));
      setView("play");
    } finally {
      if (dungeonEntryRequestRef.current === requestId) dungeonEntryRequestRef.current = null;
      if (dungeonAbandonRequestRef.current === requestId) dungeonAbandonRequestRef.current = null;
    }
  }

  function queueCombatProgressEvents(runId: string, turnNumber: number, events: Parameters<typeof submitCollectibleCombatEvents>[2]) {
    if (events.length === 0) return;
    const work = combatProgressQueue.current.then(async () => {
      await submitCollectibleCombatEvents(runId, turnNumber, events);
    });
    combatProgressQueue.current = work.catch((progressError) => {
      // Challenge progress is a non-critical post-combat projection. Combat
      // and its authoritative rewards have already completed, so a slow or
      // locked progress write must not become a gameplay error banner.
      console.warn("Collectible combat progress was deferred after the combat result.", progressError);
    });
  }

  async function establishGameplaySession(takeover = false): Promise<boolean> {
    const result = await acquireGameplaySession(takeover);
    sessionStoppingRef.current = false;
    setIsAuthed(true);
    if (result.outcome === "ACCOUNT_ONLINE") {
      setSessionConflict(result);
      return false;
    }
    setSessionConflict(null);
    setAccountMoved(false);
    return true;
  }

  async function finishAuthentication(): Promise<void> {
    if (await establishGameplaySession(false)) await refresh();
  }

  useEffect(() => {
    if (desktopGate !== "ready") return;
    if (!hasSupabaseConfig || !supabase) {
      setSessionReady(true);
      return;
    }

    const initializeSession = async () => {
      await syncLocalServerCompatibility();
      const session = await getSession();
      setIsAuthed(Boolean(session));
      if (session && await establishGameplaySession(false)) await refresh();
    };
    void initializeSession()
      .catch((err) => setError(err.message))
      .finally(() => setSessionReady(true));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      if (!session) {
        setData(null);
        setSessionConflict(null);
        setAccountMoved(false);
        setDungeonEntry(null);
        dungeonEntryRequestRef.current = null;
        clearedLegacyShopLedgerUserRef.current = null;
        setView("auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [desktopGate]);

  useEffect(() => {
    if (!isAuthed || sessionConflict || accountMoved) return;
    const heartbeat = window.setInterval(() => {
      if (sessionStoppingRef.current) return;
      void heartbeatGameplaySession().catch((heartbeatError) => {
        if (!sessionStoppingRef.current && errorMessage(heartbeatError, "").includes("SESSION_DISPLACED")) {
          setAccountMoved(true);
          setCombat(null);
          setDungeonEntry(null);
          dungeonEntryRequestRef.current = null;
        }
      });
    }, 20_000);
    return () => window.clearInterval(heartbeat);
  }, [accountMoved, isAuthed, sessionConflict]);

  async function endSession(): Promise<void> {
    sessionStoppingRef.current = true;
    try {
      await signOut();
      setIsAuthed(false);
      setSessionConflict(null);
      setAccountMoved(false);
    } catch (error) {
      sessionStoppingRef.current = false;
      throw error;
    }
  }

  useEffect(() => {
    function popstate() {
      if (!isAuthed || !data?.player) return;
      if (dungeonEntryRequestRef.current) return;
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
    view,
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
    if (!combat || combat.run.status !== "started" || dungeonEntry || combatSaveDisabledRef.current) return;
    const signature = JSON.stringify(serializeDungeonRunState(combat));
    if (signature === combatSaveSignatureRef.current) return;
    scheduleCombatSave();
  }, [combat, dungeonEntry]);

  useEffect(() => {
    const textData = data;
    window.render_game_to_text = () =>
      JSON.stringify({
        view,
        loading,
        dungeonEntry: dungeonEntry ? {
          dungeonId: dungeonEntry.dungeon.id,
          phase: dungeonEntry.phase,
          attempt: dungeonEntry.attempt,
          maxAttempts: dungeonEntry.maxAttempts,
        } : null,
        dungeonPrompt: activeDungeonPrompt ? {
          dungeonId: activeDungeonPrompt.dungeon.id,
          dungeonName: activeDungeonPrompt.dungeon.name,
          runId: activeDungeonPrompt.active.run.id,
          busy: activeDungeonPromptBusy,
        } : null,
        dungeonExitPrompt: dungeonExitPrompt ? {
          destination: dungeonExitPrompt,
          busy: dungeonExitPromptBusy,
        } : null,
        authed: isAuthed,
        catalogRelease: textData?.catalogRelease ?? null,
        playerStateRevision: textData?.player?.playerStateRevision ?? null,
        serverCatalogVersion: textData?.player?.serverCatalogVersion ?? null,
        lootboxOpeningPhase: document.documentElement.dataset.lootboxOpeningPhase ?? null,
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
        currencies: textData?.player?.collectibleSnapshot.currencies ?? [],
        unsavedShopPurchases: 0,
        trackedChallenges: data?.player?.collectibleSnapshot.tracked ?? [],
        shop: view === "shop"
          ? {
              tab: shopTab,
              offers: textData?.catalog.shopEntries.filter((entry) => entry.shop_type === shopTab).length ?? 0,
              unsavedPurchases: 0,
              promo: shopTab === "promo" ? promoState : null,
            }
          : null,
        bag: view === "bag"
          ? {
              tab: bagTab,
              currencies: textData ? orderedCurrencies(textData).filter((currency) => currency.id === "coins" || currency.id === "prismite").length : 0,
              shards: textData?.player?.collectibleSnapshot.shards.filter((row) => BigInt(row.quantity || "0") > 0n).length ?? 0,
              lootboxes: textData?.player?.collectibleSnapshot.lootboxes.filter((row) => BigInt(row.quantity || "0") > 0n).length ?? 0,
            }
          : null,
        unlockNotification: notificationQueue[0]?.kind === "collectible-unlock"
          ? notificationQueue[0].event
          : null,
        challengeNotification: notificationQueue[0]?.kind === "challenge-completed"
          ? { challengeId: notificationQueue[0].challengeId }
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
              battleFormat: combat.run.battleFormat,
              encounter: combat.run.battleIndex,
              encounterCount: combat.run.battleCount,
              turn: combat.battle.turn,
              playerMana: combat.battle.playerMana,
              opponentMana: combat.battle.opponentMana,
              requiredLeadCount: combat.requiredLeadCount,
              selectedLeadIds: combat.selectedLeadIds,
              narration: document.querySelector(".combat-narration")?.textContent?.trim()
                ?? currentDungeonEvent(combat)?.message
                ?? null,
              narrationLoading: (document.querySelector(".combat-narration")?.textContent?.trim() ?? "").startsWith("Loading"),
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
                blocking: unit.blocking,
                blockStreak: unit.blockStreak,
                stats: unit.stats,
                recharging: isActorRecharging(combat.battle, unit.key),
                skills: unit.skills.map((skill) => ({
                  id: skill.id,
                  ...skillAvailability(combat.battle, unit.key, skill.id),
                })),
                activeEffects: combatEffectSummaries(combat.battle, unit.key),
              })),
              opponents: (() => {
                const hiddenOpponentKeys = new Set(
                  [...document.querySelectorAll<HTMLElement>(".combat-squad-slot.unknown[data-combat-squad-unit-key]")]
                    .map((node) => node.dataset.combatSquadUnitKey)
                    .filter((key): key is string => Boolean(key)),
                );
                return combat.battle.opponentUnits.map((unit, slot) => {
                  const hidden = combat.phase === "lead_selection" || hiddenOpponentKeys.has(unit.key);
                  return hidden
                    ? { key: unit.key, slot, hidden: true }
                    : {
                        key: unit.key,
                        name: unit.name,
                        elementIds: critterElementIds(unit.critter),
                        hp: unit.hp,
                        maxHp: unit.maxHp,
                        active: unit.active,
                        slot: unit.battlefieldSlot,
                        roll: unit.manaRoll,
                        blocking: unit.blocking,
                        blockStreak: unit.blockStreak,
                        hidden: false,
                        recharging: isActorRecharging(combat.battle, unit.key),
                        skills: unit.skills.map((skill) => ({
                          id: skill.id,
                          ...skillAvailability(combat.battle, unit.key, skill.id),
                        })),
                        activeEffects: combatEffectSummaries(combat.battle, unit.key),
                      };
                });
              })(),
              statuses: combat.battle.statuses.map((status) => ({ statusId: status.statusId, holder: status.holderKey, duration: status.duration })),
              presentation: currentDungeonEvent(combat)
                ? {
                    id: currentDungeonEvent(combat)!.id,
                    kind: currentDungeonEvent(combat)!.kind,
                    actorKey: currentDungeonEvent(combat)!.actorKey ?? null,
                    targetKeys: currentDungeonEvent(combat)!.targetKeys,
                    damageRollPercent: currentDungeonEvent(combat)!.damageRollPercent ?? null,
                    damageSpreadPercent: currentDungeonEvent(combat)!.damageSpreadPercent ?? null,
                    swap: currentDungeonEvent(combat)!.swap
                      ? {
                          ...currentDungeonEvent(combat)!.swap!,
                          revealed: [...combat.battle.playerUnits, ...combat.battle.opponentUnits].some((unit) => (
                            unit.key === currentDungeonEvent(combat)!.swap!.incomingKey
                            && unit.active
                            && unit.battlefieldSlot === currentDungeonEvent(combat)!.swap!.battlefieldSlot
                          )),
                        }
                      : null,
                  }
                : null,
              rngState: combat.battle.rngState,
              skillUsage: combat.battle.skillUsage,
              rechargeUntilTurn: combat.battle.rechargeUntilTurn,
            }
          : null,
      });
    window.advanceTime = () => undefined;
  }, [view, shopTab, bagTab, loading, isAuthed, data, combat, dungeonEntry, activeDungeonPrompt, activeDungeonPromptBusy, dungeonExitPrompt, dungeonExitPromptBusy, notificationQueue, promoState]);

  if (desktopGate === "checking") return <Shell><Loading message="Checking for required Game Updates..." /></Shell>;
  if (desktopGate === "error") return <Shell><DesktopUpdateScreen message={desktopGateError ?? "The secure update check failed."} /></Shell>;
  if (desktopGate === "required" && desktopUpdate) return <Shell><DesktopUpdateScreen version={desktopUpdate.version} update={desktopUpdate} /></Shell>;
  if (!hasSupabaseConfig) return <SetupScreen />;
  if (!sessionReady) return <Shell><Loading message="Checking session..." /></Shell>;
  if (!isAuthed) return <Shell><AuthScreen onAuthed={() => void finishAuthentication()} onClose={closeRollcasters} error={error} setError={setError} /></Shell>;
  if (sessionConflict) return <Shell><GameplaySessionDialog
    kind="online"
    busy={sessionActionBusy}
    onOk={async () => {
      setSessionActionBusy(true);
      try { await endSession(); } finally { setSessionActionBusy(false); }
    }}
    onPlayHere={async () => {
      setSessionActionBusy(true);
      try { if (await establishGameplaySession(true)) await refresh(); } catch (sessionError) { setError(errorMessage(sessionError, "Unable to take over this account.")); } finally { setSessionActionBusy(false); }
    }}
  /></Shell>;
  if (accountMoved) return <Shell><GameplaySessionDialog
    kind="moved"
    busy={sessionActionBusy}
    onOk={async () => { setSessionActionBusy(true); try { await endSession(); } finally { setSessionActionBusy(false); } }}
  /></Shell>;
  if (!data?.player) return <Shell><Loading message="Loading Rollcasters..." error={error} /></Shell>;

  return (
    <Shell className={
      view === "collection" || view === "bag" || view === "shop"
        ? "collection-shell"
        : view === "combat"
          ? "combat-shell"
          : ""
    }>
      <TopBar
        data={data}
        player={data.player!}
        onHome={() => {
          if (view === "combat" && (combat || dungeonEntry)) {
            requestDungeonExit("home");
            return;
          }
          if (dungeonEntryRequestRef.current) return;
          navigate(requiredStarterView(data.player) ?? "home");
        }}
        onSignOut={endSession}
        onClose={closeRollcasters}
      />
      <div ref={appKeyboardRootRef} className="app-keyboard-root" aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Space ShiftLeft">
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
          onBag={() => navigate("bag")}
          onShop={() => navigate("shop", "shard")}
          onPlay={() => void openPlay()}
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
      {view === "bag" && (
        <BagScreen
          data={data}
          tab={bagTab}
          setTab={setBagTab}
          onRefresh={() => refresh("bag")}
          onBeforeOpenLootbox={async () => {
            if (desktopUpdate) throw new Error("A required Game Update is ready. Update before opening another Lootbox.");
          }}
          onPurchaseError={(purchaseFailure) => enqueueNotification(createShopErrorNotification(purchaseFailure))}
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
          onPurchase={purchaseShopItem}
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
      {view === "play" && activeDungeonPrompt && (
        <ContinueDungeonDialog
          dungeon={activeDungeonPrompt.dungeon}
          busy={activeDungeonPromptBusy}
          onContinue={() => void continueActiveDungeon()}
          onAbandon={() => void abandonActiveDungeon()}
          onClose={() => {
            if (!activeDungeonPromptBusy) setActiveDungeonPrompt(null);
          }}
        />
      )}
      {view === "combat" && dungeonExitPrompt && (
        <AbandonDungeonDialog
          busy={dungeonExitPromptBusy}
          onConfirm={() => void confirmDungeonExit()}
          onCancel={() => {
            if (!dungeonExitPromptBusy) {
              setDungeonExitPrompt(null);
              combatSaveDisabledRef.current = false;
              if (dungeonAbandonRequestRef.current === dungeonEntry?.requestId) dungeonAbandonRequestRef.current = null;
              if (combat) scheduleCombatSave();
            }
          }}
        />
      )}
        {view === "combat" && dungeonEntry && (
          <DungeonEntryScreen entry={dungeonEntry} />
        )}
      {view === "combat" && !dungeonEntry && combat && (
        <CombatScreen
          data={data}
          combat={combat}
          setCombat={setCombat}
          onBattleResult={async (resolved) => {
            setLoading(true);
            setError(null);
            try {
              const result = await recordDungeonBattleResult(
                resolved.run,
                dungeonBattleSubmission(resolved),
              );
              if (result.run.status === "won") {
                const activatedRelicIds = [...new Set(resolved.battle.runtimeEffects
                  .filter((effect) => effect.sourceOwnerType === "relic" && effect.activationCount > 0)
                  .map((effect) => effect.sourceOwnerId))];
                queueCombatProgressEvents(resolved.run.id, resolved.battle.turn, [{
                  event_key: `dungeon:${resolved.run.id}:completed`,
                  event_type: "dungeon_completed",
                  source_critter_id: null,
                  target_critter_id: null,
                  skill_id: null,
                  amount: 1,
                  payload: {
                    won: true,
                    dungeon_id: resolved.run.dungeonId,
                    dungeon_order: resolved.dungeon.sort_order,
                    dungeon_clear: true,
                    squad: resolved.battle.playerUnits.map((unit) => ({ critter_id: unit.critter.id, element_ids: critterElementIds(unit.critter), survived: unit.hp > 0 })),
                    survivors_complete: resolved.battle.playerUnits.filter((unit) => unit.active).every((unit) => unit.hp > 0),
                    activated_relic_ids: activatedRelicIds,
                    required_relics_activated: activatedRelicIds.length > 0,
                  },
                }]);
              }
              // The result RPC has already committed XP. Project that receipt
              // into the current client snapshot before mounting the result
              // screen so the background refresh reconciles to the same
              // animation target instead of restarting it.
              const playerAfterRewards = applyDungeonXpRewards(
                data.player!,
                result.battleRewards,
                data.catalog.critterProgression,
                data.catalog.rollcasterProgression,
              );
              setData((current) => current?.player
                ? {
                    ...current,
                    player: playerAfterRewards,
                  }
                : current);
              setCombat(applyDungeonBattleResult(resolved, result, data.catalog, playerAfterRewards));
              // Refresh the catalog/player projection after the result screen
              // is visible. The authoritative result already contains the
              // run and reward state needed for this immediate transition.
              void refresh("combat", { showLoading: false });
            } catch (resultError) {
              setError(errorMessage(resultError, "Unable to record the encounter result."));
            } finally {
              setLoading(false);
            }
          }}
          onBack={() => requestDungeonExit("play")}
          onHome={() => requestDungeonExit("home")}
          onReplay={() => beginDungeon(combat.dungeon)}
          onNextDungeon={(dungeonId) => {
            const next = data.catalog.dungeons.find((dungeon) => dungeon.id === dungeonId);
            if (next) void beginDungeon(next);
          }}
        />
        )}
      </div>
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

function dungeonEntryErrorMessage(error: unknown): string {
  const raw = errorMessage(error, "Unable to start dungeon.");
  if (raw.includes("DUNGEON_ENTRY_TIMEOUT") || raw.toLowerCase().includes("canceling statement due to statement timeout")) {
    return "Dungeon entry is taking longer than expected. No combat was started; please try again.";
  }
  return raw;
}

function applyAuthoritativeDungeonEffectSnapshot(
  state: DungeonRunState,
  effectSnapshot: unknown,
): DungeonRunState {
  if (!effectSnapshot || typeof effectSnapshot !== "object") return state;
  const snapshot = structuredClone(effectSnapshot) as RunEffectSnapshot;
  return {
    ...state,
    battle: { ...state.battle, snapshot },
    pendingBattle: state.pendingBattle ? { ...state.pendingBattle, snapshot } : null,
  };
}

function loadoutErrorMessage(error: unknown, fallback: string): string {
  const raw = errorMessage(error, fallback);
  const messages: Record<string, string> = {
    SKILL_NOT_IN_PUBLISHED_RELEASE: "This Skill is not part of the current published release.",
    ABILITY_NOT_IN_PUBLISHED_RELEASE: "This Ability is not part of the current published release.",
    SKILL_NOT_ALLOWED_FOR_CRITTER: "This Skill is not available for this Critter.",
    ABILITY_NOT_ALLOWED_FOR_ROLLCASTER: "This Ability is not available for this Rollcaster.",
    PLAYER_REVISION_CONFLICT: "Your loadout changed elsewhere. Reloading the latest state…",
    SESSION_DISPLACED: "This account moved to another session.",
  };
  const code = Object.keys(messages).find((candidate) => raw.includes(candidate));
  return code ? messages[code] : raw;
}

function useViewportFitScale(bottomGutter = 4) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let animationFrame = 0;

    const fit = () => {
      const nodeRect = node.getBoundingClientRect();
      const currentScale = Number(node.dataset.viewportFitScale ?? 1) || 1;
      const directContentBottom = Math.max(
        nodeRect.top,
        ...Array.from(node.children).map((child) => child.getBoundingClientRect().bottom),
      );
      // scrollHeight can omit the visual contribution of a final child's
      // collapsed margin. Measure the direct rendered rows as well so the
      // narration/control footer cannot fall below a short viewport.
      const renderedNaturalHeight = (directContentBottom - nodeRect.top) / currentScale;
      const naturalHeight = Math.max(node.scrollHeight, renderedNaturalHeight);
      const availableHeight = Math.max(0, window.innerHeight - nodeRect.top - bottomGutter);
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
    <main className={`app-shell ${className}`.trim()} data-game-profile={desktopProfile.profile} data-game-environment={desktopProfile.environment}>
      <div className="world-glow" />
      {desktopProfile.badge && <span className={`game-profile-badge ${desktopProfile.profile}`} aria-label={`${desktopProfile.appName} profile`}>{desktopProfile.badge}</span>}
      {children}
    </main>
  );
}

function DesktopUpdateScreen({ version, update, message }: { version?: string; update?: DesktopUpdate; message?: string }) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="setup-panel loading-panel desktop-update-panel" role="alert">
      <RefreshCw size={42} aria-hidden="true" />
      <h1>{version ? `Rollcasters ${version} is required` : "Secure update check unavailable"}</h1>
      <p>{message ?? "Install this signed Game Update before entering Rollcasters. Your account and progress remain safely stored online."}</p>
      {error && <div className="notice error">{error}</div>}
      {update && <button className="primary-button" type="button" disabled={installing} onClick={async () => {
        setInstalling(true);
        setError(null);
        try {
          await update.installAndRestart();
        } catch (installError) {
          setError(installError instanceof Error ? installError.message : "The signed update could not be installed.");
          setInstalling(false);
        }
      }}>{installing ? "Installing signed update..." : "Update and restart"}</button>}
      <button className="secondary-button" type="button" onClick={() => downloadDiagnosticReport(desktopProfile, import.meta.env.VITE_GAME_VERSION ?? "0.1.0", {
        state: error ? "install-error" : version ? "update-required" : "update-check-error",
        availableVersion: version,
        errorClass: error ? "install-failed" : message ? "update-check-failed" : undefined,
      })}>Export redacted diagnostics</button>
    </section>
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
        <p>Add these to `.env`, run the shared SQL migration from the vault, then restart the dev server.</p>
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

function DungeonEntryScreen({ entry }: { entry: DungeonEntryState }) {
  const message = entry.phase === "starting"
    ? "Preparing your squad and opponents..."
    : entry.phase === "confirming"
      ? "Confirming the run snapshot..."
      : "Reconnecting to the Dungeon run...";
  return (
    <section className="setup-panel loading-panel dungeon-entry-screen" role="status" aria-live="polite">
      <Swords size={46} aria-hidden="true" />
      <p className="eyebrow">Dungeon briefing</p>
      <h1>Entering {entry.dungeon.name}</h1>
      <p>{message}</p>
    </section>
  );
}

function GameplaySessionDialog({
  kind,
  busy,
  onOk,
  onPlayHere,
}: {
  kind: "online" | "moved";
  busy: boolean;
  onOk: () => Promise<void>;
  onPlayHere?: () => Promise<void>;
}) {
  return <section className="setup-panel loading-panel gameplay-session-dialog" role="alertdialog" aria-live="assertive">
    <UserRound size={42} aria-hidden="true" />
    <h1>{kind === "online" ? "Account is Online" : "Account Moved"}</h1>
    <p>{kind === "online" ? "This account is active in another Rollcasters session." : "This account is now being played on another device."}</p>
    <div className="dialog-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void onOk()}>{kind === "online" ? "OK" : "Return to sign in"}</button>
      {kind === "online" && onPlayHere && <button type="button" className="primary-button" disabled={busy} onClick={() => void onPlayHere()}>{busy ? "Connecting…" : "Play Here"}</button>}
    </div>
  </section>;
}

function AuthScreen({
  onAuthed,
  onClose,
  error,
  setError,
}: {
  onAuthed: () => void;
  onClose: () => Promise<void>;
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
      setError(errorMessage(err, "Authentication failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <ExitControl className="auth-exit-control" onClose={onClose} />
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
          <>
            <label>
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ShanksFan" />
            </label>
          </>
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
      <div className="auth-version-pill" aria-label={`Game version ${currentGameVersion}`}>
        v{currentGameVersion}
      </div>
    </section>
  );
}

function TopBar({
  data,
  player,
  onHome,
  onSignOut,
  onClose,
}: {
  data: AppData;
  player: PlayerState;
  onHome: () => void;
  onSignOut: () => void;
  onClose: () => Promise<void>;
}) {
  const currencies = orderedCurrencies(data);
  const topBarRef = useRef<HTMLElement>(null);
  const currencyTooltipRef = useRef<HTMLSpanElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handleDocumentInteraction(event: MouseEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDocumentInteraction);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentInteraction);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

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

  return <>
    <header ref={topBarRef} className={`top-bar ${currencies.length > 3 ? "currency-rich" : ""}`.trim()}>
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
                <span className="currency-pill-amount">{amount}</span>
              </div>
            );
          })}
        </div>
        <div className="user-menu" ref={userMenuRef}>
          <button
            type="button"
            className="user-pill user-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <UserRound size={17} aria-hidden="true" />
            <span className="user-menu-name">{player.profile.username}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {profileMenuOpen && (
            <div className="user-menu-dropdown" role="menu" aria-label="Account menu">
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  void onSignOut();
                }}
              >
                <LogOut size={17} aria-hidden="true" />
                Log Out
              </button>
              <div className="user-menu-version" aria-label={`Game version ${currentGameVersion}`}>
                <span>Game version</span>
                <strong>v{currentGameVersion}</strong>
              </div>
            </div>
          )}
        </div>
        <ExitControl onClose={onClose} />
      </div>
      <span
        ref={currencyTooltipRef}
        className="currency-hover-tooltip"
        aria-hidden="true"
      />
    </header>
  </>;
}

function ExitControl({ className = "", onClose }: { className?: string; onClose: () => Promise<void> }) {
  const [exitDialogOpen, setExitDialogOpen] = useState(false);

  return <>
    <button
      type="button"
      className={`icon-button exit-button ${className}`.trim()}
      onClick={() => setExitDialogOpen(true)}
      aria-label="Exit Rollcasters"
    >
      <X size={19} aria-hidden="true" />
    </button>
    {exitDialogOpen && (
      <Modal eyebrow="Rollcasters" title="Do you want to exit Rollcasters?" description={null} onClose={() => setExitDialogOpen(false)} className="exit-dialog">
        <div className="dialog-actions exit-dialog-actions">
          <button type="button" className="secondary-button" onClick={() => setExitDialogOpen(false)}>No</button>
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              void onClose().catch((error) => console.error("Unable to close Rollcasters.", error));
              setExitDialogOpen(false);
            }}
          >
            Yes
          </button>
        </div>
      </Modal>
    )}
  </>;
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

type EquipTarget =
  | { type: "critter"; slotIndex: number }
  | { type: "skill"; slotIndex: number; owned: UserCritter; gridWidth: number }
  | { type: "relic"; slotIndex: number; owned: UserCritter }
  | { type: "ability"; slotIndex: number; owned: UserRollcaster }
  | { type: "rollcaster"; slotIndex: number };

function HomeScreen({ data, onCollection, onBag, onShop, onPlay, onRefresh }: { data: AppData; onCollection: () => void; onBag: () => void; onShop: () => void; onPlay: () => void; onRefresh: () => Promise<void> }) {
  const player = data.player!;
  const activeRollcaster = player.rollcasters.find((row) => row.id === player.profile.active_rollcaster_id) ?? player.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, activeRollcaster?.rollcaster_id);
  const squad = Array.from({ length: 5 }, (_, index) => player.squadSlots.find((slot) => slot.slot_index === index + 1) ?? ({ user_id: player.profile.user_id, slot_index: index + 1, user_critter_id: null }));
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
      setEquipError(loadoutErrorMessage(err, "Unable to update loadout."));
    } finally {
      setSaving(false);
    }
  }

  async function unlockSkill(owned: UserCritter, skillId: string) {
    setSaving(true);
    setEquipError(null);
    try {
      await unlockCritterSkill(owned.id, skillId);
      await onRefresh();
    } catch (err) {
      setEquipError(errorMessage(err, "Unable to unlock this skill."));
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
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster?.name ?? "Shanks"} element="basic" assetPath={preferredAssetPath(data, "rollcaster", rollcaster?.id, rollcaster?.asset_path, ["portrait", "card", "thumb"])} size="hero" fit="portrait" /></CardSprite>
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
        <button className="menu-button" onClick={onBag}>
          <ShoppingBag size={24} />
          Bag
        </button>
        <button className="menu-button" onClick={onShop}>
          <Coins size={24} />
          Shop
        </button>
      </nav>

      <section ref={squadPanelRef} className="squad-panel" aria-label="Equipped squad">
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
    {equipTarget && <EquipDialog data={data} target={equipTarget} saving={saving} error={equipError} onClose={() => setEquipTarget(null)} onEquip={equip} onUnlockSkill={unlockSkill} />}
    </>
  );
}

function ChallengeTracking({ data, onRefresh }: { data: AppData; onRefresh: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const tracked = trackedChallengesForDisplay(data);

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
      <TrackedChallengeSlots data={data} tracked={tracked} busyId={busyId} onUntrack={untrack} />
    </section>
  );
}

function TrackedChallengeSlots({
  data,
  tracked,
  busyId,
  onUntrack,
  onSelect,
}: {
  data: AppData;
  tracked: ReturnType<typeof trackedChallengesForDisplay>;
  busyId?: string | null;
  onUntrack?: (challengeId: string) => void;
  onSelect?: (challengeId: string) => void;
}) {
  return (
    <div className="challenge-tracking-slots">
      {[1, 2, 3].map((slot) => {
        const trackedRow = tracked[slot - 1];
        const challenge = data.catalog.collectibleUnlockChallenges.find((row) => row.id === trackedRow?.challenge_id);
        if (!challenge) return <div className="tracked-challenge-card empty" key={slot}><Target size={20} /><span>Tracking slot {slot}</span></div>;
        const progress = progressFor(data, challenge.id);
        const selectable = Boolean(onSelect);
        const select = () => onSelect?.(challenge.id);
        return (
          <article
            className={`tracked-challenge-card ${selectable ? "selectable replacement-slot" : ""}`.trim()}
            key={slot}
            role={selectable ? "button" : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={selectable ? `Replace ${collectibleName(data, challenge.collectible_type, challenge.collectible_id)} challenge` : undefined}
            onClick={selectable ? select : undefined}
            onKeyDown={selectable ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select();
              }
            } : undefined}
          >
            <CollectibleSprite data={data} type={challenge.collectible_type} id={challenge.collectible_id} size="sm" />
            <div className="tracked-challenge-copy">
              <strong>{collectibleName(data, challenge.collectible_type, challenge.collectible_id)}</strong>
              <span>{challengeDescription(data, challenge)}</span>
              <span className="challenge-progress">{formatAmount(progress.current)} / {formatAmount(progress.goal)}</span>
            </div>
            {onUntrack && <button type="button" className="link-button tracked-untrack" disabled={busyId === challenge.id} onClick={(event) => { event.stopPropagation(); onUntrack(challenge.id); }}>Untrack</button>}
          </article>
        );
      })}
    </div>
  );
}

function ChallengeReplacementModal({
  data,
  challenge,
  tracked,
  busyId,
  onReplace,
  onClose,
}: {
  data: AppData;
  challenge: CollectibleUnlockChallenge;
  tracked: ReturnType<typeof trackedChallengesForDisplay>;
  busyId?: string | null;
  onReplace: (challengeId: string) => Promise<void>;
  onClose: () => void;
}) {
  const progress = progressFor(data, challenge.id);
  const replacementStarted = useRef(false);

  function selectReplacement(replacedChallengeId: string) {
    if (replacementStarted.current) return;
    replacementStarted.current = true;
    onClose();
    void onReplace(replacedChallengeId).catch(() => undefined);
  }

  return createPortal(
    (
    <Modal eyebrow="Challenge tracking" title="Replace a tracked challenge" description={null} onClose={onClose} className="challenge-replacement-modal">
      <div className="tracked-challenge-card challenge-replacement-target">
        <CollectibleSprite data={data} type={challenge.collectible_type} id={challenge.collectible_id} size="sm" />
        <div className="tracked-challenge-copy"><strong>{collectibleName(data, challenge.collectible_type, challenge.collectible_id)}</strong><span>{challengeDescription(data, challenge)}</span><span className="challenge-progress">{formatAmount(progress.current)} / {formatAmount(progress.goal)}</span></div>
      </div>
      <p className="challenge-note">Select a tracked slot to replace it with this challenge.</p>
      <TrackedChallengeSlots data={data} tracked={tracked} busyId={busyId} onSelect={selectReplacement} />
    </Modal>
    ),
    document.body,
  );
}

function CollectibleSprite({ data, type, id, size = "sm", shard = false }: { data: AppData; type: CollectibleType; id: string; size?: "xs" | "sm" | "md"; shard?: boolean }) {
  const name = collectibleName(data, type, id);
  const critter = type === "critter" ? byId(data.catalog.critters, id) : undefined;
  const element = critter?.element_1_id ?? (type === "relic" ? "metal" : "basic");
  const variant = type === "relic"
    ? size === "xs" ? "icon" : size === "sm" ? "thumb" : "card"
    : size === "xs" || size === "sm" ? "thumb" : "card";
  const content = <Sprite name={name} element={element} assetPath={preferredAssetPath(data, type, id, collectibleAssetPath(data, type, id), [variant, "card", "thumb"])} size="small" fit={type === "rollcaster" ? "portrait" : "contain"} />;
  return shard
    ? <span className="shard-sprite-glow" role="img" aria-label={`${name} shards`}><svg className="shard-sprite-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon className="shard-outline-glow shard-outline-glow-wide" points="1,50 50,1 99,50 50,99" /><polygon className="shard-outline-glow shard-outline-glow-mid" points="1,50 50,1 99,50 50,99" /><polygon className="shard-outline-border" points="1,50 50,1 99,50 50,99" /></svg><span className="shard-sprite-frame" aria-hidden="true">{content}</span></span>
    : <SpriteFrame size={size}>{content}</SpriteFrame>;
}

function preferredAssetPath(
  data: AppData,
  category: string,
  ownerId: string | null | undefined,
  directPath: string | null | undefined,
  variants: readonly string[],
): string | null {
  if (ownerId) {
    for (const variant of variants) {
      const path = findAssetPath(data, category, ownerId, variant);
      if (path) return path;
    }
  }
  return catalogAssetPath(data, category, ownerId, directPath);
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
  const relicSlotStates = relicSlotUnlocks(data.catalog.critterProgression, critter.id, 6);

  return (
    <article className="loadout-slot">
      <div className="loadout-critter-summary">
        <button className="slot-topline slot-button loadout-critter-header" onClick={() => onEquip({ type: "critter", slotIndex })} aria-label={`Change ${critter.name} in squad slot ${slotIndex}`}>
          <SpriteFrame size="md" className="loadout-critter-frame"><Sprite name={critter.name} element={critter.element_1_id} assetPath={preferredAssetPath(data, "critter", critter.id, critter.asset_path, ["thumb", "card"])} size="small" /></SpriteFrame>
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
            const skill = byId(data.catalog.skills, row?.skill_id);
            const skillCost = skill ? calculated.skillCosts[skill.id] : undefined;
            return <SkillTile key={skillSlot} data={data} skill={skill} sourceCritter={critter} manaCost={skillCost?.final} manaCostBreakdown={skillCost} onClick={(event) => {
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
            const relic = row?.relic_id && collectibleIsUnlocked(data, "relic", row.relic_id) ? byId(data.catalog.relics, row.relic_id) : undefined;
            return <LoadoutRelicSlot key={relicSlot} data={data} relic={relic} sourceCritter={critter} slotIndex={relicSlot} onClick={() => onEquip({ type: "relic", slotIndex: relicSlot, owned })} />;
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
    const maxLeft = Math.max(gutter, window.innerWidth - tooltipRect.width - gutter);
    const left = Math.min(
      Math.max(anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2, gutter),
      maxLeft,
    );
    const maxTop = Math.max(gutter, window.innerHeight - tooltipRect.height - gutter);
    const preferredAbove = anchorRect.top - tooltipRect.height - 8;
    const preferredTop = preferredAbove >= gutter
      ? preferredAbove
      : Math.min(anchorRect.bottom + 8, window.innerHeight - tooltipRect.height - gutter);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.min(Math.max(gutter, preferredTop), maxTop)}px`;
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
      {createPortal(
        <span ref={tooltipRef} id={tooltipId} className="game-tooltip viewport-game-tooltip" role="tooltip">{content}</span>,
        document.body,
      )}
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

function SkillTile({ data, skill, sourceCritter, onClick, disabled = false, disabledReason, selected = false, equipped = false, manaCost, manaCostBreakdown, combatControl = false, combatSkillId }: { data: AppData; skill?: Skill | null; sourceCritter?: Critter; onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; disabledReason?: string; selected?: boolean; equipped?: boolean; manaCost?: number; manaCostBreakdown?: ActionCostBreakdown; combatControl?: boolean; combatSkillId?: string }) {
  const element = skill ? byId(data.catalog.elements, skill.element_id) : null;
  const elementPath = skill ? catalogAssetPath(data, "element", skill.element_id, element?.asset_path, "icon") : null;
  const manaPath = findAssetPath(data, "mana", "mana");
  const displayedManaCost = skill ? manaCost ?? skill.mana_cost : null;
  const attachments = skill ? data.catalog.effectsBySkill[skill.id] ?? [] : [];
  const effectText = skill ? attachmentText(attachments) : "";
  const targetText = skill ? `${targetingDescription(skill)} Priority: ${skill.priority ?? 0}` : "";
  const costSummary = skill && manaCostBreakdown ? costBreakdownText("Mana cost", manaCostBreakdown) : "";
  const label = skill ? `${skill.name}, ${skill.skill_type}${skill.skill_type === "attack" ? `, ${skill.power} power` : ""}, ${displayedManaCost} Mana. ${skill.description} ${effectText} ${targetText} ${costSummary}` : "Choose a skill.";
  const tooltip = skill ? <><span className="tooltip-heading"><AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={18} />} /><strong>{skill.name} - {skill.skill_type === "attack" ? "Attack" : "Support"}{skill.skill_type === "attack" ? ` - ${skill.power} Power` : ""}</strong></span><span className="tooltip-description">{skill.description}</span>{manaCostBreakdown && manaCostBreakdown.sources.length > 0 && <CostBreakdownLine label="Mana cost" breakdown={manaCostBreakdown} />}{attachmentRows(attachments, sourceCritter)}<span className="tooltip-target">{targetText}</span>{disabledReason && <span className="tooltip-disabled">{disabledReason}</span>}</> : <span className="tooltip-description">Choose a skill.</span>;
  return <GameTooltip label={label.trim()} content={tooltip}><button type="button" className={`skill-tile ${skill ? "" : "empty"} ${selected ? "selected" : ""} ${equipped ? "equipped" : ""} ${!onClick ? "read-only" : ""}`} onClick={onClick} disabled={disabled} aria-disabled={!onClick || undefined} data-combat-control={combatControl ? "true" : undefined} data-combat-focus-role={combatControl ? "skill" : undefined} data-combat-skill-id={combatControl ? combatSkillId : undefined}>
    <span className="skill-title">{skill && <AssetIcon path={elementPath} alt={`${element?.name ?? skill.element_id} element`} fallback={<Sparkles size={16} />} />}<strong>{skill?.name ?? "-----"}</strong></span>
    {skill?.skill_type === "attack" && <span className="skill-power">PWR {skill.power}</span>}
    {skill && <span className={`skill-mana ${actionCostTone(manaCostBreakdown)}`.trim()}><AssetIcon path={manaPath} alt="Mana" fallback={<Gem size={15} />} />{displayedManaCost}</span>}
    {(selected || equipped) && <Check className="selection-check" size={15} />}
  </button></GameTooltip>;
}

function LoadoutRelicSlot({ data, relic, sourceCritter, slotIndex, onClick }: { data: AppData; relic?: Relic | null; sourceCritter?: Critter; slotIndex: number; onClick: () => void }) {
  const attachments = relic ? data.catalog.effectsByRelic[relic.id] ?? [] : [];
  const details = relic ? `${relic.name}. ${relic.description} ${attachmentText(attachments)}` : `Choose a relic for slot ${slotIndex}.`;
  const tooltip = relic ? <><span className="tooltip-heading"><strong>{relic.name}</strong></span><span className="tooltip-description">{relic.description}</span>{attachmentRows(attachments, sourceCritter)}</> : <span className="tooltip-description">Choose a relic for slot {slotIndex}.</span>;
  return <GameTooltip label={details.trim()} content={tooltip}><button type="button" className={`loadout-relic-cell unlocked ${relic ? "equipped" : "empty"}`} onClick={onClick} aria-label={`Equip relic · Slot ${slotIndex}`}>
    {relic
      ? <AssetIcon path={preferredAssetPath(data, "relic", relic.id, relic.asset_path, ["icon", "thumb", "card"])} alt={relic.name} fallback={<Shield aria-hidden="true" />} />
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
    case "all_critters": return "Targets all active Critters, including the user.";
    case "all_others": return "Targets all active Critters except the user.";
    case "single_any": return "Targets one Friendly or Enemy Critter.";
    case "all_friendlies": return "Targets all Friendly Critters.";
    case "all_allies": return "Targets every active Friendly teammate except the user.";
    case "self_only": return "Targets only the acting Critter.";
    default: return "Targets one Enemy Critter.";
  }
}

function effectRequirementState(effect: ResolvedEffectRef, sourceCritter?: Critter): "none" | "unknown" | "active" | "inactive" {
  if (!sourceElementIds(effect).length) return "none";
  if (!sourceCritter) return "unknown";
  return effectMatchesSourceCritter(effect, sourceCritter) ? "active" : "inactive";
}

function attachmentText(effects: ResolvedEffectRef[]): string {
  return effects.filter((effect) => effect.execution !== "child").map((effect) => `${effect.name}: ${effect.description}`).join(" ");
}

function attachmentRows(effects: ResolvedEffectRef[], sourceCritter?: Critter): React.ReactNode {
  return effects.filter((effect) => effect.execution !== "child").map((effect) => {
    const state = effectRequirementState(effect, sourceCritter);
    return <span className={`tooltip-description effect-conditional-row ${state === "inactive" ? "effect-condition-inactive" : ""} effect-classification-${effect.classification ?? "mixed"}`} key={effect.id}><span><strong>{effect.name}:</strong> {effect.description}</span></span>;
  });
}

function EffectList({ effects, className = "", sourceCritter }: { effects: ResolvedEffectRef[]; className?: string; sourceCritter?: Critter }) {
  const visibleEffects = effects.filter((effect) => effect.execution !== "child");
  return (
    <span className={`effect-list ${className}`.trim()}>
      {visibleEffects.length
        ? visibleEffects.map((effect) => {
          const state = effectRequirementState(effect, sourceCritter);
          return <span className={`effect-list-row effect-conditional-row ${state === "inactive" ? "effect-condition-inactive" : ""} effect-classification-${effect.classification ?? "mixed"}`} key={effect.id}><span><strong>{effect.name}:</strong> {effect.description}</span></span>;
        })
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

function useUnlockButtonFlash() {
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  function flash(id: string) {
    setFlashingId(null);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setFlashingId(id);
      flashTimer.current = window.setTimeout(() => {
        setFlashingId(null);
        flashTimer.current = null;
      }, 700);
    }, 0);
  }

  return { flashingId, flash };
}

function EquipDialog({ data, target, saving, error, onClose, onEquip, onUnlockSkill }: { data: AppData; target: EquipTarget; saving: boolean; error: string | null; onClose: () => void; onEquip: (operation: () => Promise<void>) => void; onUnlockSkill: (owned: UserCritter, skillId: string) => Promise<void> }) {
  const player = data.player!;
  const title = target.type === "rollcaster" ? "Choose active Rollcaster" : `Equip ${target.type} · Slot ${target.slotIndex}`;
  const [query, setQuery] = useState("");
  const { flashingId, flash } = useUnlockButtonFlash();
  useEffect(() => setQuery(""), [target.type, target.slotIndex]);
  const normalizedQuery = query.trim().toLowerCase();
  const currentSkillOwner = target.type === "skill"
    ? player.critters.find((owned) => owned.id === target.owned.id) ?? target.owned
    : null;
  let content: React.ReactNode;

  if (target.type === "critter") {
    const assigned = new Set(player.squadSlots.map((row) => row.user_critter_id).filter(Boolean));
    const eligible = sortByCollectibleId(player.critters, (owned) => owned.critter_id);
    const current = player.squadSlots.find((row) => row.slot_index === target.slotIndex)?.user_critter_id;
    const equipSlotIndex = nextOpenSquadSlot(player.squadSlots, target.slotIndex);
    const changeSquadSlot = async (slotIndex: number, userCritterId: string | null) => {
      const previousUserCritterId = player.squadSlots.find((row) => row.slot_index === slotIndex)?.user_critter_id;
      await setSquadSlot(slotIndex, userCritterId);
      const critterIdsToClear = new Set(
        [previousUserCritterId, userCritterId].filter((id): id is string => Boolean(id)),
      );
      for (const critterId of critterIdsToClear) {
        for (const relicSlot of player.relicSlots
          .filter((row) => row.user_critter_id === critterId && row.relic_id)
          .sort((left, right) => left.slot_index - right.slot_index)) {
          await setCritterRelicSlot(critterId, relicSlot.slot_index, null);
        }
      }
    };
    const canRemoveCurrent = player.squadSlots.filter((row) => row.user_critter_id).length > 1;
    content = eligible.length ? <div className="candidate-grid">{eligible.map((owned) => {
      const critter = byId(data.catalog.critters, owned.critter_id)!;
      const selected = current === owned.id;
      const inSquad = assigned.has(owned.id);
      const disabled = saving || (inSquad && !selected) || (selected && !canRemoveCurrent);
      return <button className={`candidate-card ${selected ? "selected" : ""} ${inSquad && !selected ? "in-squad" : ""}`} key={owned.id} disabled={disabled} onClick={() => onEquip(() => changeSquadSlot(selected ? target.slotIndex : equipSlotIndex, selected ? null : owned.id))}>
        <SpriteFrame size="md" selected={selected}><Sprite name={critter.name} element={critter.element_1_id} assetPath={preferredAssetPath(data, "critter", critter.id, critter.asset_path, ["card", "thumb"])} /></SpriteFrame>
        <CritterName data={data} critter={critter} /><span>Level {owned.level}</span>{selected ? <span className="state-badge remove-badge">Select again to remove</span> : inSquad && <span className="state-badge"><Check size={14} /> In squad</span>}
      </button>;
    })}</div> : <p className="empty-state">No critters available</p>;
  } else if (target.type === "skill") {
    const skillOwner = currentSkillOwner!;
    const ids = player.unlockedSkillIdsByCritter[skillOwner.id] ?? [];
    const unlockedIds = new Set(ids);
    const rows = player.skillSlots.filter((row) => row.user_critter_id === skillOwner.id);
    const current = rows.find((row) => row.slot_index === target.slotIndex)?.skill_id;
    const equippedElsewhere = new Set(rows.filter((row) => row.slot_index !== target.slotIndex && row.skill_id).map((row) => row.skill_id));
    const equippedCount = rows.filter((row) => row.skill_id).length;
    const eligible = data.catalog.critterSkillUnlocks
      .filter((unlock) => unlock.critter_id === skillOwner.critter_id)
      .map((unlock) => ({ skill: byId(data.catalog.skills, unlock.skill_id), unlock }))
      .filter((candidate): candidate is { skill: Skill; unlock: typeof data.catalog.critterSkillUnlocks[number] } => Boolean(candidate.skill))
      .filter(({ skill }) => {
        const element = byId(data.catalog.elements, skill.element_id);
        return !normalizedQuery || `${skill.name} ${skill.element_id} ${element?.name ?? ""}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) =>
      (left.unlock?.unlock_level ?? 0) - (right.unlock?.unlock_level ?? 0) ||
      (left.unlock?.sort_order ?? left.skill.sort_order) - (right.unlock?.sort_order ?? right.skill.sort_order) ||
      left.skill.id.localeCompare(right.skill.id),
      );
    const unlockedEligible = eligible.filter(({ skill }) => unlockedIds.has(skill.id));
    const lockedEligible = eligible.filter(({ skill }) => !unlockedIds.has(skill.id));
    const renderSkill = ({ skill, unlock }: { skill: Skill; unlock: typeof data.catalog.critterSkillUnlocks[number] }) => {
      const selected = current === skill.id;
      const equipped = selected || equippedElsewhere.has(skill.id);
      const cannotRemoveLast = selected && equippedCount <= 1;
      const locked = !unlockedIds.has(skill.id);
      const levelEligible = skillOwner.level >= unlock.unlock_level;
      const unlockCost = unlock?.unlock_cost ?? 0;
      const canUnlock = !locked || (levelEligible && skillOwner.skill_points >= unlockCost);
      const disabledReason = cannotRemoveLast
        ? "At least one skill must remain equipped."
        : equippedElsewhere.has(skill.id)
          ? "Equipped in another slot."
          : locked && !levelEligible
            ? `Unlocks at level ${unlock.unlock_level}.`
            : locked && !canUnlock
              ? "Need " + (unlockCost - skillOwner.skill_points) + " more skill point" + (unlockCost - skillOwner.skill_points === 1 ? "" : "s") + "."
            : undefined;
      const tile = <SkillTile
        data={data}
        skill={skill}
        sourceCritter={byId(data.catalog.critters, skillOwner.critter_id)}
        selected={selected}
        equipped={equipped}
        disabled={saving || locked || equippedElsewhere.has(skill.id) || cannotRemoveLast}
        disabledReason={disabledReason}
        onClick={locked ? undefined : () => onEquip(() => setCritterSkillSlot(skillOwner.id, target.slotIndex, selected ? null : skill.id))}
      />;
      if (locked) {
        return <div className={`equip-skill-option locked ${levelEligible ? "unlockable" : "level-locked"}`.trim()} key={skill.id}>
          {tile}
          <div className="equip-skill-unlock-row">
            <span className="equip-skill-unlock-requirement">Unlock at level {unlock.unlock_level} · {unlock.unlock_cost} point{unlock.unlock_cost === 1 ? "" : "s"}</span>
            {levelEligible && <button
                type="button"
                className={`primary-button skill-unlock-button ${flashingId === skill.id ? "insufficient-points" : ""}`.trim()}
                disabled={saving}
                title={!canUnlock ? disabledReason : undefined}
                onClick={() => {
                  if (!canUnlock) {
                    flash(skill.id);
                    return;
                  }
                  void onUnlockSkill(skillOwner, skill.id);
                }}
              >Unlock · {unlock.unlock_cost}</button>}
          </div>
        </div>;
      }
      return tile;
    };
    content = eligible.length ? <div className="equip-skill-sections">
      {unlockedEligible.length > 0 && <section className="equip-skill-section" aria-label="Unlocked skills">
        <p className="equip-skill-section-label">Unlocked skills</p>
        <SkillTileGrid ariaLabel="Unlocked skills">{unlockedEligible.map(renderSkill)}</SkillTileGrid>
      </section>}
      {lockedEligible.length > 0 && <section className="equip-skill-section" aria-label="Locked skills">
        <p className="equip-skill-section-label">Locked skills</p>
        {unlockedEligible.length > 0 && <div className="equip-skill-divider" role="separator" aria-label="Locked skills divider" />}
        <SkillTileGrid ariaLabel="Locked skills">{lockedEligible.map(renderSkill)}</SkillTileGrid>
      </section>}
    </div> : <p className="empty-state">No skills available</p>;
  } else if (target.type === "relic") {
    const current = player.relicSlots.find((row) => row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)?.relic_id;
    const equippedByCritter = equippedRelicIdsForCritter(player.relicSlots, target.owned.id);
    const eligible = sortByCollectibleId(data.catalog.relics)
      .filter((relic) => collectibleIsUnlocked(data, "relic", relic.id))
      .filter((relic) => !normalizedQuery || relic.name.toLowerCase().includes(normalizedQuery));
    content = eligible.length ? <div className="candidate-grid">{eligible.map((relic) => {
      const owned = player.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
      const used = player.relicSlots.filter((row) => row.relic_id === relic.id).length;
      const selected = current === relic.id;
      const available = Math.max(0, owned - used);
      const unavailable = available <= 0 || equippedByCritter.has(relic.id);
      const effects = data.catalog.effectsByRelic[relic.id] ?? [];
      const sourceCritter = byId(data.catalog.critters, target.owned.critter_id);
      const details = `${relic.name}. ${relic.description} ${attachmentText(effects)}`.trim();
      return <GameTooltip key={relic.id} label={details} content={<><span className="tooltip-heading"><strong>{relic.name}</strong></span><span className="tooltip-description">{relic.description}</span>{attachmentRows(effects, sourceCritter)}</>}>
        <button className={`candidate-card relic-candidate ${selected ? "selected" : ""} ${unavailable ? "unavailable" : ""}`} disabled={saving || selected || unavailable} onClick={() => {
          if (unavailable) return;
          onEquip(() => setCritterRelicSlot(target.owned.id, target.slotIndex, relic.id));
        }}>
          <SpriteFrame size="md" selected={selected}><Sprite name={relic.name} element="metal" assetPath={preferredAssetPath(data, "relic", relic.id, relic.asset_path, ["card", "thumb", "icon"])} /></SpriteFrame><strong>{relic.name}</strong><span className="inventory-count relic-availability">Available: {available}</span>
        </button>
      </GameTooltip>;
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
      return <button className={`candidate-card ${selected ? "selected" : ""}`} key={owned.id} disabled={saving || selected} onClick={() => onEquip(() => setActiveRollcaster(owned.id))}><SpriteFrame size="lg" selected={selected}><Sprite name={entry.name} element="basic" assetPath={preferredAssetPath(data, "rollcaster", entry.id, entry.asset_path, ["portrait", "card", "thumb"])} size="large" fit="portrait" /></SpriteFrame><strong>{entry.name}</strong><span>Level {owned.level}</span></button>;
    })}</div>;
  }

  const currentRelic = target.type === "relic" ? player.relicSlots.find((row) => row.user_critter_id === target.owned.id && row.slot_index === target.slotIndex)?.relic_id : null;
  const currentAbility = target.type === "ability" ? player.abilitySlots.find((row) => row.user_rollcaster_id === target.owned.id && row.slot_index === target.slotIndex)?.ability_id : null;
  const canUnequip = (target.type === "relic" && Boolean(currentRelic)) || (target.type === "critter" && player.squadSlots.filter((row) => row.user_critter_id).length > 1) || (target.type === "skill" && player.skillSlots.filter((row) => row.user_critter_id === target.owned.id && row.skill_id).length > 1) || (target.type === "ability" && Boolean(currentAbility));
  const clear = target.type === "critter" ? () => setSquadSlot(target.slotIndex, null) : target.type === "skill" ? () => setCritterSkillSlot(target.owned.id, target.slotIndex, null) : target.type === "relic" ? () => setCritterRelicSlot(target.owned.id, target.slotIndex, null) : target.type === "ability" ? () => setRollcasterAbilitySlot(target.owned.id, target.slotIndex, null) : null;
  return <Modal className={target.type === "skill" ? "equip-dialog equip-dialog-skill" : target.type === "relic" ? "equip-dialog equip-dialog-relic" : "equip-dialog"} title={title} description={target.type === "skill" ? "Choose an unlocked skill or unlock one available at this Critter's level." : "Choose an eligible item for this loadout slot."} onClose={onClose}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {target.type === "skill" && currentSkillOwner && <div className="equip-dialog-point-summary"><PointCounter kind="skill" points={currentSkillOwner.skill_points} inline /></div>}
    {(target.type === "skill" || target.type === "relic") && <label className="equip-search"><Search size={18} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={target.type === "skill" ? "Search skills by name or Element…" : "Search Relics by name…"} aria-label={target.type === "skill" ? "Search skills by name or element" : "Search relics by name"} /></label>}
    {target.type === "skill" ? <div className="equip-skill-list">{content}</div> : content}
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
  const cardMeasurementRef = useRef<HTMLDivElement>(null);
  const [collectionCardHeight, setCollectionCardHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const measurementGrid = cardMeasurementRef.current;
    if (!measurementGrid) return;
    const updateCardHeight = () => {
      const cardHeights = [...measurementGrid.querySelectorAll<HTMLElement>(".catalog-card")].map((card) => card.getBoundingClientRect().height);
      const tallestCard = Math.ceil(Math.max(0, ...cardHeights));
      setCollectionCardHeight((current) => current === tallestCard ? current : tallestCard);
    };
    updateCardHeight();
    const resizeObserver = new ResizeObserver(updateCardHeight);
    resizeObserver.observe(measurementGrid);
    measurementGrid.querySelectorAll<HTMLElement>(".catalog-card").forEach((card) => resizeObserver.observe(card));
    return () => resizeObserver.disconnect();
  }, [data]);

  const collectionGridStyle = collectionCardHeight
    ? { "--collection-card-height": `${collectionCardHeight}px` } as CSSProperties
    : undefined;

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
      <div className="collection-grid-content" style={collectionGridStyle}>
        {tab === "rollcasters" && <RollcasterGrid data={data} rollcasters={rollcasters} setDetail={setDetail} onRefresh={onRefresh} />}
        {tab === "critters" && <CritterGrid data={data} critters={critters} setDetail={setDetail} onRefresh={onRefresh} />}
        {tab === "relics" && <RelicGrid data={data} relics={relics} setDetail={setDetail} onRefresh={onRefresh} />}
        {displayedCount === 0 && <p className="collection-empty">No {tab} match the current filters.</p>}

        <div ref={cardMeasurementRef} className="collection-grid collection-card-measurement" aria-hidden="true">
          <RollcasterGrid measurement data={data} rollcasters={data.catalog.rollcasters} setDetail={setDetail} onRefresh={onRefresh} />
          <CritterGrid measurement data={data} critters={data.catalog.critters} setDetail={setDetail} onRefresh={onRefresh} />
          <RelicGrid measurement data={data} relics={data.catalog.relics} setDetail={setDetail} onRefresh={onRefresh} />
        </div>
      </div>
      {detail && <DetailModal data={data} detail={detail} onRefresh={onRefresh} onClose={() => setDetail(null)} />}
    </section>
  );
}

function BagScreen({
  data,
  tab,
  setTab,
  onBack,
  onRefresh,
  onBeforeOpenLootbox,
  onPurchaseError,
}: {
  data: AppData;
  tab: BagTab;
  setTab: (tab: BagTab) => void;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onBeforeOpenLootbox: () => Promise<void>;
  onPurchaseError: (error: unknown) => void;
}) {
  const [selectedLootbox, setSelectedLootbox] = useState<string | null>(null);
  const currencies = orderedCurrencies(data).filter((currency) => currency.id === "coins" || currency.id === "prismite");
  const shardRows = [
    ...data.catalog.critters.map((entry) => ({ type: "critter" as const, entry })),
    ...data.catalog.rollcasters.map((entry) => ({ type: "rollcaster" as const, entry })),
    ...data.catalog.relics.map((entry) => ({ type: "relic" as const, entry })),
  ]
    .filter(({ type, entry }) => shardProgress(data, type, entry.id) > 0n)
    .sort((left, right) => left.type.localeCompare(right.type) || left.entry.id.localeCompare(right.entry.id));
  const groups: Array<{ type: CollectibleType; label: string }> = [
    { type: "critter", label: "Critter Shards" },
    { type: "rollcaster", label: "Rollcaster Shards" },
    { type: "relic", label: "Relic Shards" },
  ];
  const ownedLootboxes = data.player!.collectibleSnapshot.lootboxes.filter((owned) => BigInt(owned.quantity || "0") > 0n);

  return (
    <section className="screen-stack collection-screen bag-screen">
      <div className="screen-heading row">
        <div>
          <h1>Bag</h1>
          <p>Review your currencies, collectible shards, and owned Lootboxes.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>Back</button>
      </div>
      <div className="tabs bag-tabs" role="tablist" aria-label="Bag categories">
        <button role="tab" aria-selected={tab === "currency"} className={tab === "currency" ? "active" : ""} onClick={() => setTab("currency")}>Currency</button>
        <button role="tab" aria-selected={tab === "shards"} className={tab === "shards" ? "active" : ""} onClick={() => setTab("shards")}>Shards</button>
        <button role="tab" aria-selected={tab === "lootboxes"} className={tab === "lootboxes" ? "active" : ""} onClick={() => setTab("lootboxes")}>Lootboxes</button>
      </div>
      {tab === "currency" ? (
        <div className="bag-grid-section bag-grid-headingless">
          <div className="bag-grid-heading-slot" aria-hidden="true" />
          <div className="collection-grid bag-grid bag-currency-grid">
            {currencies.map((currency) => (
              <article className="catalog-card bag-currency-card" key={currency.id} data-currency-id={currency.id}>
                <div className="bag-currency-icon" aria-hidden="true">
                  <AssetIcon path={catalogAssetPath(data, "currency", currency.id, currency.asset_path)} alt="" loading="eager" fallback={currency.id === "prismite" ? <Gem size={72} /> : <Coins size={72} />} />
                </div>
                <div className="card-name-row"><strong>{currency.name}</strong></div>
                <p className="bag-currency-amount">{formatAmount(currencyBalance(data, currency.id))}</p>
              </article>
            ))}
          </div>
        </div>
      ) : tab === "shards" ? (
        <div className="shop-groups bag-shard-groups">
          {groups.map((group) => {
            const grouped = shardRows.filter((row) => row.type === group.type);
            if (!grouped.length) return null;
            return (
              <section className="shop-group bag-grid-section" key={group.type}>
                <h2 className="bag-grid-heading-slot">{group.label}</h2>
                <div className="shop-grid bag-grid bag-shard-grid">
                  {grouped.map(({ type, entry }) => <BagShardCard key={`${type}:${entry.id}`} data={data} type={type} id={entry.id} />)}
                </div>
              </section>
            );
          })}
          {shardRows.length === 0 && <div className="shop-empty"><Gem size={34} /><h2>No shards yet</h2><p>Collectible shards you earn will appear here.</p></div>}
        </div>
      ) : <div className="bag-grid-section bag-grid-headingless">
        <div className="bag-grid-heading-slot" aria-hidden="true" />
        <div className="shop-grid bag-grid lootbox-bag-grid">
          {ownedLootboxes.map((owned) => {
            const lootbox = data.catalog.lootboxes.find((row) => row.id === owned.lootbox_id);
            if (!lootbox) return null;
            const openDetails = () => setSelectedLootbox(lootbox.id);
            return <article
              className="lootbox-bag-card"
              key={lootbox.id}
              tabIndex={0}
              role="button"
              aria-label={`${lootbox.name}, ${formatAmount(owned.quantity)} in Bag`}
              onClick={openDetails}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDetails();
                }
              }}
            >
              <LootboxSprite lootbox={lootbox} variant="closed" />
              <strong>{lootbox.name}</strong><b>×{formatAmount(owned.quantity)}</b>
              <button type="button" className="primary-button lootbox-bag-open" onClick={(event) => { event.stopPropagation(); openDetails(); }}>Open</button>
            </article>;
          })}
          {ownedLootboxes.length === 0 && <div className="shop-empty"><Gift /><h2>No Lootboxes yet</h2><p>Purchased and earned Lootboxes will appear here.</p></div>}
        </div>
      </div>}
      {selectedLootbox && <LootboxModal data={data} lootboxId={selectedLootbox} mode="owned" onBeforeOpen={onBeforeOpenLootbox} onPurchaseError={onPurchaseError} onRefresh={onRefresh} onClose={() => setSelectedLootbox(null)} />}
    </section>
  );
}

function shardUnlockProgress(data: AppData, type: CollectibleType, id: string, current = shardProgress(data, type, id)) {
  const challenge = challengesFor(data, type, id).find((row) => row.challenge_type === "shop_shards");
  const authoredGoal = challenge?.required_amount;
  const goal = authoredGoal && BigInt(authoredGoal) > 0n ? BigInt(authoredGoal) : current;
  return { current, goal };
}

function ShopProgressBar({ current, projected = current, goal, type, showCompletion = false }: { current: bigint; projected?: bigint; goal: bigint; type: "Shards" | "Relics"; showCompletion?: boolean }) {
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

function BagShardCard({ data, type, id }: { data: AppData; type: CollectibleType; id: string }) {
  const targetName = collectibleName(data, type, id);
  const progress = shardUnlockProgress(data, type, id);
  const complete = progress.goal > 0n && progress.current >= progress.goal;
  return (
    <article className={`shop-entry-card bag-shard-card ${complete ? "complete" : ""}`.trim()} data-collectible-type={type} data-collectible-id={id} data-shard-status={complete ? "complete" : "in-progress"}>
      <CollectibleSprite data={data} type={type} id={id} size="md" shard />
      <div className="shop-entry-copy">
        <h3>{targetName}</h3>
        <p className="shop-target">{id}</p>
      </div>
      <ShopProgressBar current={progress.current} goal={progress.goal} type="Shards" showCompletion={complete} />
    </article>
  );
}

function ShopScreen({
  data,
  tab,
  setTab,
  onBack,
  onRefresh,
  onPurchase,
  onPromoStateChange,
  onNotify,
}: {
  data: AppData;
  tab: ShopTab;
  setTab: (tab: ShopTab) => void;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onPurchase: (entry: ShopEntry, quantity: number) => Promise<ShopPurchaseReceipt>;
  onPromoStateChange: (state: PromoRenderState) => void;
  onNotify: (notification: BannerNotification) => void;
}) {
  const [query, setQuery] = useState("");
  const [quantityByEntry, setQuantityByEntry] = useState<Record<string, number>>({});
  const [purchasedLootboxEntries, setPurchasedLootboxEntries] = useState<Set<string>>(() => new Set());
  const [selectedLootboxEntry, setSelectedLootboxEntry] = useState<ShopEntry | null>(null);
  const [selectedLootboxQuantity, setSelectedLootboxQuantity] = useState(1);
  const [purchasingEntryIds, setPurchasingEntryIds] = useState<Set<string>>(() => new Set());
  const purchasingEntryIdsRef = useRef(new Set<string>());
  const normalized = query.trim().toLocaleLowerCase();
  const authoredEntries = data.catalog.shopEntries.filter((entry): entry is Extract<ShopEntry,{ shop_type: "shard" | "relic" }> => (
    tab === "shard" || tab === "relic"
  ) && entry.shop_type === tab);
  const lootboxEntries = data.catalog.shopEntries.filter((entry) => entry.shop_type === "lootbox" && data.catalog.lootboxes.some((lootbox) => lootbox.id === entry.target_id));
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

  function quantityFor(entryId: string): number {
    return quantityByEntry[entryId] ?? 1;
  }

  function setQuantity(entryId: string, raw: string | number) {
    const parsed = Number(raw);
    const quantity = Number.isSafeInteger(parsed) ? Math.max(1, Math.min(9999, parsed)) : 1;
    setQuantityByEntry((current) => ({ ...current, [entryId]: quantity }));
  }

  async function queuePurchase(entry: ShopEntry, quantity: number): Promise<ShopPurchaseReceipt> {
    const safeQuantity = Math.max(1, Math.min(9999, Math.trunc(quantity)));
    if (purchasingEntryIdsRef.current.has(entry.id)) throw new Error("PURCHASE_IN_PROGRESS");
    purchasingEntryIdsRef.current.add(entry.id);
    setPurchasingEntryIds((current) => new Set(current).add(entry.id));
    try {
      return await onPurchase(entry, safeQuantity);
    } catch (error) {
      onNotify(createShopErrorNotification(error));
      throw error;
    } finally {
      purchasingEntryIdsRef.current.delete(entry.id);
      setPurchasingEntryIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
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
        <button role="tab" aria-selected={tab === "lootbox"} className={tab === "lootbox" ? "active" : ""} onClick={() => setTab("lootbox")}>Lootbox Shop</button>
        <button role="tab" aria-selected={tab === "promo"} className={tab === "promo" ? "active" : ""} onClick={() => setTab("promo")}><Ticket size={17} aria-hidden="true" /> Promo Codes</button>
      </div>
      {(tab === "shard" || tab === "relic" || tab === "lootbox") && <label className="collection-search shop-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search shop entries by name or ID</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by offer, name, or ID" /></label>}
      {tab === "promo" ? (
        <PromoCodesPanel
          data={data}
          onRefresh={onRefresh}
          onStateChange={onPromoStateChange}
          onNotify={onNotify}
        />
      ) : tab === "lootbox" ? <div className="shop-grid-section shop-grid-headingless">
        <div className="shop-grid-heading-slot" aria-hidden="true" />
        <div className="shop-grid lootbox-shop-grid">{lootboxEntries.filter((entry) => !normalized || `${entry.name} ${entry.target_id}`.toLocaleLowerCase().includes(normalized)).map((entry) => {
        const lootbox = data.catalog.lootboxes.find((row) => row.id === entry.target_id)!;
        const currency = currencyFor(data, entry.currency_id);
        if (!currency) return null;
        const quantity = Math.min(99, quantityFor(entry.id));
        const availability = shopAvailability(data, entry, quantity);
        const totalPrice = shopPurchasePrice(entry, quantity);
        // Bag ownership is durable inventory state, not an in-progress shop
        // decision. Every visit to the shop should start with Purchase; only
        // the purchase made from this card may temporarily expose the choice
        // to open it or send it to the Bag.
        const purchased = purchasedLootboxEntries.has(entry.id);
        const openDetails = (requestedQuantity = quantity) => {
          setSelectedLootboxQuantity(requestedQuantity);
          setSelectedLootboxEntry(entry);
        };
        return <article
          className={`lootbox-shop-card ${purchased ? "purchased" : ""}`.trim()}
          key={entry.id}
          tabIndex={0}
          role="button"
          aria-label={`${lootbox.name}, ${formatAmount(totalPrice)} ${currency.name}`}
          onClick={() => openDetails()}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openDetails();
            }
          }}
        >
          <button
            type="button"
            className="lootbox-shop-info"
            aria-label={`View ${lootbox.name} details`}
            onClick={(event) => {
              event.stopPropagation();
              openDetails();
            }}
          ><Info size={16} aria-hidden="true" /></button>
          <span
            className="lootbox-card-sprite"
            aria-hidden="true"
          ><LootboxSprite lootbox={lootbox} variant="closed" /></span>
          <strong className="shop-item-name lootbox-shop-name">{lootbox.name}</strong>
          <b className="shop-price lootbox-shop-price"><span>{formatAmount(shopPurchaseItemQuantity(entry, quantity))} x Lootboxes</span><span className="lootbox-price-icon" aria-hidden="true"><AssetIcon path={catalogAssetPath(data,"currency",currency.id,currency.asset_path)} alt="" loading="eager" fallback={<Coins />} /></span><span className="shop-price-cost">{formatAmount(totalPrice)}</span></b>
          <div className="shop-card-progress-slot" aria-hidden="true" />
          <div className="lootbox-shop-actions">
            {purchased ? <>
              <button type="button" className="primary-button" onClick={(event) => { event.stopPropagation(); openDetails(); }}>Open Now</button>
              <button
                type="button"
                className="secondary-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setPurchasedLootboxEntries((current) => {
                    const next = new Set(current);
                    next.delete(entry.id);
                    return next;
                  });
                  // Purchase already placed the box in the Bag. Keep the
                  // acquired row durable, then show the user the saved Bag
                  // item without leaving the shop so they can keep buying.
                  void onRefresh()
                    .catch((refreshFailure) => console.error("Lootbox Bag refresh failed.", refreshFailure))
                }}
              >Send to Bag</button>
            </> : <div className="shop-purchase-row">
              <ShopQuantityControl label={`Quantity of ${lootbox.name}`} quantity={quantity} max={99} onChange={(next) => setQuantity(entry.id, next)} onClick={(event) => event.stopPropagation()} />
              <button
                className="primary-button shop-purchase"
                disabled={!availability.enabled}
                onClick={(event) => {
                  event.stopPropagation();
                  openDetails(quantity);
                }}
              >Purchase</button>
            </div>}
          </div>
        </article>;
        })}{lootboxEntries.length===0 && <ShopEmptyState hasAuthoredEntries={false} />}</div>
      </div> : tab === "shard" ? (
        <div className="shop-groups">
          {groups.map((group) => {
            const grouped = entries.filter((entry) => entry.target_category === group.type);
            if (!grouped.length) return null;
            return <section className="shop-group shop-grid-section" key={group.type}><h2 className="shop-grid-heading-slot">{group.label}</h2><div className="shop-grid">{grouped.map((entry) => <ShopEntryCard key={entry.id} data={data} entry={entry} quantity={quantityFor(entry.id)} busy={purchasingEntryIds.has(entry.id)} onQuantityChange={(value) => setQuantity(entry.id, value)} onPurchase={() => { void queuePurchase(entry, quantityFor(entry.id)).catch(() => undefined); }} />)}</div></section>;
          })}
          {entries.length === 0 && <ShopEmptyState hasAuthoredEntries={validEntries.length > 0} />}
        </div>
      ) : <div className="shop-grid-section shop-grid-headingless">
        <div className="shop-grid-heading-slot" aria-hidden="true" />
        <div className="shop-grid">{entries.map((entry) => <ShopEntryCard key={entry.id} data={data} entry={entry} quantity={quantityFor(entry.id)} busy={purchasingEntryIds.has(entry.id)} onQuantityChange={(value) => setQuantity(entry.id, value)} onPurchase={() => { void queuePurchase(entry, quantityFor(entry.id)).catch(() => undefined); }} />)}{entries.length === 0 && <ShopEmptyState hasAuthoredEntries={validEntries.length > 0} />}</div>
      </div>}
      {selectedLootboxEntry && <LootboxModal
        data={data}
        lootboxId={selectedLootboxEntry.target_id}
        mode="purchase"
        initialPurchased={purchasedLootboxEntries.has(selectedLootboxEntry.id)}
        shopEntry={selectedLootboxEntry}
        purchaseQuantity={selectedLootboxQuantity}
        onPurchaseRequested={(quantity) => queuePurchase(selectedLootboxEntry, quantity)}
        onBeforeOpen={async () => undefined}
        onPurchaseError={(purchaseFailure) => onNotify(createShopErrorNotification(purchaseFailure))}
        onRefresh={onRefresh}
        onPurchased={() => setPurchasedLootboxEntries((current) => new Set(current).add(selectedLootboxEntry.id))}
        onPurchaseFailed={() => setPurchasedLootboxEntries((current) => {
          const next = new Set(current);
          next.delete(selectedLootboxEntry.id);
          return next;
        })}
        onOpened={() => setPurchasedLootboxEntries((current) => {
          const next = new Set(current);
          next.delete(selectedLootboxEntry.id);
          return next;
        })}
        onClose={() => {
          setSelectedLootboxEntry(null);
        }}
      />}
    </section>
  );
}

type LootboxModalPhase = "idle" | "shaking" | "opened" | "reel" | "result";

function LootboxSprite({ lootbox, variant, className = "" }: { lootbox: Lootbox; variant: "closed" | "open"; className?: string }) {
  const path = variant === "closed" ? lootbox.closed_asset_path : lootbox.open_asset_path;
  return <span className={`lootbox-sprite ${variant} ${className}`.trim()}><span className="lootbox-sprite-fallback" aria-hidden="true">{variant === "closed" ? <Gift /> : <Sparkles />}</span><AssetIcon path={path} alt={`${lootbox.name} ${variant}`} loading="eager" fallback={null} /></span>;
}

function LootboxPoolArt({ data, entry }: { data: AppData; entry: LootboxPoolEntry }) {
  if (entry.reward_type === "currency") {
    const currency = currencyFor(data, entry.target_id);
    return <span className="lootbox-pool-art"><SpriteFrame size="sm"><AssetIcon path={currency ? catalogAssetPath(data,"currency",currency.id,currency.asset_path) : null} alt="" fallback={<Coins />} /></SpriteFrame></span>;
  }
  if (entry.reward_type === "lootbox") {
    const lootbox = data.catalog.lootboxes.find((row) => row.id === entry.target_id);
    return <span className="lootbox-pool-art">{lootbox ? <LootboxSprite lootbox={lootbox} variant="closed" /> : <SpriteFrame size="sm"><Gift /></SpriteFrame>}</span>;
  }
  if (entry.reward_type === "shard" && entry.target_category && entry.target_category !== "lootbox") {
    return <span className="lootbox-pool-art lootbox-pool-shard-art"><CollectibleSprite data={data} type={entry.target_category} id={entry.target_id} size="sm" shard /></span>;
  }
  const relic = byId(data.catalog.relics, entry.target_id);
  return <span className="lootbox-pool-art"><SpriteFrame size="sm"><Sprite name={relic?.name ?? entry.target_id} element="metal" assetPath={relic ? preferredAssetPath(data, "relic", relic.id, relic.asset_path, ["thumb", "icon", "card"]) : null} size="small" /></SpriteFrame></span>;
}

function lootboxPoolEntryName(data: AppData, entry: LootboxPoolEntry): string {
  if (entry.reward_type === "currency") return currencyFor(data, entry.target_id)?.name ?? entry.target_id;
  if (entry.reward_type === "lootbox") return data.catalog.lootboxes.find((row) => row.id === entry.target_id)?.name ?? entry.target_id;
  if (entry.reward_type === "shard" && entry.target_category && entry.target_category !== "lootbox") return `${collectibleName(data,entry.target_category,entry.target_id)} Shards`;
  return collectibleName(data,"relic",entry.target_id);
}

function lootboxRewardName(data: AppData, receipt: LootboxOpeningReceipt, winningEntry?: LootboxPoolEntry): string {
  if (winningEntry) return lootboxPoolEntryName(data, winningEntry);
  if (receipt.reward.type === "shard" && receipt.reward.targetCategory && receipt.reward.targetCategory !== "lootbox") {
    return `${receipt.reward.name} Shards`;
  }
  return receipt.reward.name;
}

function lootboxQuantity(data: AppData, lootboxId: string): bigint {
  return safeBigInt(data.player?.collectibleSnapshot.lootboxes.find((row) => row.lootbox_id === lootboxId)?.quantity);
}

type LootboxRewardProgressState = {
  kind: "shard" | "relic";
  current: bigint;
  max: bigint;
  final: bigint;
};

function lootboxRewardProgress(data: AppData, reward: LootboxOpeningReceipt["reward"]): LootboxRewardProgressState | null {
  const granted = safeBigInt(reward.granted);
  if (reward.type === "shard" && reward.targetCategory && reward.targetCategory !== "lootbox") {
    const challenge = challengesFor(data, reward.targetCategory, reward.targetId).find((row) => row.challenge_type === "shop_shards");
    const max = safeBigInt(challenge?.required_amount);
    if (max <= 0n) return null;
    const current = shardProgress(data, reward.targetCategory, reward.targetId) > max
      ? max
      : shardProgress(data, reward.targetCategory, reward.targetId);
    return { kind: "shard", current, max, final: current + granted > max ? max : current + granted };
  }
  if (reward.type === "relic") {
    const max = safeBigInt(data.catalog.relics.find((relic) => relic.id === reward.targetId)?.max_owned);
    if (max <= 0n) return null;
    const owned = safeBigInt(data.player?.relicInventory.find((row) => row.relic_id === reward.targetId)?.quantity);
    const current = owned > max ? max : owned;
    return { kind: "relic", current, max, final: current + granted > max ? max : current + granted };
  }
  return null;
}

function LootboxRewardProgress({ data, progress, duplicateAmount, duplicateCurrency, convertedCurrencyAmount }: {
  data: AppData;
  progress: LootboxRewardProgressState;
  duplicateAmount: bigint;
  duplicateCurrency: CurrencyDef | null | undefined;
  convertedCurrencyAmount: string;
}) {
  const [visualCurrent, setVisualCurrent] = useState(progress.current);
  const percentageFor = (value: bigint) => progress.max > 0n
    ? Math.min(100, Number((value * 10000n) / progress.max) / 100)
    : 100;
  const [visualPercent, setVisualPercent] = useState(() => percentageFor(progress.current));
  const [shaking, setShaking] = useState(false);
  const animationKey = `${progress.current}:${progress.final}:${progress.max}:${duplicateAmount}`;
  useEffect(() => {
    let frame = 0;
    let shakeTimer = 0;
    let cancelled = false;
    const start = progress.current;
    const span = progress.final - start;
    const duration = span > 0n ? 1200 : 180;
    const startPercent = percentageFor(start);
    const finalPercent = percentageFor(progress.final);
    const startedAt = performance.now();
    setVisualCurrent(start);
    setVisualPercent(startPercent);
    setShaking(false);

    const animate = (now: number) => {
      if (cancelled) return;
      const pct = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - pct, 3);
      const scaled = BigInt(Math.round(eased * 1000));
      setVisualCurrent(start + (span * scaled) / 1000n);
      setVisualPercent(startPercent + (finalPercent - startPercent) * eased);
      if (pct < 1) {
        frame = window.requestAnimationFrame(animate);
        return;
      }
      setVisualCurrent(progress.final);
      setVisualPercent(finalPercent);
      if (duplicateAmount > 0n) {
        setShaking(true);
        shakeTimer = window.setTimeout(() => setShaking(false), 900);
      }
    };

    frame = window.requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(shakeTimer);
    };
  }, [animationKey, duplicateAmount, progress.current, progress.final]);

  const label = progress.kind === "shard" ? "Shards" : "Relics";
  const capped = duplicateAmount > 0n || progress.final >= progress.max;
  return <div className={`lootbox-reward-progress ${capped ? "at-cap" : ""} ${shaking ? "duplicate-shaking" : ""}`.trim()} data-lootbox-reward-progress={progress.kind} data-lootbox-reward-capped={capped ? "true" : "false"}>
    <div className="lootbox-reward-progress-heading"><span>{progress.kind === "shard" ? "Shard progress" : "Relic ownership"}</span><strong>{formatAmount(visualCurrent)} / {formatAmount(progress.max)} {label}</strong></div>
    <div className="xp-bar" role="progressbar" aria-label={`${label} reward progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={visualPercent} aria-valuetext={`${formatAmount(visualCurrent)} / ${formatAmount(progress.max)} ${label}`}><span style={{ width: `${visualPercent}%` }} /></div>
    {duplicateAmount > 0n && <div className="lootbox-duplicate-conversion lootbox-progress-duplicate">
      <span className="lootbox-duplicate-currency" aria-hidden="true">
        <AssetIcon path={duplicateCurrency ? catalogAssetPath(data, "currency", duplicateCurrency.id, duplicateCurrency.asset_path) : null} alt="" loading="eager" fallback={<Coins />} />
      </span>
      <strong>+{formatAmount(convertedCurrencyAmount)} {duplicateCurrency?.name ?? "currency"}</strong>
      <small>{formatAmount(duplicateAmount)} duplicate {label.toLowerCase()} converted</small>
    </div>}
  </div>;
}

function LootboxModal({ data, lootboxId, mode, initialPurchased = false, shopEntry, purchaseQuantity = 1, onPurchaseRequested, onBeforeOpen, onPurchaseError, onRefresh, onPurchased, onPurchaseFailed, onOpened, onClose }: {
  data: AppData;
  lootboxId: string;
  mode: "purchase" | "owned";
  initialPurchased?: boolean;
  shopEntry?: ShopEntry;
  purchaseQuantity?: number;
  onPurchaseRequested?: (quantity: number) => Promise<ShopPurchaseReceipt>;
  onBeforeOpen?: () => Promise<void>;
  onPurchaseError?: (error: unknown) => void;
  onRefresh: () => Promise<void>;
  onPurchased?: () => void;
  onPurchaseFailed?: () => void;
  onOpened?: () => void;
  onClose: () => void;
}) {
  const lootbox = data.catalog.lootboxes.find((row) => row.id === lootboxId);
  const pool = data.catalog.lootboxPoolEntries.filter((entry) => entry.lootbox_id === lootboxId).sort((left,right) => left.sort_order-right.sort_order);
  const [purchased, setPurchased] = useState(mode === "owned" || initialPurchased);
  const [selectedPurchaseQuantity, setSelectedPurchaseQuantity] = useState(purchaseQuantity);
  const [purchasePending, setPurchasePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialBagQuantity = lootboxQuantity(data, lootboxId);
  const startingBagQuantityRef = useRef(initialBagQuantity);
  const [availableToOpen, setAvailableToOpen] = useState<bigint | null>(() => mode === "owned" || initialPurchased ? initialBagQuantity : null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<LootboxModalPhase>("idle");
  const [receipt, setReceipt] = useState<LootboxOpeningReceipt | null>(null);
  const [rewardProgress, setRewardProgress] = useState<LootboxRewardProgressState | null>(null);
  const [reelTarget, setReelTarget] = useState<number | null>(null);
  const openingRequest = useRef(createRequestId());
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const reelViewportRef = useRef<HTMLDivElement>(null);
  const reelTrackRef = useRef<HTMLDivElement>(null);
  const reelAnimationRef = useRef<Animation | null>(null);
  const timers = useRef<number[]>([]);
  const canOpen = purchased && !purchasePending && phase === "idle" && !busy && (availableToOpen === null || availableToOpen > 0n);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    reelAnimationRef.current?.cancel();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.lootboxOpeningPhase = phase;
    window.dispatchEvent(new CustomEvent("rollcasters:lootbox-phase", { detail: phase }));
    return () => {
      delete document.documentElement.dataset.lootboxOpeningPhase;
      window.dispatchEvent(new CustomEvent("rollcasters:lootbox-phase", { detail: "closed" }));
    };
  }, [phase]);

  async function purchaseBox() {
    if (!shopEntry || !onPurchaseRequested || busy || purchasePending) return;
    setError(null);
    setPurchasePending(true);
    try {
      const receipt = await onPurchaseRequested(selectedPurchaseQuantity);
      setPurchased(true);
      setAvailableToOpen(startingBagQuantityRef.current + safeBigInt(receipt.granted));
      onPurchased?.();
    } catch (purchaseFailure) {
      const partialReceipt = partialShopPurchaseReceipt(purchaseFailure);
      if (partialReceipt) {
        setPurchased(true);
        setAvailableToOpen(startingBagQuantityRef.current + safeBigInt(partialReceipt.granted));
        onPurchased?.();
        return;
      }
      setPurchased(false);
      onPurchaseFailed?.();
    } finally {
      setPurchasePending(false);
    }
  }

  async function openBox(force = false) {
    if ((!force && !canOpen) || !lootbox || (availableToOpen !== null && availableToOpen <= 0n)) return;
    setBusy(true); setError(null);
    try {
      try {
        await onBeforeOpen?.();
      } catch (purchaseFailure) {
        onPurchaseError?.(purchaseFailure);
        return;
      }
      const opening = await openLootbox(lootbox.id, openingRequest.current);
      openingRequest.current = createRequestId();
      setAvailableToOpen((current) => current === null ? null : current > 0n ? current - 1n : 0n);
      setRewardProgress(lootboxRewardProgress(data, opening.reward));
      setReceipt(opening);
      // The opening RPC consumes the Bag item and grants the reward in one
      // idempotent transaction. Update the shop affordance before the visual
      // sequence starts so an animation can never represent an uncommitted
      // reward or leave a stale Open Now button behind.
      onOpened?.();
      // The RPC has already consumed the box and granted the reward atomically.
      // Refresh the view in the background so network latency never delays the
      // opening animation or creates a window where a second open is possible.
      void onRefresh().catch((refreshFailure) => console.error("Lootbox opening succeeded but refresh failed.", refreshFailure));
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
      setPhase("shaking");
      timers.current.push(window.setTimeout(() => setPhase("opened"),650));
      timers.current.push(window.setTimeout(() => setPhase("reel"),950));
    } catch (openingFailure) {
      const openingErrorMessage = errorMessage(openingFailure, "Unable to open this Lootbox.");
      if (/purchase_shop_entries|purchase_shop_entry|purchase could not be completed/i.test(openingErrorMessage)) {
        onPurchaseError?.(openingFailure);
        return;
      }
      setError(openingErrorMessage);
    } finally { setBusy(false); }
  }

  function openAnother() {
    if (busy || availableToOpen === null || availableToOpen <= 0n) return;
    void openBox(true);
  }

  function sendToBag() {
    if (busy) return;
    // Purchase completion already persisted every acquired box in the Bag.
    onOpened?.();
    onClose();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== "Space" || event.repeat || target?.matches("input,textarea,select,button,[contenteditable=true]")) return;
      if (canOpen) { event.preventDefault(); void openBox(); }
    };
    window.addEventListener("keydown",onKey);
    return () => window.removeEventListener("keydown",onKey);
  }, [canOpen,lootbox?.id]);

  useEffect(() => {
    if (purchased && phase === "idle" && !busy) {
      requestAnimationFrame(() => openButtonRef.current?.focus());
    }
  }, [purchased, phase, busy]);

  const currency = shopEntry ? currencyFor(data,shopEntry.currency_id) : null;
  const winningEntry = receipt ? pool.find((entry) => entry.id === receipt.reward.poolEntryId) : undefined;
  const reelWinnerIndex = 34;
  const poolKey = pool.map((entry) => entry.id).join("|");
  const reel = useMemo(() => Array.from({ length: 40 },(_,index) => {
    const seedText = `${receipt?.openingId ?? lootboxId}:${index}`;
    let seed = 2166136261;
    for (let charIndex = 0; charIndex < seedText.length; charIndex += 1) {
      seed ^= seedText.charCodeAt(charIndex);
      seed = Math.imul(seed, 16777619);
    }
    const random = () => {
      seed += 0x6D2B79F5;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    const entry = index===reelWinnerIndex && winningEntry ? winningEntry : pool[Math.floor(random()*Math.max(1,pool.length))] ?? winningEntry;
    const amount = index===reelWinnerIndex && receipt ? Number(receipt.reward.amount) : entry ? entry.min_amount+Math.floor(random()*(entry.max_amount-entry.min_amount+1)) : 1;
    return { entry,amount,index };
  }).filter((item): item is { entry: LootboxPoolEntry; amount: number; index: number } => Boolean(item.entry)),[receipt?.openingId,lootboxId,winningEntry?.id,poolKey]);
  useLayoutEffect(() => {
    if (phase === "idle" || phase === "shaking" || phase === "opened") {
      setReelTarget(null);
      return;
    }
    if (phase !== "reel") return;
    const viewport = reelViewportRef.current;
    const track = reelTrackRef.current;
    const winner = track?.querySelector<HTMLElement>(".lootbox-reel-cell.winner");
    if (!viewport || !track || !winner) return;
    const viewportBounds = viewport.getBoundingClientRect();
    const winnerBounds = winner.getBoundingClientRect();
    const target = viewportBounds.left + viewportBounds.width / 2 - (winnerBounds.left + winnerBounds.width / 2);
    setReelTarget(Math.round(target));
  }, [phase,reel.length,receipt?.openingId]);
  useEffect(() => {
    reelAnimationRef.current?.cancel();
    reelAnimationRef.current = null;
    if (phase !== "reel" || reelTarget === null) return;
    const track = reelTrackRef.current;
    if (!track) return;
    track.style.transform = "translate3d(0,0,0)";
    const animation = track.animate(
      [
        { transform: "translate3d(0,0,0)" },
        { transform: `translate3d(${reelTarget}px,0,0)` },
      ],
      { duration: 6800, easing: "cubic-bezier(.16,.76,.2,1)", fill: "forwards" },
    );
    animation.onfinish = () => {
      track.style.transform = `translate3d(${reelTarget}px,0,0)`;
      if (phase === "reel") setPhase("result");
    };
    reelAnimationRef.current = animation;
    return () => {
      animation.cancel();
      if (reelAnimationRef.current === animation) reelAnimationRef.current = null;
    };
  }, [phase,reelTarget]);
  if (!lootbox) return null;
  const showingAnimation = phase !== "idle";
  const duplicateUnits = BigInt(receipt?.reward.discarded ?? "0");
  const duplicateCurrency = receipt ? currencyFor(data, receipt.reward.dupeCurrencyId ?? "") : null;
  const rewardName = receipt ? lootboxRewardName(data, receipt, winningEntry) : null;
  return <div className="modal-backdrop lootbox-modal-backdrop" onMouseDown={showingAnimation ? undefined : onClose}>
    <section className={`lootbox-modal phase-${phase}`} role="dialog" aria-modal="true" aria-label={lootbox.name} onMouseDown={(event) => event.stopPropagation()}>
      {!showingAnimation && <button className="modal-close" aria-label="Close" onClick={onClose}><X /></button>}
      <header>
        {mode === "purchase" && <div className="lootbox-modal-currencies" aria-label="Currency balances">
          {orderedCurrencies(data).map((balanceCurrency) => {
            const amount = formatAmount(currencyBalance(data, balanceCurrency.id));
            return <div className="coin-pill currency-pill" key={balanceCurrency.id} data-currency-id={balanceCurrency.id} aria-label={`${balanceCurrency.name}: ${amount}`}>
              <AssetIcon path={catalogAssetPath(data, "currency", balanceCurrency.id, balanceCurrency.asset_path)} alt={balanceCurrency.name} fallback={<Coins size={17} />} />
              <span>{amount}</span>
            </div>;
          })}
        </div>}
        <p className="eyebrow">{mode==="purchase"&&!purchased?"Lootbox Shop":purchased?"Lootbox acquired":"Bag"}</p><h2>{lootbox.name}</h2><p>{lootbox.description}</p>
      </header>
      {showingAnimation ? <div className="lootbox-opening-stage">
        <div className="lootbox-opening-box-slot">
          <button className={`lootbox-click-target ${phase==="shaking"?"shaking":""}`} disabled><LootboxSprite lootbox={lootbox} variant={phase==="shaking"?"closed":"open"} /></button>
        </div>
        <div className="lootbox-opening-reel-slot">
          {(phase==="reel"||phase==="result") && <div ref={reelViewportRef} className={`lootbox-reel ${phase==="result"?"finished":reelTarget === null ? "measuring" : "spinning"}`}><span className="lootbox-reel-center" aria-hidden="true" /><div ref={reelTrackRef} className="lootbox-reel-track" style={{ "--lootbox-reel-target": `${reelTarget ?? 0}px` } as React.CSSProperties}>{reel.map(({entry,amount,index}) => <article className={`lootbox-reel-cell ${index===reelWinnerIndex?"winner":""}`} key={`${index}:${entry.id}`}><LootboxPoolArt data={data} entry={entry} /><strong>×{formatAmount(amount)}</strong><small>{lootboxPoolEntryName(data,entry)}</small></article>)}</div></div>}
        </div>
        <div className="lootbox-opening-result-slot">
          {phase === "result" && receipt && <div className={`lootbox-result ${duplicateUnits > 0n ? "has-duplicate" : ""}`.trim()} data-reward-type={receipt.reward.type}>
            <span>YOU WON</span>
            <h3>x{formatAmount(receipt.reward.amount)} {rewardName}</h3>
            {rewardProgress ? <LootboxRewardProgress data={data} progress={rewardProgress} duplicateAmount={duplicateUnits} duplicateCurrency={duplicateCurrency} convertedCurrencyAmount={receipt.reward.convertedCurrencyAmount} /> : duplicateUnits > 0n && <div className="lootbox-duplicate-conversion">
              <span className="lootbox-duplicate-currency" aria-hidden="true">
                <AssetIcon path={duplicateCurrency ? catalogAssetPath(data, "currency", duplicateCurrency.id, duplicateCurrency.asset_path) : null} alt="" loading="eager" fallback={<Coins />} />
              </span>
              <strong>+{formatAmount(receipt.reward.convertedCurrencyAmount)}</strong>
              <small>{formatAmount(receipt.reward.discarded)} duplicate {receipt.reward.discarded === "1" ? "unit" : "units"} converted to {duplicateCurrency?.name ?? receipt.reward.dupeCurrencyId ?? "currency"}</small>
            </div>}
            <div className="lootbox-result-actions">
              <button className="secondary-button" onClick={onClose}>Back</button>
              {availableToOpen !== null && availableToOpen > 0n && <button className="primary-button" onClick={openAnother}>Open Another ({formatAmount(availableToOpen)} left)</button>}
            </div>
          </div>}
        </div>
      </div> : <>
        <button className="lootbox-click-target" disabled={!canOpen} aria-label={canOpen?`Open ${lootbox.name}`:lootbox.name} onClick={() => void openBox()}><LootboxSprite lootbox={lootbox} variant="closed" /></button>
        {error&&<p className="notice error" role="alert">{error}</p>}
        <footer>{!purchased&&shopEntry&&currency?<div className="lootbox-modal-purchase-stack">
          <div className="shop-price lootbox-modal-purchase-price" aria-live="polite"><span className="shop-purchase-quantity">{formatAmount(selectedPurchaseQuantity)}×</span><AssetIcon path={catalogAssetPath(data,"currency",currency.id,currency.asset_path)} alt={currency.name} loading="eager" fallback={<Coins />} /><span className="shop-price-cost">{formatAmount(shopPurchasePrice(shopEntry, selectedPurchaseQuantity))}</span></div>
          <div className="shop-purchase-row lootbox-modal-purchase-row">
          <ShopQuantityControl label={`Quantity of ${lootbox.name}`} quantity={selectedPurchaseQuantity} max={99} disabled={busy || purchasePending} onChange={setSelectedPurchaseQuantity} />
          <button className="primary-button lootbox-purchase-button" disabled={busy || purchasePending} onClick={() => void purchaseBox()}>Purchase</button>
        </div></div>:<><button ref={openButtonRef} className="primary-button" disabled={!canOpen || busy} onClick={() => void openBox()} aria-keyshortcuts="Space">{busy?"Opening…":purchasePending?"Saving…":"Open Now"}</button>{mode === "purchase" && <button className="secondary-button" disabled={busy || purchasePending} onClick={sendToBag}>Send to Bag</button>}</>}</footer>
        <section className="lootbox-pool-preview"><h3>Possible rewards</h3><div>{pool.map((entry) => <article key={entry.id}><LootboxPoolArt data={data} entry={entry} /><span><strong>{lootboxPoolEntryName(data,entry)}</strong><small>{entry.min_amount===entry.max_amount?`×${entry.min_amount}`:`×${entry.min_amount}–${entry.max_amount}`}</small></span><b>{(entry.probability*100).toFixed(entry.probability*100%1===0?0:2)}%</b></article>)}</div></section>
      </>}
    </section>
  </div>;
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

function ShopQuantityControl({ label, quantity, max, disabled = false, onChange, onClick }: { label: string; quantity: number; max: number; disabled?: boolean; onChange: (quantity: number) => void; onClick?: (event: React.MouseEvent) => void }) {
  const safeMax = Math.max(1, Math.min(99, Math.trunc(max)));
  return <div className="shop-quantity-control" onClick={onClick}>
    <button type="button" aria-label={`Decrease ${label.toLocaleLowerCase()}`} disabled={disabled || quantity <= 1} onClick={() => onChange(Math.max(1, quantity - 1))}>−</button>
    <output className="shop-quantity-input" aria-label={label} aria-live="polite">{quantity}</output>
    <button type="button" aria-label={`Increase ${label.toLocaleLowerCase()}`} disabled={disabled || quantity >= safeMax} onClick={() => onChange(Math.min(safeMax, quantity + 1))}>+</button>
  </div>;
}

function ShopEntryCard({ data, entry, quantity, busy, onQuantityChange, onPurchase }: { data: AppData; entry: Extract<ShopEntry,{ shop_type: "shard" | "relic" }>; quantity: number; busy: boolean; onQuantityChange: (quantity: number) => void; onPurchase: () => void }) {
  const availability = shopAvailability(data, entry, quantity);
  const statusAvailability = shopAvailability(data, entry, 1);
  const complete = entry.shop_type === "shard" && statusAvailability.goal > 0n && statusAvailability.current >= statusAvailability.goal;
  const alreadyUnlocked = entry.shop_type === "shard"
    && (statusAvailability.code === "COLLECTIBLE_ALREADY_UNLOCKED" || statusAvailability.code === "SHOP_SHARDS_CHALLENGE_COMPLETE");
  const maxOwned = entry.shop_type === "relic" && statusAvailability.code === "RELIC_MAX_OWNED_REACHED";
  const maxQuantity = shopPurchaseQuantityLimit(data, entry);
  const projected = quantity > 1
    ? statusAvailability.current + shopPurchaseItemQuantity(entry, quantity)
    : statusAvailability.current;
  const completedStatus = alreadyUnlocked ? "Already Unlocked!" : maxOwned ? "Max Owned!" : null;
  const currency = currencyFor(data, entry.currency_id)!;
  const targetName = collectibleName(data, entry.target_category, entry.target_id);
  const targetCritter = entry.target_category === "critter"
    ? byId(data.catalog.critters, entry.target_id)
    : undefined;
  useEffect(() => {
    const capped = Math.max(1, Math.min(99, maxQuantity));
    if ((alreadyUnlocked || maxOwned) && quantity !== 1) onQuantityChange(1);
    else if (quantity > capped) onQuantityChange(capped);
  }, [alreadyUnlocked, maxOwned, maxQuantity, quantity, onQuantityChange]);
  const displayName = entry.shop_type === "shard" ? `${targetName} Shards` : targetName;
  const lineType = entry.shop_type === "shard" ? "Shards" : "Relics";
  return (
    <article className={`shop-entry-card ${complete ? "complete" : ""} ${maxOwned ? "max-owned" : ""}`.trim()} data-shop-type={entry.shop_type} data-target-id={entry.target_id} data-availability-code={availability.code ?? "AVAILABLE"} data-shard-status={entry.shop_type === "shard" ? (complete ? "complete" : "in-progress") : undefined}>
      <div className="shop-card-art"><CollectibleSprite data={data} type={entry.target_category} id={entry.target_id} size="md" shard={entry.shop_type === "shard"} /></div>
      <div className="shop-entry-copy">
        <h3 className="shop-item-name shop-target">
          {targetCritter
            ? (
                <span className="shop-target-identity">
                  <CritterName data={data} critter={targetCritter} />
                  {entry.shop_type === "shard" && <span>Shards</span>}
                </span>
              )
            : displayName}
        </h3>
      </div>
      <div className="shop-entry-meta">
        <strong>{formatAmount(shopPurchaseItemQuantity(entry, quantity))} x {lineType}</strong>
        <span className="shop-price"><AssetIcon path={catalogAssetPath(data, "currency", currency.id, currency.asset_path)} alt={currency.name} fallback={<Coins size={18} />} /><span className="shop-price-cost">{formatAmount(shopPurchasePrice(entry, quantity))}</span></span>
      </div>
      <ShopProgressBar current={statusAvailability.current} projected={projected} goal={statusAvailability.goal} type={lineType} showCompletion={complete || maxOwned} />
      <div className="shop-entry-actions">
        {!availability.enabled && !completedStatus && <p className="shop-unavailable">{availability.reason}</p>}
        {completedStatus ? <p className="shop-complete-status">{completedStatus}</p> : <div className="shop-purchase-row">
          <ShopQuantityControl label={`Quantity of ${entry.name}`} quantity={quantity} max={maxQuantity} disabled={busy} onChange={onQuantityChange} />
          <button className="primary-button shop-purchase" disabled={!availability.enabled || busy} onClick={onPurchase}>{busy ? "Purchasing…" : "Purchase"}</button>
        </div>}
      </div>
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
  const [replacementChallenge, setReplacementChallenge] = useState<CollectibleUnlockChallenge | null>(null);
  const challenges = challengesFor(data, type, id);
  if (!challenges.length) return <p className="collection-status challenge-empty">Not currently unlockable</p>;
  const tracked = trackedChallengesForDisplay(data);
  const firstBlockedChallengeId = challenges.find((challenge) => progressFor(data, challenge.id).eligible === false)?.id ?? null;

  async function changeTracking(challenge: CollectibleUnlockChallenge, currentlyTracked: boolean) {
    setTrackingError(null);
    if (!currentlyTracked && tracked.length >= 3) {
      setReplacementChallenge(challenge);
      return;
    }
    setBusyId(challenge.id);
    try {
      if (!currentlyTracked) {
        const progress = progressFor(data, challenge.id);
        if (progress.eligible === false || progress.trackable === false) {
          setTrackingError("Complete the required Gate Challenges before tracking this challenge.");
          return;
        }
      }
      if (currentlyTracked) await untrackCollectibleChallenge(challenge.id);
      else await trackCollectibleChallenge(challenge.id);
      await onRefresh();
    } catch (error) {
      const raw = errorMessage(error, "Unable to update challenge tracking.");
      if (raw.includes("TRACKING_LIMIT_REACHED")) {
        // Repair rows that the current snapshot still knows about but the
        // active projection has already hidden (normally completed rows),
        // then retry once before asking the user to choose a replacement.
        const activeIds = new Set(tracked.map((row) => row.challenge_id));
        const staleIds = data.player?.collectibleSnapshot.tracked
          .map((row) => row.challenge_id)
          .filter((challengeId) => !activeIds.has(challengeId)) ?? [];
        for (const staleId of staleIds) await untrackCollectibleChallenge(staleId);
        if (staleIds.length > 0) {
          await trackCollectibleChallenge(challenge.id);
          await onRefresh();
        } else {
          await onRefresh();
          setReplacementChallenge(challenge);
        }
      } else {
        setTrackingError(
          raw.includes("CHALLENGE_GATED")
            ? "Complete the required Gate Challenges before tracking this challenge."
            : raw,
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function replaceTrackedChallenge(replacedChallengeId: string) {
    if (!replacementChallenge) return;
    setBusyId(replacementChallenge.id);
    setTrackingError(null);
    try {
      await untrackCollectibleChallenge(replacedChallengeId);
      await trackCollectibleChallenge(replacementChallenge.id);
      await onRefresh();
    } catch (error) {
      setTrackingError(errorMessage(error, "Unable to replace tracked challenge."));
      throw error;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className={`challenge-rows ${compact ? "compact" : ""}`.trim()} aria-label={`${collectibleName(data, type, id)} unlock challenges`}>
        {trackingError && <p className="grid-challenge-error" role="alert">{trackingError}</p>}
        {challenges.map((challenge) => {
          const progress = progressFor(data, challenge.id);
          const blocked = progress.eligible === false;
          const slot = progress.completed ? null : trackedSlotFor(data, challenge.id);
          const trackedFamily = isTrackableChallenge(challenge);
          const trackable = trackedFamily && !progress.completed && progress.trackable !== false;
          return (
            <Fragment key={challenge.id}>
              {challenge.id === firstBlockedChallengeId && <div className="challenge-gate-boundary">
                <span className="gate-blocked"><Lock size={11} />Complete all above challenges first</span>
              </div>}
              <div className={`challenge-row ${progress.completed ? "complete" : ""} ${blocked ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()}>
                <span className="challenge-row-description">{challengeDescription(data, challenge)}</span>
                <strong>{formatAmount(progress.current)} / {formatAmount(progress.goal)}</strong>
                {trackedFamily && !progress.completed && (trackable || slot !== null) && <button
                  type="button"
                  className="grid-challenge-track"
                  aria-label={`${slot ? "Untrack" : "Track"} ${challengeDescription(data, challenge)}`}
                  aria-pressed={slot !== null}
                  disabled={busyId === challenge.id}
                  title={slot ? `Tracked in Slot ${slot}` : undefined}
                  onClick={() => changeTracking(challenge, slot !== null)}
                >{busyId === challenge.id ? "…" : slot ? "Untrack" : "Track"}</button>}
              </div>
            </Fragment>
          );
        })}
      </div>
      {replacementChallenge && <ChallengeReplacementModal data={data} challenge={replacementChallenge} tracked={tracked} busyId={busyId} onReplace={replaceTrackedChallenge} onClose={() => setReplacementChallenge(null)} />}
    </>
  );
}

function CollectionCardState({ children }: { children: React.ReactNode }) {
  return <div className="collection-card-state"><div className="collection-card-state-scroll">{children}</div></div>;
}

function RollcasterGrid({
  data,
  rollcasters,
  setDetail,
  onRefresh,
  measurement = false,
}: {
  data: AppData;
  rollcasters: AppData["catalog"]["rollcasters"];
  setDetail: (detail: { type: "rollcaster"; id: string }) => void;
  onRefresh: () => Promise<void>;
  measurement?: boolean;
}) {
  return (
    <div className={`collection-grid ${measurement ? "collection-grid-measurement" : ""}`.trim()}>
      {rollcasters.map((rollcaster) => {
        const owned = data.player!.rollcasters.find((row) => row.rollcaster_id === rollcaster.id);
        const unlocked = collectibleIsUnlocked(data, "rollcaster", rollcaster.id);
        const progress = xpProgress(
          data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id),
          owned?.level ?? 1,
          owned?.xp ?? 0,
        );
        return (
          <article key={rollcaster.id} className={`catalog-card rollcaster-card ${!unlocked ? "locked" : ""}`} onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            setDetail({ type: "rollcaster", id: rollcaster.id });
          }}>
            <button type="button" className="catalog-card-details" aria-label={`View ${rollcaster.name} details`} onClick={() => setDetail({ type: "rollcaster", id: rollcaster.id })}><Search size={14} aria-hidden="true" /></button>
            <span className="collectible-id">{rollcaster.id}</span>
            <CardSprite className="rollcaster-sprite-frame"><Sprite name={rollcaster.name} element="basic" assetPath={findAssetPath(data, "rollcaster", rollcaster.id, "card") ?? catalogAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path)} size="hero" fit="portrait" /></CardSprite>
            <CardName data={data} name={rollcaster.name} />
            <CollectionCardState>
              {unlocked ? <div className="collection-progression"><p>Level {owned?.level ?? 1}</p><ProgressBar progress={progress} /></div> : <CollectibleChallengeRows data={data} type="rollcaster" id={rollcaster.id} onRefresh={onRefresh} />}
              {rollcaster.description?.trim() && <p className="collection-rollcaster-description">{rollcaster.description.trim()}</p>}
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
  measurement = false,
}: {
  data: AppData;
  critters: Critter[];
  setDetail: (detail: { type: "critter"; id: string }) => void;
  onRefresh: () => Promise<void>;
  measurement?: boolean;
}) {
  return (
    <div className={`collection-grid ${measurement ? "collection-grid-measurement" : ""}`.trim()}>
      {critters.map((critter) => {
        const owned = data.player!.critters.find((row) => row.critter_id === critter.id);
        const unlocked = collectibleIsUnlocked(data, "critter", critter.id);
        const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
        return (
          <article
            key={critter.id}
            className={`catalog-card critter-card ${!unlocked ? "locked challenge-locked" : ""}`}
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
            <CollectionCardState>
              {unlocked && owned ? <div className="collection-progression critter-progression"><p>Level {owned.level}</p><ProgressBar progress={xpProgress(data.catalog.critterProgression.filter((row) => row.critter_id === critter.id), owned.level, owned.xp)} /></div> : <CollectibleChallengeRows data={data} type="critter" id={critter.id} onRefresh={onRefresh} />}
            </CollectionCardState>
            <StatGrid stats={stats} compact />
            <PointCounter kind="skill" points={owned?.skill_points ?? 0} />
          </article>
        );
      })}
    </div>
  );
}

function RelicGrid({ data, relics, setDetail, onRefresh, measurement = false }: { data: AppData; relics: Relic[]; setDetail: (detail: { type: "relic"; id: string }) => void; onRefresh: () => Promise<void>; measurement?: boolean }) {
  return (
    <div className={`collection-grid ${measurement ? "collection-grid-measurement" : ""}`.trim()}>
      {relics.map((relic) => {
        const inventory = data.player!.relicInventory.find((row) => row.relic_id === relic.id);
        return <RelicCard key={relic.id} data={data} relic={relic} quantity={inventory?.quantity ?? 0} unlocked={collectibleIsUnlocked(data, "relic", relic.id)} onClick={() => setDetail({ type: "relic", id: relic.id })} onRefresh={onRefresh} />;
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
      <CollectionCardState>
        {unlocked ? <p>Owned {quantity} / {relic.max_owned}</p> : <CollectibleChallengeRows data={data} type="relic" id={relic.id} onRefresh={onRefresh} />}
        <EffectList effects={effects} className="relic-card-effects" />
      </CollectionCardState>
    </article>
  );
}

function PointCounter({ kind, points, inline = false }: { kind: "skill" | "ability"; points: number; inline?: boolean }) {
  return inline
    ? <span className="point-counter point-counter-inline"><strong>{points}</strong> {kind} point{points === 1 ? "" : "s"}</span>
    : <p className="point-counter"><strong>{points}</strong> {kind} point{points === 1 ? "" : "s"}</p>;
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
  const [replacementChallenge, setReplacementChallenge] = useState<CollectibleUnlockChallenge | null>(null);
  const challenges = challengesFor(data, type, id);
  if (!challenges.length) return <section className="collectible-challenge-panel"><h3>Collect</h3><p className="challenge-empty">Not currently unlockable through challenges.</p></section>;
  const required = requirementFor(data, type, id);
  const complete = challenges.filter((challenge) => progressFor(data, challenge.id).completed).length;
  const tracked = trackedChallengesForDisplay(data);
  const firstBlockedChallengeId = challenges.find((challenge) => progressFor(data, challenge.id).eligible === false)?.id ?? null;

  async function changeTracking(challenge: CollectibleUnlockChallenge, currentlyTracked: boolean) {
    setPanelError(null);
    if (!currentlyTracked && tracked.length >= 3) {
      setReplacementChallenge(challenge);
      return;
    }
    setBusyId(challenge.id);
    try {
      if (!currentlyTracked) {
        const progress = progressFor(data, challenge.id);
        if (progress.eligible === false || progress.trackable === false) {
          setPanelError("Complete the required Gate Challenges before tracking this challenge.");
          return;
        }
      }
      if (currentlyTracked) await untrackCollectibleChallenge(challenge.id);
      else await trackCollectibleChallenge(challenge.id);
      await onRefresh();
    } catch (error) {
      const raw = errorMessage(error, "Unable to update challenge tracking.");
      if (raw.includes("TRACKING_LIMIT_REACHED")) {
        const activeIds = new Set(tracked.map((row) => row.challenge_id));
        const staleIds = data.player?.collectibleSnapshot.tracked
          .map((row) => row.challenge_id)
          .filter((challengeId) => !activeIds.has(challengeId)) ?? [];
        for (const staleId of staleIds) await untrackCollectibleChallenge(staleId);
        if (staleIds.length > 0) {
          await trackCollectibleChallenge(challenge.id);
          await onRefresh();
        } else {
          await onRefresh();
          setReplacementChallenge(challenge);
        }
      } else {
        setPanelError(
          raw.includes("CHALLENGE_GATED")
            ? "Complete the required Gate Challenges before tracking this challenge."
            : raw,
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function replaceTrackedChallenge(replacedChallengeId: string) {
    if (!replacementChallenge) return;
    setBusyId(replacementChallenge.id); setPanelError(null);
    try {
      await untrackCollectibleChallenge(replacedChallengeId);
      await trackCollectibleChallenge(replacementChallenge.id);
      await onRefresh();
      setReplacementChallenge(null);
    } catch (error) {
      setPanelError(errorMessage(error, "Unable to replace tracked challenge."));
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
          const slot = progress.completed ? null : trackedSlotFor(data, challenge.id);
          const trackedFamily = isTrackableChallenge(challenge);
          const trackable = trackedFamily && !progress.completed && progress.trackable !== false;
          const blocked = progress.eligible === false;
          return (
            <Fragment key={challenge.id}>
              {challenge.id === firstBlockedChallengeId && <div className="challenge-gate-boundary challenge-detail-gate-boundary">
                <span className="gate-blocked"><Lock size={12} />Complete all above challenges first</span>
              </div>}
              <article data-challenge-id={challenge.id} className={`challenge-detail-row ${progress.completed ? "complete" : ""} ${blocked ? "blocked" : ""} ${progress.goal_reached ? "goal-reached" : ""}`.trim()}>
                <span className="challenge-detail-copy">
                  <span>{challengeDescription(data, challenge)}</span>
                </span>
                <strong>{formatAmount(progress.current)} / {formatAmount(progress.goal)}</strong>
                {!unlocked && trackedFamily && !progress.completed && (trackable || slot !== null) && <button
                  className={slot ? "secondary-button" : "primary-button"}
                  disabled={busyId === challenge.id}
                  title={slot ? `Tracked in Slot ${slot}` : undefined}
                  onClick={() => changeTracking(challenge, slot !== null)}
                >{slot ? `Untrack · Slot ${slot}` : "Track"}</button>}
              </article>
            </Fragment>
          );
        })}
      </div>
      {replacementChallenge && <ChallengeReplacementModal data={data} challenge={replacementChallenge} tracked={tracked} busyId={busyId} onReplace={replaceTrackedChallenge} onClose={() => setReplacementChallenge(null)} />}
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
  const { flashingId, flash } = useUnlockButtonFlash();

  async function purchaseSkill(owned: UserCritter, skillId: string, cost: number) {
    if (owned.skill_points < cost) {
      flash(skillId);
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
    const collectibleUnlocked = collectibleIsUnlocked(data, "critter", critter.id);
    const stats = critterStats(data.catalog, critter, owned?.level ?? 1);
    const skillIds = owned ? data.player!.unlockedSkillIdsByCritter[owned.id] ?? [] : [];
    const progression = owned ? xpProgress(data.catalog.critterProgression.filter((row) => row.critter_id === critter.id), owned.level, owned.xp) : null;
    return (
      <Modal title={critter.name} onClose={onClose}>
        {detailError && <p className="notice error" role="alert">{detailError}</p>}
        <CollectibleDetailHero data={data} id={critter.id} name={critter.name} critter={critter} assetPath={preferredAssetPath(data, "critter", critter.id, critter.asset_path, ["portrait", "battle", "card"])} assetElement={critter.element_1_id} />
        <p className="detail-level">{collectibleUnlocked && owned ? `Level ${owned.level}` : "Locked"}</p>
        <CollectibleChallengePanel data={data} type="critter" id={critter.id} unlocked={collectibleUnlocked} onRefresh={onRefresh} />
        {progression && <ProgressBar progress={progression} className="detail-xp-progress" />}
        <StatGrid stats={stats} />
        <h3 className="detail-section-heading">Skills <PointCounter kind="skill" points={owned?.skill_points ?? 0} inline /></h3>
        <div className="mini-grid">
          {data.catalog.critterSkillUnlocks
            .filter((row) => row.critter_id === critter.id)
            .sort((left, right) =>
              left.unlock_level - right.unlock_level ||
              left.sort_order - right.sort_order ||
              left.skill_id.localeCompare(right.skill_id)
            )
            .map((unlock) => {
              const skill = byId(data.catalog.skills, unlock.skill_id)!;
              const unlocked = skillIds.includes(skill.id);
              const canPurchase = Boolean(collectibleUnlocked && owned && owned.level >= unlock.unlock_level && !unlocked);
              return (
                <div key={skill.id} className={`detail-tile ${unlocked ? "unlocked" : "locked"} ${canPurchase ? "unlockable" : "level-locked"}`}>
                  <SkillTile data={data} skill={skill} sourceCritter={critter} />
                  <span className="unlock-requirement">Unlock level {unlock.unlock_level} · {unlock.unlock_cost} points</span>
                  {canPurchase && owned && <button className={`primary-button skill-unlock-button ${flashingId === skill.id ? "insufficient-points" : ""}`.trim()} disabled={saving} onClick={() => purchaseSkill(owned, skill.id, unlock.unlock_cost)}>Unlock · {unlock.unlock_cost}</button>}
                </div>
              );
          })}
        </div>
        <CollectibleDescriptionSection description={critter.description} />
      </Modal>
    );
  }

  if (detail.type === "relic") {
    const relic = byId(data.catalog.relics, detail.id)!;
    const quantity = data.player!.relicInventory.find((row) => row.relic_id === relic.id)?.quantity ?? 0;
    return (
      <Modal title={relic.name} onClose={onClose}>
        <CollectibleDetailHero data={data} id={relic.id} name={relic.name} assetPath={findAssetPath(data, "relic", relic.id, "card") ?? catalogAssetPath(data, "relic", relic.id, relic.asset_path)} assetElement="metal" />
        <p><strong>Owned:</strong> {quantity} / {relic.max_owned}</p>
        <CollectibleChallengePanel data={data} type="relic" id={relic.id} unlocked={collectibleIsUnlocked(data, "relic", relic.id)} onRefresh={onRefresh} />
        <EffectList effects={data.catalog.effectsByRelic[relic.id] ?? []} className="effect-summary" />
        <CollectibleDescriptionSection description={relic.description} />
      </Modal>
    );
  }

  const rollcaster = byId(data.catalog.rollcasters, detail.id)!;
  const owned = data.player!.rollcasters.find((row) => row.rollcaster_id === rollcaster.id);
  const collectibleUnlocked = collectibleIsUnlocked(data, "rollcaster", rollcaster.id);
  const abilityIds = owned ? data.player!.unlockedAbilityIdsByRollcaster[owned.id] ?? [] : [];
  const progression = owned ? xpProgress(data.catalog.rollcasterProgression.filter((row) => row.rollcaster_id === rollcaster.id), owned.level, owned.xp) : null;
  return (
    <Modal title={rollcaster.name} onClose={onClose}>
      {detailError && <p className="notice error" role="alert">{detailError}</p>}
      <CollectibleDetailHero data={data} id={rollcaster.id} name={rollcaster.name} assetPath={preferredAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path, ["portrait", "battle", "card"])} assetElement="basic" />
      <p className="detail-level">{collectibleUnlocked && owned ? `Level ${owned.level}` : "Locked"}</p>
      <CollectibleChallengePanel data={data} type="rollcaster" id={rollcaster.id} unlocked={collectibleUnlocked} onRefresh={onRefresh} />
      {progression && <ProgressBar progress={progression} className="detail-xp-progress" />}
      <h3 className="detail-section-heading">Abilities <PointCounter kind="ability" points={owned?.ability_points ?? 0} inline /></h3>
      <div className="mini-grid">
        {data.catalog.rollcasterAbilityUnlocks
          .filter((row) => row.rollcaster_id === rollcaster.id)
          .sort((left, right) => left.sort_order - right.sort_order)
          .map((unlock) => {
            const ability = byId(data.catalog.rollcasterAbilities, unlock.ability_id)!;
            const unlocked = abilityIds.includes(ability.id);
            const canPurchase = Boolean(collectibleUnlocked && owned && owned.level >= unlock.unlock_level && !unlocked);
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
      <CollectibleDescriptionSection description={rollcaster.description} />
    </Modal>
  );
}

function CollectibleDescriptionSection({ description }: { description: string | null | undefined }) {
  return (
    <section className="collectible-description-section">
      <h3>Description</h3>
      <p>{description?.trim() || "No description available."}</p>
    </section>
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

const DUNGEONS_PER_PAGE = 20;

function DungeonPageTabs({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="dungeon-page-tabs" role="tablist" aria-label="Dungeon pages">
      {Array.from({ length: pageCount }, (_, index) => {
        const pageNumber = index + 1;
        return (
          <button
            key={pageNumber}
            type="button"
            role="tab"
            aria-selected={page === pageNumber}
            className={page === pageNumber ? "active" : ""}
            onClick={() => onChange(pageNumber)}
          >
            {pageNumber}
          </button>
        );
      })}
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
  const [page, setPage] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const dungeons = effectiveDungeons(data.player!, data.catalog.dungeons, data.catalog.dungeonOpponents);
  const pageCount = Math.max(1, Math.ceil(dungeons.length / DUNGEONS_PER_PAGE));
  const activePage = Math.min(page, pageCount);
  const pageDungeons = dungeons.slice((activePage - 1) * DUNGEONS_PER_PAGE, activePage * DUNGEONS_PER_PAGE);

  useEffect(() => {
    if (page !== activePage) setPage(activePage);
  }, [page, activePage]);

  const pageDungeonIds = pageDungeons.map((entry) => entry.dungeon.id).join(",");

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    let syncing = false;

    const syncHeights = () => {
      if (syncing) return;
      syncing = true;
      const previousRows = grid.style.gridAutoRows;
      grid.style.gridAutoRows = "auto";
      const cards = [...grid.querySelectorAll<HTMLElement>(".dungeon-grid-card")];
      for (const card of cards) {
        card.style.minHeight = "";
        card.style.height = "";
      }
      void grid.offsetHeight;
      const maxHeight = Math.max(0, ...cards.map((card) => card.getBoundingClientRect().height));
      const nextRows = maxHeight > 0 ? `${Math.ceil(maxHeight)}px` : "";
      if (nextRows) {
        grid.style.gridAutoRows = nextRows;
        for (const card of cards) {
          card.style.height = "100%";
        }
      } else {
        grid.style.gridAutoRows = previousRows;
      }
      syncing = false;
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncHeights);
    };

    schedule();
    void document.fonts.ready.then(schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      grid.style.gridAutoRows = "";
    };
  }, [activePage, pageDungeonIds]);

  return (
    <section className="screen-stack dungeon-select-screen">
      <div className="screen-heading row">
        <div>
          <h1>Dungeons</h1>
          <p>Choose an expedition. Your squad begins each run at full HP, then carries its wounds between encounters.</p>
        </div>
        <button className="secondary-button" onClick={onBack}>Back</button>
      </div>
      <DungeonPageTabs page={activePage} pageCount={pageCount} onChange={setPage} />
      <div className="dungeon-grid-content">
        <div className="dungeon-grid" ref={gridRef}>
          {pageDungeons.map((entry) => (
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
      </div>
      <DungeonPageTabs page={activePage} pageCount={pageCount} onChange={setPage} />
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
                {entry.encounterPoolRevealed
                  ? <SpriteFrame size="sm"><Sprite name={critter.name} element={critter.element_1_id} assetPath={catalogAssetPath(data, "critter", critter.id, critter.asset_path)} /></SpriteFrame>
                  : <SpriteFrame size="sm"><span className="dungeon-unknown-critter-icon" role="img" aria-label="Unknown Critter"><CircleHelp size={34} aria-hidden="true" /></span></SpriteFrame>}
                <span className="dungeon-opponent-identity">
                  {entry.encounterPoolRevealed && <span className="collectible-id">{critter.id}</span>}
                  {entry.encounterPoolRevealed
                    ? <CritterName data={data} critter={critter} />
                    : <strong className="dungeon-unknown-critter-name">?????</strong>}
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

function ContinueDungeonDialog({
  dungeon,
  busy,
  onContinue,
  onAbandon,
  onClose,
}: {
  dungeon: Dungeon;
  busy: "continue" | "abandon" | null;
  onContinue: () => void;
  onAbandon: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      eyebrow="Dungeon expedition"
      title="Continue Dungeon?"
      description={null}
      onClose={onClose}
      className="continue-dungeon-modal"
    >
      <div className="continue-dungeon-copy">
        <p>You left off in the middle of <strong>{dungeon.name}</strong> ({dungeon.id}).</p>
        <p>Do you want to continue from your saved state or abandon the run?</p>
        <p className="continue-dungeon-warning">Abandoning discards this saved run and returns you to the Dungeon selection grid.</p>
      </div>
      <div className="dialog-actions continue-dungeon-actions">
        <button type="button" className="danger-button" disabled={busy !== null} onClick={onAbandon}>
          {busy === "abandon" ? "Abandoning…" : "Abandon"}
        </button>
        <button type="button" className="primary-button" disabled={busy !== null} onClick={onContinue}>
          {busy === "continue" ? "Continuing…" : "Continue"}
        </button>
      </div>
    </Modal>
  );
}

function AbandonDungeonDialog({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      eyebrow="Dungeon expedition"
      title="Do you want to abandon the current run?"
      description={null}
      onClose={onCancel}
      className="abandon-dungeon-modal"
      dismissible={false}
    >
      <div className="dialog-actions abandon-dungeon-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>No</button>
        <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>
          {busy ? "Abandoning…" : "Yes"}
        </button>
      </div>
    </Modal>
  );
}

function DungeonDropRow({ data, drop }: { data: AppData; drop: DungeonDrop }) {
  const currency = drop.kind === "currency" ? currencyFor(data, drop.targetId) : undefined;
  const targetName = drop.kind === "currency"
    ? currency?.name ?? drop.targetId
    : drop.kind === "lootbox"
      ? data.catalog.lootboxes.find((lootbox) => lootbox.id === drop.targetId)?.name ?? drop.targetId
    : collectibleName(data, (drop.targetCategory ?? "relic") as CollectibleType, drop.targetId);
  return (
    <div className="dungeon-drop-row">
      {drop.kind === "currency"
        ? <AssetIcon path={catalogAssetPath(data, "currency", currency?.id, currency?.asset_path, "icon")} alt="" fallback={<Coins size={17} />} />
        : drop.kind === "lootbox"
          ? <LootboxSprite lootbox={data.catalog.lootboxes.find((lootbox) => lootbox.id === drop.targetId)!} variant="closed" />
        : <CollectibleSprite data={data} type={(drop.targetCategory ?? "relic") as CollectibleType} id={drop.targetId} size="xs" shard={drop.kind === "shard"} />}
      <span>
        <strong>{dropAmountLabel(drop.minAmount, drop.maxAmount)} {drop.kind === "shard" ? `${targetName} Shards` : targetName}</strong>
        <small>{Math.round(drop.probability * 10000) / 100}% chance</small>
        {(drop.kind === "shard" || drop.kind === "relic") && drop.dupeCurrencyId && <small>Duplicates convert to {drop.dupeCurrencyAmount ?? 0} {currencyFor(data, drop.dupeCurrencyId)?.name ?? drop.dupeCurrencyId} each.</small>}
      </span>
    </div>
  );
}

function CombatScreen({
  data,
  combat,
  setCombat,
  onBattleResult,
  onBack,
  onHome,
  onReplay,
  onNextDungeon,
}: {
  data: AppData;
  combat: DungeonRunState;
  setCombat: Dispatch<SetStateAction<DungeonRunState | null>>;
  onBattleResult: (state: DungeonRunState) => Promise<void>;
  onBack: () => void;
  onHome: () => void;
  onReplay: () => void;
  onNextDungeon: (dungeonId: string) => void;
}) {
  const NARRATION_TYPEWRITER_INTERVAL_MS = 22;
  const combatRootRef = useRef<HTMLElement>(null);
  const [actions, setActions] = useState<Record<string, CombatAction>>({});
  const [menu, setMenu] = useState<"actions" | "skills" | "swap">("actions");
  const opponentEncounterKey = `${combat.run.id}:${combat.run.battleIndex}`;
  const [opponentRevealState, setOpponentRevealState] = useState(() => ({
    encounterKey: opponentEncounterKey,
    keys: new Set<string>(),
  }));
  const revealedOpponentKeys = opponentRevealState.encounterKey === opponentEncounterKey
    ? opponentRevealState.keys
    : new Set<string>();
  const [targeting, setTargeting] = useState<{ actorKey: string; skill: Skill; phase: "primary" | "swap"; primaryTargetKey?: string } | null>(null);
  const [swapSelection, setSwapSelection] = useState<{ actorKey: string; mode: "regular" | "skill" } | null>(null);
  const [submittingProgress, setSubmittingProgress] = useState(false);
  const [manaSubmitAnimating, setManaSubmitAnimating] = useState(false);
  const [loadingDots, setLoadingDots] = useState(1);
  const [recordingResult, setRecordingResult] = useState(false);
  const [resultAttempt, setResultAttempt] = useState(0);
  const [diceSettled, setDiceSettled] = useState(true);
  const [eventSettled, setEventSettled] = useState(true);
  const [visibleNarration, setVisibleNarration] = useState("");
  const [narrationSettled, setNarrationSettled] = useState(true);
  const keyboardFocusRef = useRef<HTMLElement | null>(null);
  const keyboardFocusProxyRef = useRef<HTMLElement | null>(null);
  const invalidKeyboardFocusTimerRef = useRef<number | null>(null);
  const lastActionMenuFocusKeyRef = useRef("");
  const lastCommandFocusKeyRef = useRef("");
  const lastSkillByActorKeyRef = useRef<Record<string, string>>({});
  const lastSkillMenuFocusKeyRef = useRef("");
  const [swapMotion, setSwapMotion] = useState<{
    eventId: string;
    actorKey: string;
    phase: "out" | "in";
    x: number;
    y: number;
  } | null>(null);
  const battle = combat.battle;
  const enemyEncounter = combat.run.selectedEnemyEncounters?.find((encounter) => encounter.battleIndex === combat.run.battleIndex) ?? null;
  const enemyRollcaster = enemyEncounter?.enemyRollcaster ?? null;
  const enemyRollcasterAssetPath = enemyRollcaster
    ? data.catalog.dungeonEnemyRollcasters?.find((candidate) => candidate.id === enemyRollcaster.id)?.asset_path ?? enemyRollcaster.asset_path
    : null;
  const enemyAbilities = (enemyRollcaster?.ability_ids ?? []).map((id) => byId(data.catalog.rollcasterAbilities, id)).filter((ability): ability is NonNullable<typeof ability> => Boolean(ability));
  const dialogue = currentDungeonDialogue(combat);
  const activePlayer = orderedActiveCombatUnits(battle.playerUnits);
  const totalCost = Object.values(actions).reduce((sum, action) => sum + action.cost, 0);
  const selectingActions = combat.phase === "select_player_actions";
  const displayedPlayerMana = selectingActions ? Math.max(0, battle.playerMana - totalCost) : battle.playerMana;
  const playerManaReserved = selectingActions && totalCost > 0;
  const manaAssetPath = findAssetPath(data, "mana", "mana");
  const activeOwnedRollcaster = data.player!.rollcasters.find((row) => row.id === data.player!.profile.active_rollcaster_id) ?? data.player!.rollcasters[0];
  const activeRollcaster = byId(data.catalog.rollcasters, activeOwnedRollcaster?.rollcaster_id);
  const activeAbilitySlots = Array.from({ length: 5 }, (_, index) => {
    const slot = data.player!.abilitySlots.find((candidate) => (
      candidate.user_rollcaster_id === activeOwnedRollcaster?.id
      && candidate.slot_index === index + 1
    ));
    return byId(data.catalog.rollcasterAbilities, slot?.ability_id);
  });
  useEffect(() => {
    const activeOpponentKeys = battle.opponentUnits
      .filter((unit) => unit.active)
      .map((unit) => unit.key);
    setOpponentRevealState((current) => updateOpponentRevealState(
      current,
      opponentEncounterKey,
      combat.phase,
      activeOpponentKeys,
      combat.events,
    ));
  }, [combat.events, combat.phase, opponentEncounterKey, battle.opponentUnits]);
  const legalTargets = targeting
    ? targeting.phase === "swap"
      ? healthyFriendlySwapTargets(battle, targeting.actorKey)
      : skillTargets(battle, targeting.actorKey, targeting.skill)
    : [];
  const legalTargetKeys = new Set(legalTargets.map((unit) => unit.key));
  const inactiveLegalTargets = legalTargets.filter((unit) => !unit.active);
  const queuedSwapIds = new Set(Object.values(actions).flatMap((action) => [action.swapInKey, action.swapToId, action.swapTargetKey]).filter((id): id is string => Boolean(id)));
  const availableHealthySwapTargets = (actorKey: string) => healthyFriendlySwapTargets(battle, actorKey)
    .filter((unit) => !queuedSwapIds.has(unit.key) && !queuedSwapIds.has(unit.userCritter?.id ?? ""));
  const swapTargetKeys = swapSelection
    ? availableHealthySwapTargets(swapSelection.actorKey).map((unit) => unit.key)
    : targeting?.phase === "swap"
      ? availableHealthySwapTargets(targeting.actorKey).map((unit) => unit.key)
      : [];
  const swapActorKey = swapSelection?.actorKey ?? (targeting?.phase === "swap" ? targeting.actorKey : undefined);
  const currentActor = activePlayer.find((unit) => !actions[unit.key]);
  const currentActorIndex = currentActor ? activePlayer.findIndex((unit) => unit.key === currentActor.key) : activePlayer.length;
  const event = currentDungeonEvent(combat);
  const manaRefundNarration = event?.kind === "mana_refund" && combat.phase === "event_playback";
  const swapRevealed = Boolean(event?.swap && [...battle.playerUnits, ...battle.opponentUnits].some((unit) => (
    unit.key === event.swap!.incomingKey
    && unit.active
    && unit.battlefieldSlot === event.swap!.battlefieldSlot
  )));
  const playerFieldSlots = battlefieldSlotsForCount(battle.dungeon.player_active_count);
  const opponentFieldSlots = battlefieldSlotsForCount(battle.dungeon.opponent_active_count);
  const viewportFitRef = useViewportFitScale();
  const loadingNarration = submittingProgress || recordingResult;
  const narrationText = loadingNarration
    ? combatLoadingNarration(recordingResult ? "result" : "turn", loadingDots)
    : combat.phase === "lead_selection"
    ? `Choose ${combat.requiredLeadCount} healthy lead Critter${combat.requiredLeadCount === 1 ? "" : "s"} before revealing the enemy lineup.`
    : combat.phase === "forced_replacements"
      ? `Choose ${combat.requiredLeadCount - combat.fixedLeadIds.length} replacement${combat.requiredLeadCount - combat.fixedLeadIds.length === 1 ? "" : "s"} for the knocked-out active slot${combat.requiredLeadCount - combat.fixedLeadIds.length === 1 ? "" : "s"}.`
      : combat.phase === "entry_dialogue" || combat.phase === "outcome_dialogue"
        ? dialogue ? `${dialogue.speaker}: ${dialogue.line}` : "Continue."
      : combat.phase === "await_roll"
        ? `Roll the Dice to start Turn ${battle.turn}.`
        : combat.phase === "roll_result"
          ? (!diceSettled
            ? "Rolling…"
            : `You rolled ${combat.rollSummary?.player ?? 0} mana and the enemy rolled ${combat.rollSummary?.opponent ?? 0} mana.`)
      : combat.phase === "select_player_actions"
            ? (targeting ? targeting.phase === "swap" ? `Choose a healthy friendly Critter to swap in after ${targeting.skill.name}.` : `Choose a legal target for ${targeting.skill.name}.` : currentActor ? `Choose your ${currentActor.name}'s action.` : "All actions are ready. Submit when prepared.")
            : combat.phase === "event_playback"
              ? (event?.kind === "mana_refund" ? "Mana restored." : (event?.message ?? ""))
              : combat.phase === "battle_result"
                ? (recordingResult ? "" : "Encounter resolved.")
                : combat.phase === "encounter_rewards"
                  ? `Encounter ${combat.run.battleIndex - 1} cleared.`
                  : "";
  const actionsReady = combat.phase === "select_player_actions"
    && !submittingProgress
    && !targeting
    && totalCost <= battle.playerMana
    && activePlayer.length > 0
    && Object.keys(actions).length === activePlayer.length;
  const narrationAdvanceable = (
    (combat.phase === "event_playback" && !manaRefundNarration && !loadingNarration && eventSettled)
    || (combat.phase === "roll_result" && diceSettled)
    || ["entry_dialogue", "outcome_dialogue"].includes(combat.phase)
  ) && (!narrationText || (narrationSettled && visibleNarration === narrationText));
  const narrationComplete = !narrationText || loadingNarration || (narrationSettled && visibleNarration === narrationText);
  const playerManaRefund = event?.kind === "mana_refund" && event.manaRefund?.side === "player" ? event.manaRefund : null;
  const opponentManaRefund = event?.kind === "mana_refund" && event.manaRefund?.side === "opponent" ? event.manaRefund : null;

  function combatKeyboardControls(): HTMLElement[] {
    const root = combatRootRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>("[data-combat-control]")]
      .filter((control) => control.getClientRects().length > 0);
  }

  function clearKeyboardFocusVisual() {
    const previous = keyboardFocusRef.current;
    previous?.classList.remove("combat-keyboard-focused");
    previous?.closest<HTMLElement>(".tooltip-anchor")?.classList.remove("combat-keyboard-focused");
    keyboardFocusProxyRef.current?.classList.remove("combat-keyboard-focus-proxy");
    keyboardFocusProxyRef.current = null;
  }

  function dismissKeyboardFocus() {
    const active = document.activeElement;
    const root = combatRootRef.current;
    const shouldBlur = active instanceof HTMLElement
      && root?.contains(active)
      && (active.matches("[data-combat-control]") || active.classList.contains("combat-keyboard-focus-proxy"));
    const previous = keyboardFocusRef.current;
    clearKeyboardFocusVisual();
    previous?.classList.remove("combat-keyboard-invalid");
    keyboardFocusRef.current = null;
    if (shouldBlur) active.blur();
  }

  function setCombatKeyboardFocus(control: HTMLElement) {
    clearKeyboardFocusVisual();
    keyboardFocusRef.current = control;
    control.classList.add("combat-keyboard-focused");
    const tooltipAnchor = control.closest<HTMLElement>(".tooltip-anchor");
    tooltipAnchor?.classList.add("combat-keyboard-focused");
    if (control.matches(":disabled")) {
      const proxy = tooltipAnchor ?? control.parentElement;
      if (proxy && proxy !== control) {
        proxy.tabIndex = -1;
        proxy.classList.add("combat-keyboard-focus-proxy");
        keyboardFocusProxyRef.current = proxy;
        proxy.focus();
        return;
      }
    }
    control.focus();
  }

  function focusCombatControl(role?: string, preferredSkillId?: string): HTMLElement | null {
    const controls = combatKeyboardControls();
    const preferred = preferredSkillId
      ? controls.find((control) => control.dataset.combatFocusRole === role && control.dataset.combatSkillId === preferredSkillId)
      : role
        ? controls.find((control) => control.dataset.combatFocusRole === role)
        : controls[0];
    const next = preferred ?? controls[0];
    if (next) setCombatKeyboardFocus(next);
    return next ?? null;
  }

  function defaultCombatFocusRole(): string | undefined {
    if (combat.phase === "lead_selection" || combat.phase === "forced_replacements") return "lead";
    if (combat.phase === "await_roll") return "roll";
    if (combat.phase === "roll_result" || combat.phase === "event_playback") return "narration";
    if (combat.phase === "select_player_actions") {
      if (targeting || swapSelection) return "target";
      if (menu === "skills") return "skill";
      if (menu === "swap") return "swap";
      return currentActor ? "action-primary" : "submit";
    }
    if (combat.phase === "battle_result") return "retry";
    if (combat.phase === "encounter_rewards") return "reward-next";
    if (combat.phase === "dungeon_complete" || combat.phase === "dungeon_failed") return "outcome";
    return undefined;
  }

  function moveCombatFocus(direction: "up" | "down" | "left" | "right") {
    const root = combatRootRef.current;
    const controls = combatKeyboardControls();
    if (!root || !controls.length) return;
    const focusedByKeyboard = keyboardFocusRef.current;
    if (!focusedByKeyboard || !root.contains(focusedByKeyboard)) {
      focusCombatControl(defaultCombatFocusRole());
      return;
    }
    const active = focusedByKeyboard;
    if (!active || !controls.includes(active)) {
      focusCombatControl(defaultCombatFocusRole());
      return;
    }
    const source = active.getBoundingClientRect();
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    const candidates = controls
      .filter((control) => control !== active)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dx = x - sourceX;
        const dy = y - sourceY;
        const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
        const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        const isForward = direction === "right" ? dx > 2
          : direction === "left" ? dx < -2
            : direction === "down" ? dy > 2
              : dy < -2;
        return { control, primary, cross, distance: Math.hypot(dx, dy), isForward };
      })
      .filter((candidate) => candidate.isForward)
      .sort((left, right) => (
        left.cross - right.cross
        || left.primary - right.primary
        || left.distance - right.distance
      ));
    setCombatKeyboardFocus(candidates[0]?.control ?? active);
  }

  function flashInvalidKeyboardControl(control: HTMLElement) {
    if (invalidKeyboardFocusTimerRef.current !== null) {
      window.clearTimeout(invalidKeyboardFocusTimerRef.current);
    }
    control.classList.remove("combat-keyboard-invalid");
    void control.offsetWidth;
    control.classList.add("combat-keyboard-invalid");
    invalidKeyboardFocusTimerRef.current = window.setTimeout(() => {
      control.classList.remove("combat-keyboard-invalid");
      invalidKeyboardFocusTimerRef.current = null;
    }, 360);
  }

  function activateCombatKeyboardControl(control: HTMLElement) {
    if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") {
      flashInvalidKeyboardControl(control);
      return;
    }
    control.click();
  }

  useEffect(() => {
    function handleMouseMove() {
      if (keyboardFocusRef.current) dismissKeyboardFocus();
    }
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  function keyboardBack() {
    if (combat.phase !== "select_player_actions") return;
    if (swapSelection) {
      setSwapSelection(null);
      setMenu("actions");
      return;
    }
    if (targeting) {
      setTargeting(null);
      setMenu("skills");
      return;
    }
    if (menu !== "actions") {
      setMenu("actions");
      return;
    }
    if (currentActorIndex > 0) backToPreviousActor();
  }

  useEffect(() => {
    setActions(Object.fromEntries(
      activePlayer
        .filter((unit) => isActorRecharging(battle, unit.key))
        .map((unit) => [unit.key, { actorKey: unit.key, type: "skip" as const, cost: 0 }]),
    ));
    setManaSubmitAnimating(false);
    setTargeting(null);
    setSwapSelection(null);
    setMenu("actions");
  }, [combat.run.battleIndex, battle.turn, combat.phase === "select_player_actions"]);

  useLayoutEffect(() => {
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
    if (!loadingNarration) {
      setLoadingDots(1);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingDots((current) => current >= 3 ? 1 : current + 1);
    }, 220);
    return () => window.clearInterval(timer);
  }, [loadingNarration]);

  useEffect(() => {
    if (!manaSubmitAnimating || combat.phase === "select_player_actions") return;
    setManaSubmitAnimating(false);
  }, [combat.phase, manaSubmitAnimating]);

  useEffect(() => {
    setVisibleNarration("");
    if (!narrationText) {
      setNarrationSettled(true);
      return;
    }

    setNarrationSettled(false);
    let visibleLength = 0;
    const timer = window.setInterval(() => {
      visibleLength += 1;
      setVisibleNarration(narrationText.slice(0, visibleLength));
      if (visibleLength >= narrationText.length) {
        window.clearInterval(timer);
        setNarrationSettled(true);
      }
    }, NARRATION_TYPEWRITER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [narrationText]);

  useEffect(() => {
    if (combat.phase !== "event_playback" || !event) {
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
        setCombat((current) => current ? revealDungeonSwapEvent(current) : current);
      }, 720);
      const settleTimer = window.setTimeout(() => setEventSettled(true), 1_180);
      return () => {
        window.clearTimeout(revealTimer);
        window.clearTimeout(settleTimer);
      };
    }
    const duration = event.kind === "skill" || event.kind === "status" || event.kind === "block"
      ? 620
      : event.kind === "mana_refund"
        ? 780
      : event.kind === "other" || event.kind === "wait"
        ? 420
        : 720;
    const timer = window.setTimeout(() => setEventSettled(true), duration);
    return () => window.clearTimeout(timer);
  }, [combat.phase, event?.id]);

  useEffect(() => {
    if (combat.phase !== "event_playback" || event?.kind !== "mana_refund" || submittingProgress) return;
    const timer = window.setTimeout(() => {
      setCombat((current) => current ? advanceDungeonEvent(current) : current);
    }, 860);
    return () => window.clearTimeout(timer);
  }, [combat.phase, event?.id, submittingProgress]);

  function advanceNarration() {
    if (!narrationAdvanceable) return;
    setCombat((current) => current
      ? current.phase === "event_playback"
        ? advanceDungeonEvent(current)
        : current.phase === "entry_dialogue" || current.phase === "outcome_dialogue"
          ? continueDungeonDialogue(current)
          : continueAfterRoll(current)
      : current);
  }

  useEffect(() => {
    if (!narrationAdvanceable) return;
    function handleSpacebar(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (target instanceof HTMLElement && target.closest("button, [role='button'], [data-combat-control]")) return;
      event.preventDefault();
      advanceNarration();
    }
    window.addEventListener("keydown", handleSpacebar);
    return () => window.removeEventListener("keydown", handleSpacebar);
  }, [narrationAdvanceable, combat.phase, diceSettled, eventSettled, loadingNarration]);

  const keyboardFocusSignature = [
    combat.phase,
    menu,
    targeting?.actorKey ?? "",
    targeting?.skill.id ?? "",
    swapSelection?.actorKey ?? "",
    currentActor?.key ?? "",
    Object.keys(actions).sort().join(","),
    diceSettled,
    event?.id ?? "",
    eventSettled,
    loadingNarration,
    recordingResult,
  ].join("|");

  useLayoutEffect(() => {
    const root = combatRootRef.current;
    if (!root) return;
    const commandFocusKey = combat.phase === "await_roll"
      ? "roll"
      : combat.phase === "select_player_actions" && !targeting && !currentActor
        ? "submit"
        : "";
    const commandFocusStarted = commandFocusKey !== "" && lastCommandFocusKeyRef.current !== commandFocusKey;
    lastCommandFocusKeyRef.current = commandFocusKey;
    if (commandFocusStarted) {
      focusCombatControl(commandFocusKey);
      return;
    }
    const actionMenuFocusKey = combat.phase === "select_player_actions" && menu === "actions" && !targeting && !swapSelection && currentActor
      ? currentActor.key
      : "";
    const actionMenuStarted = actionMenuFocusKey !== "" && lastActionMenuFocusKeyRef.current !== actionMenuFocusKey;
    lastActionMenuFocusKeyRef.current = actionMenuFocusKey;
    if (actionMenuStarted) {
      focusCombatControl("action-primary");
      return;
    }
    const skillMenuFocusKey = combat.phase === "select_player_actions" && menu === "skills" && !targeting && currentActor
      ? `${currentActor.key}:${lastSkillByActorKeyRef.current[currentActor.key] ?? ""}`
      : "";
    const skillMenuStarted = skillMenuFocusKey !== "" && lastSkillMenuFocusKeyRef.current !== skillMenuFocusKey;
    lastSkillMenuFocusKeyRef.current = skillMenuFocusKey;
    if (skillMenuStarted) {
      focusCombatControl("skill", lastSkillByActorKeyRef.current[currentActor!.key]);
      return;
    }
    const active = keyboardFocusRef.current;
    if (
      active instanceof HTMLElement
      && root.contains(active)
      && active.closest<HTMLElement>("[data-combat-control]")
      && active.getClientRects().length > 0
    ) {
      if (!active.matches(":disabled") && document.activeElement !== active) setCombatKeyboardFocus(active);
      return;
    }
    focusCombatControl(defaultCombatFocusRole());
  }, [keyboardFocusSignature]);

  useEffect(() => {
    function handleCombatKeyboard(event: KeyboardEvent) {
      const root = combatRootRef.current;
      if (!root) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      const active = document.activeElement;
      const focusInsideCombat = (active instanceof HTMLElement && root.contains(active)) || Boolean(keyboardFocusRef.current && root.contains(keyboardFocusRef.current));
      if (!focusInsideCombat && active !== document.body) return;

      if (event.code === "ShiftLeft") {
        if (event.repeat) return;
        event.preventDefault();
        keyboardBack();
        return;
      }

      const direction = event.code === "ArrowUp" || event.code === "KeyW" ? "up"
        : event.code === "ArrowDown" || event.code === "KeyS" ? "down"
          : event.code === "ArrowLeft" || event.code === "KeyA" ? "left"
            : event.code === "ArrowRight" || event.code === "KeyD" ? "right"
              : null;
      if (direction) {
        event.preventDefault();
        moveCombatFocus(direction);
        return;
      }

      if (event.code !== "Space" || event.repeat) return;
      if (target?.closest("button, [role='button'], [data-combat-control]")) return;
      if (narrationAdvanceable) return;
      const control = keyboardFocusRef.current
        ?? focusCombatControl(defaultCombatFocusRole());
      if (!control) return;
      event.preventDefault();
      activateCombatKeyboardControl(control);
    }
    window.addEventListener("keydown", handleCombatKeyboard);
    return () => window.removeEventListener("keydown", handleCombatKeyboard);
  }, [combat.phase, menu, targeting, swapSelection, currentActor?.key, currentActorIndex, actions, narrationAdvanceable, loadingNarration]);

  useLayoutEffect(() => {
    setSwapMotion(null);
    if (combat.phase !== "event_playback" || event?.kind !== "swap" || !event.swap) return;
    const root = viewportFitRef.current;
    if (!root) return;
    const movingKey = swapRevealed ? event.swap.incomingKey : event.swap.outgoingKey;
    const actor = [...root.querySelectorAll<HTMLElement>("[data-combat-unit-key]")]
      .find((node) => node.dataset.combatUnitKey === movingKey);
    const source = actor?.querySelector<HTMLElement>(".critter-combat-frame");
    const destination = root.querySelector<HTMLElement>(`[data-combat-squad-unit-key="${movingKey}"]`);
    if (!source || !destination) return;
    const sourceRect = source.getBoundingClientRect();
    const destinationRect = destination.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const travel = combatSwapTravelOffset(
      { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 },
      { x: destinationRect.left + destinationRect.width / 2, y: destinationRect.top + destinationRect.height / 2 },
      swapRevealed ? "in" : "out",
      scale,
    );
    setSwapMotion({
      eventId: event.id,
      actorKey: movingKey,
      phase: swapRevealed ? "in" : "out",
      x: travel.x,
      y: travel.y,
    });
  }, [combat.phase, event?.id, swapRevealed]);

  function setAction(action: CombatAction) {
    setActions((current) => ({ ...current, [action.actorKey]: action }));
    setTargeting(null);
    setSwapSelection(null);
    setMenu("actions");
  }

  function beginRegularSwap(actorKey: string) {
    setTargeting(null);
    setSwapSelection({ actorKey, mode: "regular" });
    setMenu("swap");
  }

  function selectSwapTarget(targetKey: string) {
    if (swapSelection) {
      const actor = battle.playerUnits.find((unit) => unit.key === swapSelection.actorKey);
      if (!actor || !availableHealthySwapTargets(actor.key).some((unit) => unit.key === targetKey)) return;
      const action = { actorKey: actor.key, type: "swap" as const, swapInKey: targetKey, cost: actor.stats.swapCost };
      setAction({ ...action, cost: calculateActionCostBreakdown(battle, action).final });
      return;
    }
    if (!targeting || targeting.phase !== "swap") return;
    const target = availableHealthySwapTargets(targeting.actorKey).find((unit) => unit.key === targetKey);
    if (!target) return;
    const action = {
      actorKey: targeting.actorKey,
      type: "skill" as const,
      skillId: targeting.skill.id,
      targetKey: targeting.primaryTargetKey,
      swapTargetKey: target.key,
      cost: targeting.skill.mana_cost,
    };
    setAction({ ...action, cost: calculateActionCostBreakdown(battle, action).final });
  }

  function selectSkillTarget(targetKey: string) {
    if (!targeting) return;
    if (targeting.phase === "primary") {
      const needsSwapTarget = skillHasPostAttackSwap(battle, targeting.actorKey, targeting.skill.id)
        && availableHealthySwapTargets(targeting.actorKey).length > 1;
      if (needsSwapTarget) {
        setTargeting({ ...targeting, phase: "swap", primaryTargetKey: targetKey });
        return;
      }
      const onlySwapTarget = skillHasPostAttackSwap(battle, targeting.actorKey, targeting.skill.id)
        ? availableHealthySwapTargets(targeting.actorKey)[0]
        : undefined;
      const action = { actorKey: targeting.actorKey, type: "skill" as const, skillId: targeting.skill.id, targetKey, swapTargetKey: onlySwapTarget?.key, cost: targeting.skill.mana_cost };
      setAction({ ...action, cost: calculateActionCostBreakdown(battle, action).final });
      return;
    }
    selectSwapTarget(targetKey);
  }

  function chooseSkill(actorKey: string, skill: Skill) {
    lastSkillByActorKeyRef.current[actorKey] = skill.id;
    const targets = skillTargets(battle, actorKey, skill);
    if (isSingleTarget(skill) && targets.length > 1) {
      setTargeting({ actorKey, skill, phase: "primary" });
      return;
    }
    const targetKey = isSingleTarget(skill) ? targets[0]?.key : undefined;
    const healthySwapTargets = skillHasPostAttackSwap(battle, actorKey, skill.id)
      ? availableHealthySwapTargets(actorKey)
      : [];
    if (healthySwapTargets.length > 1) {
      setTargeting({ actorKey, skill, phase: "swap", primaryTargetKey: targetKey });
      return;
    }
    const action = { actorKey, type: "skill" as const, skillId: skill.id, targetKey, swapTargetKey: healthySwapTargets[0]?.key, cost: skill.mana_cost };
    setAction({ ...action, cost: calculateActionCostBreakdown(battle, action).final });
  }

  function backToPreviousActor() {
    if (currentActorIndex < 1) {
      setMenu("actions");
      setTargeting(null);
      return;
    }
    const previousIndex = currentActorIndex - 1;
    setActions((current) => Object.fromEntries(
      Object.entries(current).filter(([actorKey]) => (
        isActorRecharging(battle, actorKey)
        || activePlayer.findIndex((unit) => unit.key === actorKey) < previousIndex
      )),
    ));
    setMenu("actions");
    setTargeting(null);
    setSwapSelection(null);
  }

  function reselectAction(actorKey: string) {
    const actorIndex = activePlayer.findIndex((unit) => unit.key === actorKey);
    if (actorIndex < 0) return;
    setActions((current) => Object.fromEntries(
      Object.entries(current).filter(([selectedActorKey]) => (
        isActorRecharging(battle, selectedActorKey)
        || activePlayer.findIndex((unit) => unit.key === selectedActorKey) < actorIndex
      )),
    ));
    setMenu("actions");
    setTargeting(null);
    setSwapSelection(null);
  }

  async function submitActions() {
    if (!actionsReady) return;
    const selectedActions = activePlayer.map((unit) => actions[unit.key]);
    setManaSubmitAnimating(true);
    setSubmittingProgress(true);
    // Let the Loading narration paint before the synchronous resolver does its
    // work. This keeps the UI responsive without moving deterministic combat
    // rules into a worker prematurely.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const resolved = submitDungeonActions(combat, selectedActions);
    try {
      // Keep the resolved presentation out of the tree until turn loading has
      // finished. Presentation classes start their animations on mount.
      setCombat((current) => current
        && current.run.id === combat.run.id
        && current.battle.turn === combat.battle.turn
        && current.phase === "select_player_actions"
        ? resolved
        : current);
    } finally {
      setSubmittingProgress(false);
    }
  }

  if (combat.phase === "dungeon_complete" || combat.phase === "dungeon_failed") {
    const complete = combat.phase === "dungeon_complete";
    return (
      <DungeonOutcomeScreen
        data={data}
        combat={combat}
        complete={complete}
        keyboardRootRef={combatRootRef}
        onHome={onHome}
        onReplay={onReplay}
        onNextDungeon={onNextDungeon}
      />
    );
  }

  return (
    <section
      ref={combatRootRef}
      className="combat-screen"
      data-combat-loading={loadingNarration ? "true" : "false"}
      aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Space ShiftLeft"
    >
      <div ref={viewportFitRef} className="combat-viewport-fit">
        <div className="combat-header">
          <button className="secondary-button" onClick={onBack}><ChevronLeft size={16} /> Dungeons</button>
          <div>
            <p className="eyebrow">{combat.run.effectiveMode === "boss" ? "Boss expedition" : "Dungeon expedition"}</p>
            <h1>{combat.dungeon.name}</h1>
            <p>Encounter {combat.run.battleIndex} / {combat.run.battleCount} · Turn {battle.turn} · {combat.run.battleFormat}</p>
          </div>
        </div>

        <div className="combat-board">
          <CombatRollcasterPanel
            data={data}
            name={activeRollcaster?.name ?? "Rollcaster"}
            assetPath={preferredAssetPath(data, "rollcaster", activeRollcaster?.id, activeRollcaster?.asset_path, ["battle", "portrait", "card"])}
            mana={displayedPlayerMana}
            manaAssetPath={manaAssetPath}
            manaRefund={playerManaRefund?.amount}
            manaReserved={playerManaReserved}
            manaSubmitting={manaSubmitAnimating}
            abilities={activeAbilitySlots}
            units={battle.playerUnits}
            opponent={false}
            revealedOpponentKeys={revealedOpponentKeys}
            selectableSwapKeys={swapActorKey && battle.playerUnits.some((unit) => unit.key === swapActorKey) ? new Set(swapTargetKeys) : new Set()}
            onSwapTarget={selectSwapTarget}
          />
          <div className="battle-column player-column">
            {[0, 1, 2].map((slot) => {
              const unit = battle.playerUnits.find((candidate) => candidate.active && candidate.battlefieldSlot === slot);
              if (!unit || !playerFieldSlots.includes(slot)) return <CombatEmptySlot key={slot} label="Inactive player slot" />;
              return <BattleUnit
                key={unit.key}
                unit={unit}
                battle={battle}
                data={data}
                allUnits={[...battle.playerUnits, ...battle.opponentUnits]}
                action={actions[unit.key]}
                interactive={combat.phase === "select_player_actions" && currentActor?.key === unit.key && (swapSelection?.actorKey === unit.key || (!swapSelection && (!targeting || targeting.actorKey === unit.key)))}
                waiting={combat.phase === "select_player_actions" && unit.active && unit.hp > 0 && currentActor?.key !== unit.key && !actions[unit.key]}
                menu={currentActor?.key === unit.key ? menu : "actions"}
                setMenu={setMenu}
                availableMana={battle.playerMana - totalCost}
                onAction={setAction}
                onBeginSwap={beginRegularSwap}
                onChooseSkill={chooseSkill}
                onBack={targeting?.actorKey === unit.key
                  ? () => { setTargeting(null); setMenu("skills"); }
                  : swapSelection?.actorKey === unit.key
                    ? () => { setSwapSelection(null); setMenu("actions"); }
                    : menu === "skills"
                      ? () => { setTargeting(null); setMenu("actions"); }
                      : backToPreviousActor}
                showBack={targeting?.actorKey === unit.key || swapSelection?.actorKey === unit.key || menu === "skills" || (menu === "actions" && currentActorIndex > 0)}
                targeting={targeting?.actorKey === unit.key}
                onReselectAction={combat.phase === "select_player_actions" && actions[unit.key] && !isActorRecharging(battle, unit.key)
                  ? () => reselectAction(unit.key)
                  : undefined}
                targetable={legalTargetKeys.has(unit.key)}
                onTarget={() => targeting && selectSkillTarget(unit.key)}
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
                    battle={battle}
                    data={data}
                    allUnits={[...battle.playerUnits, ...battle.opponentUnits]}
                    opponent
                    targetable={legalTargetKeys.has(unit.key)}
                    onTarget={() => targeting && selectSkillTarget(unit.key)}
                    statuses={battle.statuses.filter((status) => status.holderKey === unit.key)}
                    manaAssetPath={manaAssetPath}
                    presentation={event}
                    swapMotion={swapMotion !== null && swapMotion.eventId === event?.id && swapMotion.actorKey === unit.key
                      ? swapMotion
                      : undefined}
                  />
                : <CombatEmptySlot key={slot} label="Inactive enemy slot" opponent />;
            })}
          </div>
          <CombatRollcasterPanel
            data={data}
            name={enemyRollcaster?.name ?? "Enemy"}
            assetPath={preferredAssetPath(data, "eclipse-order", enemyRollcaster?.id, enemyRollcasterAssetPath, ["battle", "portrait", "card"])}
            mana={battle.opponentMana}
            manaAssetPath={manaAssetPath}
            manaRefund={opponentManaRefund?.amount}
            abilities={Array.from({ length: 5 }, (_, index) => enemyAbilities[index])}
            units={battle.opponentUnits}
            opponent
            revealedOpponentKeys={revealedOpponentKeys}
            selectableSwapKeys={swapActorKey && battle.opponentUnits.some((unit) => unit.key === swapActorKey) ? new Set(swapTargetKeys) : new Set()}
            onSwapTarget={selectSwapTarget}
          />
        </div>

        {targeting && targeting.phase === "primary" && inactiveLegalTargets.length > 0 && (
          <div className="combat-knocked-out-targets" aria-label="Knocked-out revival targets">
            <span>Knocked-out targets</span>
            {inactiveLegalTargets.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                data-combat-control="true"
                data-combat-focus-role="target"
                data-combat-unit-key={candidate.key}
                onClick={() => selectSkillTarget(candidate.key)}
              >
                <SpriteFrame size="xs"><Sprite name={candidate.name} element={candidate.critter.element_1_id} assetPath={preferredAssetPath(data, "critter", candidate.critter.id, candidate.critter.asset_path, ["battle", "card", "thumb"])} /></SpriteFrame>
                <span><strong>{candidate.name}</strong><small>0 / {candidate.maxHp} HP</small></span>
              </button>
            ))}
          </div>
        )}

        <CombatDiceRow
          data={data}
          combat={combat}
          manaAssetPath={manaAssetPath}
          rolling={!diceSettled}
          onRoll={() => {
            setDiceSettled(false);
            setCombat((current) => current ? rollDungeonDice(current) : current);
          }}
          canSubmit={actionsReady}
          submitting={submittingProgress}
          onSubmit={submitActions}
        />

        <button
          type="button"
          className={`combat-narration ${narrationAdvanceable ? "advanceable" : ""}`}
          data-combat-control={loadingNarration || manaRefundNarration ? undefined : "true"}
          data-combat-focus-role={loadingNarration || manaRefundNarration ? undefined : "narration"}
          tabIndex={loadingNarration || manaRefundNarration ? -1 : undefined}
          aria-label={loadingNarration ? (recordingResult ? "Waiting for encounter results" : "Loading") : manaRefundNarration ? "Mana restored" : undefined}
          disabled={loadingNarration || manaRefundNarration || !narrationAdvanceable}
          aria-keyshortcuts="Space"
          title={!loadingNarration && !manaRefundNarration && narrationAdvanceable ? "Click or press Space to continue" : undefined}
          onClick={loadingNarration || manaRefundNarration ? undefined : advanceNarration}
        >
          <span className={`combat-narration-copy ${narrationComplete && narrationText !== "Rolling…" && !loadingNarration ? "" : "typing"}`}>
            {dialogue && (combat.phase === "entry_dialogue" || combat.phase === "outcome_dialogue") && visibleNarration.startsWith(`${dialogue.speaker}:`)
              ? <><span className="enemy-dialogue-speaker">{dialogue.speaker}:</span>{visibleNarration.slice(dialogue.speaker.length + 1)}</>
              : narrationText === "Rolling…" || loadingNarration ? narrationText : visibleNarration}
          </span>
          {!loadingNarration && !manaRefundNarration && (["event_playback", "roll_result", "entry_dialogue", "outcome_dialogue"].includes(combat.phase)) && <ChevronRight size={24} aria-label="Next" />}
        </button>

        {combat.phase === "battle_result" && !recordingResult && (
          <div className="combat-command-row">
            <button className="primary-button" data-combat-control="true" data-combat-focus-role="retry" onClick={() => setResultAttempt((attempt) => attempt + 1)}>
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
          onAction={() => setCombat((current) => current ? continueAfterEncounterRewards(current) : current)}
        />
      )}
      {(combat.phase === "lead_selection" || combat.phase === "forced_replacements") && (
        <CombatLeadDialog
          data={data}
          combat={combat}
          onToggle={(id) => setCombat((current) => current ? toggleDungeonLead(current, id) : current)}
          onConfirm={() => setCombat((current) => current ? confirmDungeonLeads(current) : current)}
        />
      )}
    </section>
  );
}

function CombatRollcasterPanel({
  data,
  name,
  assetPath,
  mana,
  manaAssetPath,
  manaRefund,
  manaReserved,
  manaSubmitting,
  abilities,
  units,
  opponent,
  revealedOpponentKeys,
  selectableSwapKeys = new Set(),
  onSwapTarget,
}: {
  data: AppData;
  name: string;
  assetPath: string | null;
  mana: number;
  manaAssetPath: string | null;
  manaRefund?: number;
  manaReserved?: boolean;
  manaSubmitting?: boolean;
  abilities: Array<RollcasterAbility | undefined>;
  units: CombatState["playerUnits"];
  opponent: boolean;
  revealedOpponentKeys: Set<string>;
  selectableSwapKeys?: Set<string>;
  onSwapTarget?: (targetKey: string) => void;
}) {
  return (
    <aside className={`combat-mana-panel ${opponent ? "enemy-mana-panel" : "rollcaster-mana-panel"} ${manaRefund ? "mana-refund-panel" : ""}`}>
      <span className="combat-sprite-frame rollcaster-combat-frame">
        <Sprite name={name} element="basic" assetPath={assetPath} size="large" fit="portrait" flipped={opponent} />
      </span>
      <h3>{name}</h3>
      <div className="combat-mana-total-wrap">
        <strong
          className={`combat-mana-total ${manaRefund ? "mana-refund-counter" : ""} ${manaReserved && !manaSubmitting ? "mana-reserved" : ""} ${manaSubmitting ? "mana-submit-shake" : ""}`.trim()}
          aria-label={`${opponent ? "Enemy" : "Player"} Mana: ${mana}${manaReserved ? " remaining" : ""}`}
        >
          <AssetIcon path={manaAssetPath} alt={`${opponent ? "Enemy" : "Player"} Mana`} fallback={<Gem />} />
          <span className="combat-mana-value">{mana}</span>
        </strong>
        {manaRefund && <span className="mana-refund-pop" aria-hidden="true">+{manaRefund}</span>}
      </div>
      <div className="combat-ability-list" aria-label={`${opponent ? "Enemy" : "User"} Rollcaster abilities`}>
        {abilities.map((ability, index) => ability
          ? <GameTooltip
              key={ability.id}
              label={`${ability.name}. ${ability.description} ${attachmentText(data.catalog.effectsByAbility[ability.id] ?? [])}`}
              content={<><strong>{ability.name}</strong><span>{ability.description}</span>{attachmentRows(data.catalog.effectsByAbility[ability.id] ?? [])}</>}
            >
              <span className={`combat-ability-slot ${opponent ? "enemy" : ""}`}>{ability.name}</span>
            </GameTooltip>
          : <span key={`empty-ability-${index}`} className={`combat-ability-slot empty ${opponent ? "enemy" : ""}`} aria-label={`Empty ability slot ${index + 1}`} />)}
      </div>
      <CombatSquadGrid data={data} units={units} opponent={opponent} revealedOpponentKeys={revealedOpponentKeys} selectableSwapKeys={selectableSwapKeys} onSwapTarget={onSwapTarget} />
    </aside>
  );
}

function CombatSquadGrid({
  data,
  units,
  opponent,
  revealedOpponentKeys,
  selectableSwapKeys = new Set(),
  onSwapTarget,
}: {
  data: AppData;
  units: CombatState["playerUnits"];
  opponent: boolean;
  revealedOpponentKeys: Set<string>;
  selectableSwapKeys?: Set<string>;
  onSwapTarget?: (targetKey: string) => void;
}) {
  return (
    <div className={`combat-squad-grid ${opponent ? "opponent" : "player"}`} aria-label={`${opponent ? "Enemy" : "User"} Critter squad`}>
      {Array.from({ length: 5 }, (_, index) => {
        const unit = units[index];
        if (!unit) return <span key={`empty-squad-${index}`} className="combat-squad-slot empty" aria-label={`Empty squad slot ${index + 1}`} />;
        const unknown = opponent && !revealedOpponentKeys.has(unit.key);
        if (unknown) {
          return <GameTooltip key={unit.key} label="Unknown enemy Critter" content={<><strong>Unknown enemy Critter</strong><span>This Critter has not been revealed.</span></>}>
            <span className="combat-squad-slot unknown" data-combat-squad-unit-key={unit.key} aria-label="Unknown enemy Critter">?</span>
          </GameTooltip>;
        }
        const ko = unit.hp <= 0;
        const selectable = selectableSwapKeys.has(unit.key);
        const slot = <span className={`combat-squad-slot ${unit.active ? "active" : "reserve"} ${ko ? "ko" : ""} ${selectable ? "legal-target" : ""}`} data-combat-squad-unit-key={unit.key} aria-label={`${unit.name}: ${unit.hp} / ${unit.maxHp} HP`}>
          <Sprite name={unit.name} element={unit.critter.element_1_id} assetPath={preferredAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path, ["battle", "card", "thumb"])} size="small" flipped={opponent} />
        </span>;
        const interactiveSlot = selectable
          ? <button type="button" className="combat-squad-slot-button" data-combat-control="true" data-combat-focus-role="target" data-combat-unit-key={unit.key} aria-label={`Swap to ${unit.name}`} onClick={() => onSwapTarget?.(unit.key)}>{slot}</button>
          : slot;
        return <GameTooltip
          key={unit.key}
          label={`${unit.name}: ${unit.hp} / ${unit.maxHp} HP`}
          content={<><span className="tooltip-heading"><CritterElementLogos data={data} critter={unit.critter} /><strong>{unit.name}</strong></span><span>{unit.hp} / {unit.maxHp} HP</span></>}
        >
          {interactiveSlot}
        </GameTooltip>;
      })}
    </div>
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
                data-combat-control="true"
                data-combat-focus-role="lead"
                disabled={unit.hp <= 0 || fixed}
                aria-pressed={selected}
                onClick={() => onToggle(ownedId)}
              >
                <SpriteFrame size="md"><Sprite name={unit.name} element={unit.critter.element_1_id} assetPath={preferredAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path, ["battle", "card", "thumb"])} /></SpriteFrame>
                <span className="combat-lead-option-copy">
                  <CritterName data={data} critter={unit.critter} />
                  <small>Lv {unit.level} · {unit.hp} / {unit.maxHp} HP</small>
                  {unit.hp <= 0 && <strong>Knocked out</strong>}
                  {fixed && <strong>Already active</strong>}
                </span>
                {selected && <span className="combat-lead-selection-check" aria-hidden="true"><Check size={19} /></span>}
              </button>
            );
          })}
        </div>
        <button className="primary-button combat-lead-confirm" data-combat-control="true" data-combat-focus-role="lead-confirm" disabled={combat.selectedLeadIds.length !== combat.requiredLeadCount} onClick={onConfirm}>
          {choosingReplacements ? "Resume Encounter" : "Start Encounter"}
        </button>
      </section>
    </div>
  );
}

function BattleUnit({
  unit,
  battle,
  data,
  allUnits = [],
  action,
  interactive = false,
  waiting = false,
  menu = "actions",
  setMenu,
  onAction,
  onBeginSwap,
  onChooseSkill,
  onBack,
  showBack = false,
  targeting = false,
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
  battle: CombatState;
  data: AppData;
  allUnits?: CombatState["playerUnits"];
  action?: CombatAction;
  interactive?: boolean;
  waiting?: boolean;
  menu?: "actions" | "skills" | "swap";
  setMenu?: (menu: "actions" | "skills" | "swap") => void;
  onAction?: (action: CombatAction) => void;
  onBeginSwap?: (actorKey: string) => void;
  onChooseSkill?: (actorKey: string, skill: Skill) => void;
  onBack?: () => void;
  showBack?: boolean;
  targeting?: boolean;
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
  const maxHp = Math.max(1, unit.maxHp);
  const shieldExceedsMaxHp = unit.shield > maxHp;
  const barCapacity = shieldExceedsMaxHp ? Math.max(1, unit.hp + unit.shield) : maxHp;
  const visualShield = shieldExceedsMaxHp ? unit.shield : Math.min(unit.shield, maxHp);
  const visualHealth = shieldExceedsMaxHp
    ? Math.min(unit.hp, maxHp)
    : Math.min(unit.hp, Math.max(0, maxHp - visualShield));
  const healthPct = Math.max(0, Math.min(100, (visualHealth / barCapacity) * 100));
  const shieldPct = Math.max(0, Math.min(100, (visualShield / barCapacity) * 100));
  const summary = action ? combatActionSummary(data, battle, allUnits, unit, action) : null;
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
            ? presentation.effectPolarity === "negative" ? "receiving-negative" : "receiving-status"
            : presentation.kind === "other"
              ? presentation.effectPolarity === "negative" ? "receiving-negative" : ""
            : presentation.kind === "block"
              ? (presentation.message.includes("failed") ? "block-failed" : "block-success")
              : ""
    : "";
  const presentationToken = presentation?.id?.replace(/[^a-zA-Z0-9_-]/g, "-") ?? "no-presentation";
  const effectSummaries = combatEffectSummaries(battle, unit.key);
  const blockCost = calculateActionCostBreakdown(battle, { actorKey: unit.key, type: "block", cost: unit.stats.blockCost });
  const swapCost = calculateActionCostBreakdown(battle, { actorKey: unit.key, type: "swap", cost: unit.stats.swapCost });
  const regularSwapTargets = healthyFriendlySwapTargets(battle, unit.key);
  const relicIds = battle.setupSources
    .filter((source) => source.ownerType === "relic" && source.sourceKey === unit.key)
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map((source) => source.ownerId);
  return (
    <article
      className={`battle-unit presentation-${presentationToken} ${interactive ? "combat-unit-interactive" : ""} ${!unit.active ? "bench" : ""} ${unit.hp <= 0 ? "knocked-out" : ""} ${opponent ? "opponent" : ""} ${selected ? "selected-lead" : ""} ${selectable ? "selectable" : ""} ${targetable ? "legal-target" : ""} ${waiting ? "waiting-turn" : ""} ${acting ? "acting-skill" : ""} ${swappingOut ? "swapping-out" : ""} ${swappingIn ? "swapping-in" : ""} ${reactionClass}`}
      data-combat-control={targetable || selectable ? "true" : undefined}
      data-combat-focus-role={targetable ? "target" : selectable ? "lead" : undefined}
      data-combat-unit-key={unit.key}
      style={swapMotion ? ({
        "--combat-swap-x": `${swapMotion.x}px`,
        "--combat-swap-y": `${swapMotion.y}px`,
        "--combat-swap-in-x": `${swapMotion.x}px`,
        "--combat-swap-in-y": `${swapMotion.y}px`,
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
          <span className="combat-effect-hover-zone" tabIndex={0} aria-label={`${unit.name} sprite and active effects`}>
            <span className="combat-sprite-frame critter-combat-frame"><Sprite
              name={unit.name}
              element={unit.critter.element_1_id}
              assetPath={preferredAssetPath(data, "critter", unit.critter.id, unit.critter.asset_path, ["battle", "card", "thumb"])}
              size="medium"
              flipped={opponent}
            /></span>
            {unit.active && unit.hp > 0 && effectSummaries.length > 0 && <CombatEffectTooltip data={data} unitName={unit.name} effects={effectSummaries} />}
          </span>
          {unit.active && unit.hp > 0 && <StatusIconRow data={data} statuses={statuses} />}
        </span>
        <div className="battle-unit-info">
          <span className="combat-identity-row">
            <CritterName data={data} critter={unit.critter} />
            <strong className="combat-level">Lv {unit.level}</strong>
            <span className="mana-roll-stat"><AssetIcon path={manaAssetPath} alt="Mana Roll" fallback={<Gem />} /> {unit.stats.diceMin}–{unit.stats.diceMax}</span>
          </span>
          <div
            className="hp-bar"
            role="progressbar"
            aria-label={`${unit.name} health and shield`}
            aria-valuemin={0}
            aria-valuemax={barCapacity}
            aria-valuenow={visualHealth + visualShield}
            aria-valuetext={`${unit.hp} of ${unit.maxHp} HP${unit.shield > 0 ? ` and ${unit.shield} Shield` : ""}`}
          >
            <span className="hp-bar-health" style={{ width: `${healthPct}%` }} />
            {visualShield > 0 && <span className="hp-bar-shield" style={{ left: `calc(${healthPct}% - 2px)`, width: `calc(${shieldPct}% + 2px)` }} />}
          </div>
          <div className="combat-health-row">
            <p>{unit.hp} / {unit.maxHp} HP {unit.shield > 0 ? `· ${unit.shield} Shield` : ""} {unit.blocking ? "· Blocking" : ""}</p>
            <CombatRelicRow data={data} relicIds={relicIds} sourceCritter={unit.critter} />
          </div>
        </div>
      </div>
      <div className="combat-action-space">
        {interactive && onAction && (
          <>
            {showBack && <button className="combat-back-row" data-combat-control="true" data-combat-focus-role="back" onClick={(event) => { event.stopPropagation(); onBack?.(); }}>
              <ChevronLeft size={14} /> {targeting ? "Back to Skill Menu" : menu === "actions" ? "Back to previous Critter" : "Back to Action Menu"}
            </button>}
            {menu === "actions" && <div className="combat-primary-actions">
              <button data-combat-control="true" data-combat-focus-role="action-primary" onClick={(event) => { event.stopPropagation(); setMenu?.("skills"); }}><Swords size={16} /> Skill</button>
              <button data-combat-control="true" data-combat-focus-role="action-primary" disabled={blockCost.final > availableMana} onClick={(event) => { event.stopPropagation(); onAction({ actorKey: unit.key, type: "block", cost: blockCost.final }); }}><Shield size={16} /> Block <ManaCost path={manaAssetPath} amount={blockCost.final} breakdown={blockCost} /></button>
              <button data-combat-control="true" data-combat-focus-role="action-primary" disabled={regularSwapTargets.length === 0 || swapCost.final > availableMana} onClick={(event) => { event.stopPropagation(); onBeginSwap?.(unit.key); }}><RefreshCw size={16} /> Swap <ManaCost path={manaAssetPath} amount={swapCost.final} breakdown={swapCost} /></button>
              <button data-combat-control="true" data-combat-focus-role="action-primary" onClick={(event) => { event.stopPropagation(); onAction({ actorKey: unit.key, type: "skip", cost: 0 }); }}><ChevronRight size={16} /> Skip <ManaCost path={manaAssetPath} amount={0} /></button>
            </div>}
            {menu === "skills" && !targeting && <div className="combat-skill-actions">
              {[0, 1, 2, 3].map((slot) => {
                const skill = unit.skills[slot];
                const skillCost = skill ? calculateActionCostBreakdown(battle, { actorKey: unit.key, type: "skill", skillId: skill.id, cost: skill.mana_cost }) : undefined;
                const availability = skill ? skillAvailability(battle, unit.key, skill.id) : undefined;
                const disabledReason = !availability?.selectable
                  ? availability?.reason
                  : skillCost!.final > availableMana ? "Insufficient Mana." : undefined;
                return skill
                  ? <SkillTile
                      key={skill.id}
                      data={data}
                      skill={skill}
                      sourceCritter={unit.critter}
                      manaCost={skillCost?.final}
                      manaCostBreakdown={skillCost}
                      disabled={Boolean(disabledReason)}
                      disabledReason={disabledReason}
                      combatControl
                      combatSkillId={skill.id}
                      onClick={(event) => { event.stopPropagation(); onChooseSkill?.(unit.key, skill); }}
                    />
                  : <button key={slot} className="combat-empty-skill" data-combat-control="true" data-combat-focus-role="skill" disabled>-----</button>;
              })}
            </div>}
          </>
        )}
        {!interactive && (
          <div className={`combat-action-status-row ${onReselectAction ? "editable" : ""}`}>
            {onReselectAction && (
              <button
                type="button"
                className="combat-reselect-action"
                data-combat-control="true"
                data-combat-focus-role="reselect"
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
    </article>
  );
}

function CombatEffectTooltip({ data, unitName, effects }: { data: AppData; unitName: string; effects: ReturnType<typeof combatEffectSummaries> }) {
  return <aside className="combat-effect-tooltip" role="tooltip" aria-label={`${unitName} active effects`}>
    <strong className="combat-effect-heading">Active effects</strong>
    {effects.map((effect) => <span key={effect.id} className={`combat-effect-row effect-classification-${effect.classification}`} title={effect.description}>
      <strong>{effect.amountLabel ?? effect.name}</strong>
      <span>({combatEffectSourceName(data, effect.sourceOwnerType, effect.sourceOwnerId)})</span>
      {effect.kind === "status" && effect.duration !== undefined && <small>{effect.duration === null ? "Indefinite" : `${effect.duration} turn${effect.duration === 1 ? "" : "s"}`}</small>}
    </span>)}
  </aside>;
}

function combatEffectSourceName(data: AppData, ownerType: "skill" | "ability" | "relic" | "status", ownerId: string): string {
  if (ownerType === "skill") return byId(data.catalog.skills, ownerId)?.name ?? ownerId;
  if (ownerType === "ability") return byId(data.catalog.rollcasterAbilities, ownerId)?.name ?? ownerId;
  if (ownerType === "relic") return byId(data.catalog.relics, ownerId)?.name ?? ownerId;
  return byId(data.catalog.statuses, ownerId)?.name ?? ownerId;
}

function CombatRelicRow({ data, relicIds, sourceCritter }: { data: AppData; relicIds: string[]; sourceCritter: Critter }) {
  if (!relicIds.length) return null;
  return <span className="combat-relic-row" aria-label="Equipped relics">{relicIds.map((id) => {
    const relic = byId(data.catalog.relics, id);
    if (!relic) return null;
    const effects = data.catalog.effectsByRelic[id] ?? [];
    return <GameTooltip key={id} label={`${relic.name}. ${relic.description} ${attachmentText(effects)}`} content={<><strong>{relic.name}</strong><span>{relic.description}</span>{attachmentRows(effects, sourceCritter)}</>}>
      <span className="combat-relic-icon"><AssetIcon path={preferredAssetPath(data, "relic", relic.id, relic.asset_path, ["icon", "thumb", "card"])} alt={relic.name} fallback={<Shield size={13} />} /></span>
    </GameTooltip>;
  })}</span>;
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

function ManaCost({ path, amount, breakdown }: { path: string | null; amount: number; breakdown?: ActionCostBreakdown }) {
  const cost = <span className={`combat-mana-cost ${actionCostTone(breakdown)}`.trim()}><AssetIcon path={path} alt="Mana" fallback={<Gem />} /> {amount}</span>;
  if (!breakdown?.sources.length) return cost;
  return <GameTooltip label={costBreakdownText("Action cost", breakdown)} content={<CostBreakdownLine label="Action cost" breakdown={breakdown} />}>
    {cost}
  </GameTooltip>;
}

function combatActionSummary(
  data: AppData,
  battle: CombatState,
  allUnits: CombatState["playerUnits"],
  actor: CombatState["playerUnits"][number],
  action: CombatAction,
): { content: React.ReactNode } {
  if (action.type === "block") return { content: "Blocking" };
  if (action.type === "skip") return { content: isActorRecharging(battle, actor.key) ? "Recharging" : "Skipping" };
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
          ? <button className="primary-button roll-dice-button" data-combat-control="true" data-combat-focus-role="roll" onClick={onRoll}><Dices size={18} /> Roll Dice</button>
          : combat.phase === "select_player_actions"
            ? (
              <button
                className="primary-button combat-submit-actions"
                data-combat-control="true"
                data-combat-focus-role="submit"
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
        <button className="primary-button" data-combat-control="true" data-combat-focus-role="reward-next" onClick={onAction}>{actionLabel} <ChevronRight size={16} /></button>
      </section>
    </div>
  );
}

function RewardSummary({ data, rewards }: { data: AppData; rewards: DungeonRewardSummary }) {
  const dropEntries = aggregateDungeonRewardEntries(rewards.entries);
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
              : entry.kind === "lootbox"
                ? `${entry.amount} ${data.catalog.lootboxes.find((lootbox) => lootbox.id === entry.targetId)?.name ?? entry.targetId}`
                : `${entry.amount} ${entry.kind === "shard" ? `${collectibleName(data, (entry.targetCategory ?? "relic") as CollectibleType, entry.targetId)} Shards` : collectibleName(data, "relic", entry.targetId)}`;
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

const XP_REVEAL_DELAY_MS = 180;
const XP_FILL_TOTAL_MS = 900;
const XP_LEVEL_UP_HOLD_MS = 480;
const XP_MIN_FILL_SEGMENT_MS = 180;

type XpFillSegment = {
  kind: "fill";
  from: number;
  to: number;
  /** Keep showing this level (and fill toward 100%) even as total XP reaches the next threshold. */
  displayLevel: number;
  fillsToLevelUp: boolean;
};

type XpLevelUpSegment = {
  kind: "levelUp";
  fromLevel: number;
  toLevel: number;
};

type XpAnimSegment = XpFillSegment | XpLevelUpSegment;

type XpCardVisual = {
  level: number;
  pct: number;
  progressText: string;
  showLevelUp: boolean;
  snapBar: boolean;
};

function orderedXpThresholds(progression: XpThreshold[]): XpThreshold[] {
  return [...progression].sort((left, right) => left.level - right.level);
}

function buildXpAnimSegments(progression: XpThreshold[], startingTotal: number, finalTotal: number): XpAnimSegment[] {
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

function visualForXpTotal(progression: XpThreshold[], totalXp: number, levelOverride?: number): Omit<XpCardVisual, "showLevelUp" | "snapBar"> {
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

function visualForLevelUpHold(progression: XpThreshold[], fromLevel: number): Omit<XpCardVisual, "showLevelUp" | "snapBar"> {
  const ordered = orderedXpThresholds(progression);
  const progress = xpProgress(ordered, fromLevel, Number.MAX_SAFE_INTEGER);
  return {
    level: fromLevel,
    pct: 100,
    progressText: progress.isMaxLevel || progress.needed <= 0 ? "Max level" : `${progress.needed} / ${progress.needed} XP`,
  };
}

function XpGainSection({ data, rewards }: { data: AppData; rewards: DungeonRewardSummary }) {
  const equippedCritters = squadCritters(data.player!);
  const ownedRollcaster = data.player!.rollcasters.find((row) => row.id === data.player!.profile.active_rollcaster_id)
    ?? data.player!.rollcasters[0];
  const rollcaster = byId(data.catalog.rollcasters, ownedRollcaster?.rollcaster_id);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [xpReady, setXpReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frameA = 0;
    let timeout = 0;
    // Wait until the rewards UI has painted, then settle briefly so the party cards are readable before XP moves.
    frameA = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        setXpReady(true);
      }, XP_REVEAL_DELAY_MS);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameA);
      window.clearTimeout(timeout);
    };
  }, [rewards]);

  return (
    <section ref={sectionRef} className="combat-xp-section" aria-label="Party experience">
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
            sprite={<SpriteFrame size="sm"><Sprite name={rollcaster.name} element="basic" assetPath={preferredAssetPath(data, "rollcaster", rollcaster.id, rollcaster.asset_path, ["thumb", "card"])} fit="portrait" /></SpriteFrame>}
            identity={<strong>{rollcaster.name}</strong>}
            animate={xpReady}
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
              sprite={<SpriteFrame size="sm"><Sprite name={critter.name} element={critter.element_1_id} assetPath={preferredAssetPath(data, "critter", critter.id, critter.asset_path, ["thumb", "card"])} /></SpriteFrame>}
              identity={<CritterName data={data} critter={critter} />}
              animate={xpReady}
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
  animate,
  rollcaster = false,
}: {
  name: string;
  gain: number;
  finalTotal: number;
  progression: XpThreshold[];
  sprite: React.ReactNode;
  identity: React.ReactNode;
  animate: boolean;
  rollcaster?: boolean;
}) {
  const startingTotal = Math.max(0, finalTotal - gain);
  const initialVisual = visualForXpTotal(progression, startingTotal);
  const [visual, setVisual] = useState<XpCardVisual>({
    ...initialVisual,
    showLevelUp: false,
    snapBar: false,
  });

  useEffect(() => {
    const startVisual = visualForXpTotal(progression, startingTotal);
    setVisual({ ...startVisual, showLevelUp: false, snapBar: false });

    if (gain <= 0) return;
    if (!animate) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const endVisual = visualForXpTotal(progression, finalTotal);
      setVisual({ ...endVisual, showLevelUp: false, snapBar: true });
      return;
    }

    const segments = buildXpAnimSegments(progression, startingTotal, finalTotal);
    const fillXpTotal = segments.reduce((sum, segment) => (
      segment.kind === "fill" ? sum + Math.max(0, segment.to - segment.from) : sum
    ), 0);
    let cancelled = false;
    let frame = 0;
    const timeouts = new Set<number>();
    let index = 0;

    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timeouts.delete(id);
        fn();
      }, ms);
      timeouts.add(id);
    };

    const finish = () => {
      if (cancelled) return;
      const endVisual = visualForXpTotal(progression, finalTotal);
      setVisual({ ...endVisual, showLevelUp: false, snapBar: false });
    };

    const runNext = () => {
      if (cancelled) return;
      if (index >= segments.length) {
        finish();
        return;
      }

      const segment = segments[index];
      index += 1;

      if (segment.kind === "levelUp") {
        const holdVisual = visualForLevelUpHold(progression, segment.fromLevel);
        setVisual({
          ...holdVisual,
          level: segment.toLevel,
          showLevelUp: true,
          snapBar: false,
        });
        schedule(() => {
          if (cancelled) return;
          const ordered = orderedXpThresholds(progression);
          const thresholdXp = ordered.find((row) => row.level === segment.toLevel)?.total_required_xp ?? startingTotal;
          const nextProgress = xpProgress(ordered, segment.toLevel, thresholdXp);
          // Clear the badge and snap the bar empty on the new level before overflow XP fills.
          setVisual({
            level: segment.toLevel,
            pct: 0,
            progressText: nextProgress.isMaxLevel || nextProgress.needed <= 0
              ? "Max level"
              : `0 / ${nextProgress.needed} XP`,
            showLevelUp: false,
            snapBar: true,
          });
          schedule(() => {
            if (cancelled) return;
            runNext();
          }, 40);
        }, XP_LEVEL_UP_HOLD_MS);
        return;
      }

      const xpSpan = Math.max(0, segment.to - segment.from);
      const duration = fillXpTotal <= 0
        ? XP_MIN_FILL_SEGMENT_MS
        : Math.max(XP_MIN_FILL_SEGMENT_MS, Math.round(XP_FILL_TOTAL_MS * (xpSpan / fillXpTotal)));
      const fromVisual = visualForXpTotal(progression, segment.from, segment.displayLevel);
      const startedAt = performance.now();

      const animateFill = (now: number) => {
        if (cancelled) return;
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const total = Math.round(segment.from + (segment.to - segment.from) * eased);

        if (segment.fillsToLevelUp) {
          const startPct = fromVisual.pct;
          const pct = Math.min(100, Math.round(startPct + (100 - startPct) * eased));
          const ordered = orderedXpThresholds(progression);
          const progressState = xpProgress(ordered, segment.displayLevel, Math.min(total, segment.to - 1));
          setVisual({
            level: segment.displayLevel,
            pct,
            progressText: progressState.needed <= 0
              ? "Max level"
              : `${Math.min(progressState.needed, Math.round(progressState.needed * (pct / 100)))} / ${progressState.needed} XP`,
            showLevelUp: false,
            snapBar: false,
          });
        } else {
          const live = visualForXpTotal(progression, total, segment.displayLevel);
          setVisual({ ...live, showLevelUp: false, snapBar: false });
        }

        if (progress < 1) {
          frame = window.requestAnimationFrame(animateFill);
          return;
        }

        if (segment.fillsToLevelUp) {
          const holdVisual = visualForLevelUpHold(progression, segment.displayLevel);
          setVisual({ ...holdVisual, showLevelUp: false, snapBar: false });
        }
        runNext();
      };

      frame = window.requestAnimationFrame(animateFill);
    };

    runNext();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      for (const id of timeouts) window.clearTimeout(id);
      timeouts.clear();
    };
    // progression is catalog data stable for the mounted rewards screen; omit to avoid restarting mid-tween.
  }, [animate, startingTotal, finalTotal, gain]);

  return (
    <article
      className={`combat-xp-card ${gain > 0 ? "gained" : ""} ${rollcaster ? "rollcaster" : ""} ${visual.showLevelUp ? "leveling-up" : ""}`}
      data-xp-recipient={name}
      data-xp-gain={gain}
    >
      {sprite}
      <div className="combat-xp-card-copy">
        <span className="combat-xp-identity">{identity}<small>Lv {visual.level}</small></span>
        <div
          className={`combat-xp-bar xp-bar ${visual.snapBar ? "snap" : ""}`}
          role="progressbar"
          aria-label={`${name} experience`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={visual.pct}
          aria-valuetext={visual.progressText}
        >
          <span style={{ width: `${visual.pct}%` }} />
        </div>
        <span className="combat-xp-values"><small>{visual.progressText}</small><strong>{gain > 0 ? `+${gain} XP` : "No XP gained"}</strong></span>
      </div>
      {visual.showLevelUp && (
        <div className="combat-xp-level-up" aria-live="polite">
          <span className="combat-xp-level-up-badge">
            <ArrowUp size={15} strokeWidth={2.75} aria-hidden="true" />
            <strong>Level Up</strong>
          </span>
        </div>
      )}
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
  if (entry.kind === "lootbox") {
    const lootbox = data.catalog.lootboxes.find((row) => row.id === entry.targetId);
    return lootbox ? <LootboxSprite lootbox={lootbox} variant="closed" /> : <Gift size={15} />;
  }
  return <CollectibleSprite
    data={data}
    type={(entry.targetCategory ?? "relic") as CollectibleType}
    id={entry.targetId}
    size="xs"
    shard={entry.kind === "shard"}
  />;
}

function DungeonOutcomeScreen({ data, combat, complete, keyboardRootRef, onHome, onReplay, onNextDungeon }: { data: AppData; combat: DungeonRunState; complete: boolean; keyboardRootRef: React.RefObject<HTMLElement>; onHome: () => void; onReplay: () => void; onNextDungeon: (id: string) => void }) {
  const rewards = combineDungeonRewards(combat.lastBattleRewards, combat.dungeonRewards);
  return (
    <section
      ref={keyboardRootRef}
      className={`combat-screen dungeon-outcome-screen ${complete ? "victory" : "failure"}`}
      aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Space ShiftLeft"
    >
      <div className="dungeon-outcome-emblem">{complete ? <Sparkles size={42} /> : <Skull size={42} />}</div>
      <p className="eyebrow">{complete ? "Dungeon complete" : "Expedition failed"}</p>
      <h1>{complete ? `${combat.dungeon.name} cleared!` : "Your squad has fallen."}</h1>
      <p>{complete ? `All ${combat.run.battleCount} encounters are complete. Rewards below are already saved.` : "Rewards from defeated opponents are saved. Retrying starts a fresh run at full HP."}</p>
      <div className="dungeon-outcome-rewards">
        <section><h2>Rewards</h2><RewardSummary data={data} rewards={rewards} /></section>
      </div>
      {combat.lastBattleRewards && <XpGainSection data={data} rewards={combat.lastBattleRewards} />}
      <div className="dungeon-outcome-actions">
        <button className="secondary-button" data-combat-control="true" data-combat-focus-role="outcome" onClick={onHome}>Back to Home</button>
        <button className="primary-button" data-combat-control="true" data-combat-focus-role="outcome" onClick={onReplay}><RefreshCw size={16} /> {complete ? "Replay Dungeon" : "Retry Dungeon"}</button>
        {complete && combat.nextDungeonId && <button className="primary-button next-dungeon-button" data-combat-control="true" data-combat-focus-role="outcome" onClick={() => onNextDungeon(combat.nextDungeonId!)}>Next Dungeon <ChevronRight size={16} /></button>}
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

  if (notification.kind === "challenge-completed") {
    const challenge = data.catalog.collectibleUnlockChallenges.find((row) => row.id === notification.challengeId);
    if (!challenge) return null;
    const collectible = collectibleName(data, challenge.collectible_type, challenge.collectible_id);
    return (
      <aside className="unlock-notification challenge-completed-notification" role="status" aria-live="polite" aria-atomic="true">
        <CollectibleSprite data={data} type={challenge.collectible_type} id={challenge.collectible_id} size="xs" />
        <div className="unlock-notification-copy">
          <span className="unlock-notification-label"><Check size={14} aria-hidden="true" /> Challenge completed</span>
          <h2>{challengeDescription(data, challenge)}</h2>
          <p className="unlock-notification-detail">{collectible} challenge completed</p>
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

  if (notification.kind === "shop-error") {
    return (
      <aside className="unlock-notification error-notification" role="status" aria-live="polite" aria-atomic="true">
        <span className="notification-banner-icon" aria-hidden="true"><AlertTriangle size={25} /></span>
        <div className="unlock-notification-copy">
          <span className="unlock-notification-label"><AlertTriangle size={14} aria-hidden="true" /> Purchase error</span>
          <h2>{notification.message}</h2>
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
  className = "",
  dismissible = true,
}: {
  eyebrow?: string;
  title: string;
  description?: string | null;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
  dismissible?: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = `modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const descriptionId = description ? `${titleId}-description` : undefined;
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  useLayoutEffect(() => {
    if (modalRef.current) modalRef.current.scrollTop = 0;
  }, [title]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const initial = modal?.querySelector<HTMLElement>("button[aria-label='Close']")
      ?? modal?.querySelector<HTMLElement>("button, summary, [role='button'], [role='tab'], [role='option'], [tabindex='0']")
      ?? modal?.querySelector<HTMLElement>("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])");
    initial?.focus({ preventScroll: true });
    if (modal) modal.scrollTop = 0;
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
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
  }, [title]);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={`modal ${className}`.trim()} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
          {dismissible && <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
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
          loading={size === "hero" || size === "small" ? "eager" : "lazy"}
          onError={() => setFailedAssetPath(assetPath ?? null)}
        />
      ) : locked ? "?" : initials}
    </span>
  );
}

function AssetIcon({
  path,
  alt,
  loading = "lazy",
  fallback,
}: {
  path?: string | null;
  alt: string;
  loading?: "lazy" | "eager";
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
          loading={loading}
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

function modificationTone(breakdown?: StatBreakdown, cost = false): "positive" | "negative" | "mixed" | "" {
  if (!breakdown?.sources.length) return "";
  const positive = breakdown.sources.some((source) => cost ? source.amount < 0 : source.amount > 0);
  const negative = breakdown.sources.some((source) => cost ? source.amount > 0 : source.amount < 0);
  if (positive && negative) return "mixed";
  return positive ? "positive" : negative ? "negative" : "";
}

function actionCostTone(breakdown?: ActionCostBreakdown): "positive" | "negative" | "mixed" | "" {
  if (!breakdown?.sources.length) return "";
  const discount = breakdown.sources.some((source) => source.amount < 0);
  const increase = breakdown.sources.some((source) => source.amount > 0);
  if (discount && increase) return "mixed";
  return discount ? "positive" : "negative";
}

function costBreakdownText(label: string, breakdown: ActionCostBreakdown): string {
  return `${label}: ${breakdown.base} (Base) ${breakdown.sources.map((source) => `${signedAmount(source.amount)} (${source.sourceName})`).join(" ")}`;
}

function CostBreakdownLine({ label, breakdown }: { label: string; breakdown: ActionCostBreakdown }) {
  return <span className="tooltip-cost-breakdown"><strong>{label}: </strong><span>{breakdown.base} (Base)</span>{breakdown.sources.map((source, index) => <strong className={source.amount < 0 ? "positive" : "negative"} key={`${source.sourceName}-${index}`}> {signedAmount(source.amount)} ({source.sourceName})</strong>)}</span>;
}

function signedAmount(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount}`;
}

function breakdownText(label: string, breakdown: StatBreakdown): string {
  const finalText = breakdown.final !== undefined && breakdown.final !== breakdown.base + breakdown.sources.reduce((sum, source) => sum + source.amount, 0)
    ? ` = ${breakdown.final} (Capped)`
    : "";
  return `${label}: ${breakdown.base} (Base) ${breakdown.sources.map((source) => `${signedAmount(source.amount)} (${source.sourceName})`).join(" ")}${finalText}`;
}

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

function StatCell({ label, value, className = "", breakdowns = [], cost = false }: { label: string; value: React.ReactNode; className?: string; breakdowns?: Array<{ label?: string; breakdown: StatBreakdown }>; cost?: boolean }) {
  const modified = breakdowns.some((entry) => entry.breakdown.sources.length > 0);
  const accessibleBreakdown = breakdowns.map((entry) => breakdownText(entry.label ?? label, entry.breakdown)).join(". ");
  return (
    <span className={`stat-cell ${className} ${modified ? "modified" : ""}`.trim()} tabIndex={modified ? 0 : undefined} aria-label={modified ? `${label} ${accessibleBreakdown}` : undefined}>
      <span className="stat-label">{label}</span>{value}
      {modified && <span className="game-tooltip stat-breakdown" role="tooltip">{breakdowns.map((entry, index) => <StatBreakdownLine key={`${entry.label ?? label}-${index}`} label={entry.label} breakdown={entry.breakdown} cost={cost} />)}</span>}
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
      <StatCell label="Block" value={<strong className={modificationTone(breakdowns.blockCost, true)}>{stats.blockCost}</strong>} cost breakdowns={breakdowns.blockCost ? [{ breakdown: breakdowns.blockCost }] : []} />
      <StatCell label="Swap" value={<strong className={modificationTone(breakdowns.swapCost, true)}>{stats.swapCost}</strong>} cost breakdowns={breakdowns.swapCost ? [{ breakdown: breakdowns.swapCost }] : []} />
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
