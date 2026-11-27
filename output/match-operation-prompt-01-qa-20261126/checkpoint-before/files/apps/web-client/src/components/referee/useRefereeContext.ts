import { useCallback, useEffect, useState } from "react";
import { getRefereeContext, type RefereeMatchContext } from "../../api/refereePortal";

export function useRefereeContext(matchId: string | undefined, revision: number) {
  const [context, setContext] = useState<RefereeMatchContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((current) => current + 1), []);
  useEffect(() => {
    let active = true;
    setContext((current) => current?.match.id === matchId ? current : null); setError(null);
    if (!matchId) return () => { active = false; };
    setLoading(true);
    void getRefereeContext(matchId).then((value) => { if (active) setContext(value); }).catch((err: unknown) => { if (active) { setContext(null); setError(err instanceof Error ? err.message : "Không tải được thông tin trận đấu."); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [matchId, revision, tick]);
  return { context, error, loading, refresh };
}
