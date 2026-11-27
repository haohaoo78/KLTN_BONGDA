import { useCallback, useEffect, useState } from "react";
import { getRefereeContext, type RefereeMatchContext } from "../../api/refereePortal";
import { ApiError } from "../../api/client";

type ContextState = { matchId?: string; context: RefereeMatchContext | null; error: string | null; loading: boolean; accessDenied: boolean };
const emptyState: ContextState = { context: null, error: null, loading: false, accessDenied: false };

export function useRefereeContext(matchId: string | undefined, revision: number) {
  const [state, setState] = useState<ContextState>(emptyState);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((current) => current + 1), []);
  useEffect(() => {
    let active = true;
    if (!matchId) { setState(emptyState); return () => { active = false; }; }
    setState((current) => ({ ...emptyState, matchId, context: current.matchId === matchId ? current.context : null, loading: true }));
    void getRefereeContext(matchId).then((context) => {
      if (active) setState({ ...emptyState, matchId, context });
    }).catch((err: unknown) => {
      if (active) setState({ ...emptyState, matchId, accessDenied: err instanceof ApiError && err.status === 403,
        error: err instanceof Error ? err.message : "Không tải được thông tin trận đấu." });
    });
    return () => { active = false; };
  }, [matchId, revision, tick]);
  // Do not show the previous match (or its error) during the first render of a new URL.
  return { ...(state.matchId === matchId ? state : { ...emptyState, loading: Boolean(matchId) }), refresh };
}
