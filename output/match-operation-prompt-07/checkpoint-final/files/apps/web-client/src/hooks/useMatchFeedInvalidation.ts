import { useEffect } from "react";
import { API_BASE } from "../api/client";

/** Subscribe to published match, schedule, referee and result changes. */
export function useMatchFeedInvalidation(onChange: () => void,onConnectionChange?:(connected:boolean)=>void): void {
  useEffect(() => {
    const base = API_BASE.replace(/\/$/, "");
    const stream = new EventSource(`${base}/matches/live/stream`, { withCredentials: true });
    let opened=false;
    stream.onopen=()=>{onConnectionChange?.(true);if(opened)onChange();opened=true;};
    stream.onerror=()=>onConnectionChange?.(false);
    stream.addEventListener("match-update", onChange);
    stream.addEventListener("sync-required",onChange);
    return () => {
      stream.removeEventListener("match-update", onChange);
      stream.removeEventListener("sync-required",onChange);
      stream.close();
    };
  }, [onChange,onConnectionChange]);
}
