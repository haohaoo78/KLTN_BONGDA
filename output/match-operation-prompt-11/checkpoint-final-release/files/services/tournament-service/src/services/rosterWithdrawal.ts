export function canWithdrawRegistrationBeforeDraw(status: string, drawStatus: string | null): boolean {
  if (status === "OPEN_REGISTRATION" || status === "REGISTRATION_CLOSED") return true;
  const drawInProgressOrFinal = new Set(["CONFIRMED", "PUBLISHED", "LIVE", "PAUSED", "COMPLETED", "FINALIZED"]);
  return status === "ROSTER_LOCKED" && !drawInProgressOrFinal.has(drawStatus ?? "");
}

export function removeTeamFromRosterSnapshot(
  snapshot: unknown,
  teamId: string,
): { roster: Array<Record<string, unknown>>; removed: boolean } {
  if (!Array.isArray(snapshot)) return { roster: [], removed: false };
  const roster = snapshot.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item),
  );
  const remaining = roster.filter((entry) => entry.teamId !== teamId);
  return { roster: remaining, removed: remaining.length < roster.length };
}

export function sameUniqueTeamSet(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return expectedSet.size === expected.length && actualSet.size === actual.length &&
    expectedSet.size === actualSet.size && [...expectedSet].every((teamId) => actualSet.has(teamId));
}

export function uniqueTeamIdsAreSubset(expected: readonly string[], actual: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return expectedSet.size === expected.length && actualSet.size === actual.length &&
    [...actualSet].every((teamId) => expectedSet.has(teamId));
}
