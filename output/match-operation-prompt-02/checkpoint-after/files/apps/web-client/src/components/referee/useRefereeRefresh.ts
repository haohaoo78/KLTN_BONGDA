import { useEffect } from "react";
import { useMatchFeedInvalidation } from "../../hooks/useMatchFeedInvalidation";

/** Recheck personal access after a missed SSE update or returning to an open tab. */
export function useRefereeRefresh(refresh: () => void): void {
  useMatchFeedInvalidation(refresh);
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const timer = window.setInterval(refreshVisible, 30_000);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);
}
