import { useEffect } from "react";
import { API_BASE } from "../api/client";

/** Subscribe to published match, schedule, referee and result changes. */
export function useMatchFeedInvalidation(onChange: () => void): void {
  useEffect(() => {
    const base = API_BASE.replace(/\/$/, "");
    const stream = new EventSource(`${base}/matches/live/stream`, { withCredentials: true });
    stream.addEventListener("match-update", onChange);
    return () => {
      stream.removeEventListener("match-update", onChange);
      stream.close();
    };
  }, [onChange]);
}
