import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
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
  children: ReactNode;
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
