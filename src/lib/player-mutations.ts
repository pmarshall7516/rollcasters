export type PlayerMutationReceipt = {
  requestId: string;
  resultingRevision?: string | number;
  [key: string]: unknown;
};

export type PlayerMutationCommand<State, Receipt extends PlayerMutationReceipt = PlayerMutationReceipt> = {
  requestId: string;
  resourceKey: string;
  apply: (state: State) => State;
  reconcile?: (state: State, receipt: Receipt) => State;
  send: () => Promise<Receipt>;
};

type QueuedCommand<State, Receipt extends PlayerMutationReceipt> = PlayerMutationCommand<State, Receipt> & {
  status: "queued" | "sending";
  resolve: (receipt: Receipt) => void;
  reject: (error: unknown) => void;
};

/**
 * Ordered per-player outbox for reversible state. It owns ordering and
 * rollback; React components only provide a reducer and a network command.
 * Commands targeting the same semantic resource collapse while unsent, while
 * unrelated edits retain their order.
 */
export class PlayerMutationOutbox<State, Receipt extends PlayerMutationReceipt = PlayerMutationReceipt> {
  private confirmedState: State;
  private visibleState: State;
  private queue: Array<QueuedCommand<State, Receipt>> = [];
  private processing: Promise<void> = Promise.resolve();
  private listeners = new Set<(state: State) => void>();
  private lastErrorByResource = new Map<string, unknown>();

  constructor(initialState: State) {
    this.confirmedState = initialState;
    this.visibleState = initialState;
  }

  getState(): State {
    return this.visibleState;
  }

  subscribe(listener: (state: State) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pendingStateFor(resourceKey: string): { pending: boolean; error: unknown | null } {
    return {
      pending: this.queue.some((command) => command.resourceKey === resourceKey),
      error: this.lastErrorByResource.get(resourceKey) ?? null,
    };
  }

  mutatePlayer(command: PlayerMutationCommand<State, Receipt>): Promise<Receipt> {
    const result = new Promise<Receipt>((resolve, reject) => {
      const collapsedIndex = this.queue.findIndex((queued) => queued.status === "queued" && queued.resourceKey === command.resourceKey);
      if (collapsedIndex >= 0) {
        const [collapsed] = this.queue.splice(collapsedIndex, 1);
        collapsed.reject(new Error("MUTATION_SUPERSEDED"));
      }
      this.queue.push({ ...command, status: "queued", resolve, reject });
      this.visibleState = command.apply(this.visibleState);
      this.lastErrorByResource.delete(command.resourceKey);
      this.emit();
      this.processing = this.processing.then(() => this.processNext()).catch(() => undefined);
    });
    return result;
  }

  async flushPlayerMutations(): Promise<void> {
    await this.processing;
    if (this.queue.length > 0) await this.flushPlayerMutations();
  }

  discardPendingMutations(): void {
    this.queue = [];
    this.visibleState = this.confirmedState;
    this.emit();
  }

  private async processNext(): Promise<void> {
    const command = this.queue.find((candidate) => candidate.status === "queued");
    if (!command) return;
    command.status = "sending";
    try {
      const receipt = await command.send();
      this.confirmedState = command.reconcile
        ? command.reconcile(this.confirmedState, receipt)
        : command.apply(this.confirmedState);
      this.queue = this.queue.filter((candidate) => candidate !== command);
      command.resolve(receipt);
      this.rebuildVisibleState();
    } catch (error) {
      this.lastErrorByResource.set(command.resourceKey, error);
      this.queue = this.queue.filter((candidate) => candidate !== command);
      command.reject(error);
      this.rebuildVisibleState();
    }
  }

  syncConfirmedState(state: State): void {
    this.confirmedState = state;
    this.rebuildVisibleState();
  }

  private rebuildVisibleState(): void {
    this.visibleState = this.queue.reduce((state, command) => command.apply(state), this.confirmedState);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.visibleState);
  }
}

export function createPlayerMutationOutbox<State>(initialState: State): PlayerMutationOutbox<State> {
  return new PlayerMutationOutbox(initialState);
}
