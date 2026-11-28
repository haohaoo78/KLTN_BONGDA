import { ReactNode, useEffect, useId, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
};

export function Modal({ open, title, description, onClose, children, className = "", eyebrow = "CỬA SỔ THAO TÁC" }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(
      "input:not([readonly]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not([readonly]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-modal="true"
        className={`modal-card ${className}`.trim()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Đóng cửa sổ">×</button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}
