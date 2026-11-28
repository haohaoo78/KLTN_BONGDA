import { useEffect, useRef } from "react";

type Props = {
  error: string | null;
  notice: string | null;
  onDismiss: () => void;
};

export function ToastNotice({ error, notice, onDismiss }: Props) {
  const message = error ?? notice;
  const isError = Boolean(error);
  const dismissRef = useRef(onDismiss);

  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (!message || isError) return;
    const timer = window.setTimeout(() => dismissRef.current(), 3800);
    return () => window.clearTimeout(timer);
  }, [isError, message]);

  if (!message) return null;
  return (
    <div className={`toast-notice ${isError ? "toast-error" : "toast-success"}`} role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}>
      <span className="toast-icon" aria-hidden="true">{isError ? "!" : "✓"}</span>
      <span className="toast-copy"><strong>{isError ? "Không thể hoàn tất" : "Thao tác thành công"}</strong><span>{message}</span></span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Đóng thông báo">×</button>
    </div>
  );
}
