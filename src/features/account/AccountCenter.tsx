import { LogIn, Plus, Trash2, UserRound, X } from "lucide-react";
import type { RememberedAccount } from "../../lib/account-center.js";

export type AccountCenterProps = {
  accounts: RememberedAccount[];
  accountErrors: Record<string, string>;
  busyAccountId: string | null;
  onSelect: (userId: string) => void;
  onAdd: () => void;
  onRemove: (userId: string) => void;
  onClose: () => Promise<void>;
};

export function AccountCenter({ accounts, accountErrors, busyAccountId, onSelect, onAdd, onRemove, onClose }: AccountCenterProps) {
  const atCapacity = accounts.length >= 3;
  return (
    <section className="account-center-layout" aria-labelledby="account-center-title">
      <button type="button" className="account-center-close" onClick={() => void onClose()} aria-label="Close Rollcasters">
        <X size={18} aria-hidden="true" />
      </button>
      <header className="account-center-brand"><UserRound size={32} aria-hidden="true" /><span>ROLLCASTERS</span></header>
      <main className="account-center-card">
        <p className="eyebrow">Saved on this device</p>
        <h1 id="account-center-title">Account Center</h1>
        <p className="account-center-help">Choose an account to continue, or add another account to this device.</p>
        <div className="account-center-list" role="list" aria-label="Saved accounts">
          {accounts.map((account) => {
            const error = accountErrors[account.userId];
            const busy = busyAccountId === account.userId;
            return (
              <article className={`account-center-account ${error ? "has-error" : ""}`} key={account.userId} role="listitem">
                <button type="button" className="account-center-account-main" disabled={busy} onClick={() => onSelect(account.userId)}>
                  <span className="account-center-avatar"><UserRound size={21} aria-hidden="true" /></span>
                  <span className="account-center-account-copy">
                    <strong>{account.username}</strong>
                    <span>{maskEmail(account.email)}</span>
                    {error && <small role="alert">{error}</small>}
                  </span>
                  <span className="account-center-continue">{busy ? "Connecting…" : error ? "Sign in again" : "Continue"}</span>
                </button>
                <button type="button" className="account-center-remove" disabled={busy} onClick={() => onRemove(account.userId)} aria-label={`Remove from this device: ${account.username}`} title="Remove from this device">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </article>
            );
          })}
        </div>
        <button type="button" className="secondary-button account-center-add" disabled={atCapacity} onClick={onAdd}>
          {atCapacity ? <LogIn size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
          {atCapacity ? "Account limit reached" : "Add account"}
        </button>
        {atCapacity && <p className="account-center-capacity">Remove an account to add another. Up to 3 accounts can be saved here.</p>}
        <p className="account-center-privacy">Account details are stored locally. Sign-in credentials are protected by your operating system.</p>
      </main>
    </section>
  );
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@", 2);
  if (!local || !domain) return email;
  const visible = local.length <= 2 ? local[0] ?? "•" : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
