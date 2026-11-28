export type BracketTeam = { teamId: string; seed?: number; position?: number };
export type BracketSlot = {
  round: number;
  position: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeSourcePosition: number | null;
  awaySourcePosition: number | null;
  byeWinnerTeamId: string | null;
  /** Structural availability, including empty branches before winners are known. */
  bye: boolean;
  empty: boolean;
};

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function seedPositions(size: number): number[] {
  let positions = [1, 2];
  while (positions.length < size) {
    const nextSize = positions.length * 2;
    positions = positions.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return positions;
}

export type ThirdPlaceBracketDefinition = {
  round: number;
  position: number;
  homeSourcePosition: number;
  awaySourcePosition: number;
};

/** The bronze match is seeded from the losers of both semifinal slots. */
export function createThirdPlaceBracketDefinition(teamCount: number): ThirdPlaceBracketDefinition {
  if (!Number.isInteger(teamCount) || teamCount < 4) throw new Error("Third place requires at least four teams");
  if (teamCount > 32) throw new Error("At most 32 teams are supported");
  const finalRound = Math.log2(nextPowerOfTwo(teamCount));
  return {
    round: finalRound,
    position: 2,
    homeSourcePosition: 1,
    awaySourcePosition: 2,
  };
}

/** Build a single-elimination tree. BYEs resolve as advances, never as played matches. */
export function createKnockoutBracket(input: BracketTeam[]): BracketSlot[] {
  if (input.length < 2) throw new Error("At least two teams are required");
  if (input.length > 32) throw new Error("At most 32 teams are supported");
  const ids = input.map((team) => team.teamId);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate team in bracket");
  const size = nextPowerOfTwo(input.length);
  const rounds = Math.log2(size);
  const ranked = [...input].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  const fixedPositions = input.some((team) => team.position !== undefined);
  if (fixedPositions && (input.some((team) => !Number.isInteger(team.position) || team.position! < 1 || team.position! > size)
      || new Set(input.map((team) => team.position)).size !== input.length)) throw new Error("Invalid published bracket positions");
  const seeded = fixedPositions
    ? Array.from({ length: size }, (_, index) => input.find((team) => team.position === index + 1)?.teamId ?? null)
    : seedPositions(size).map((seed) => ranked[seed - 1]?.teamId ?? null);
  const slots: BracketSlot[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round;
    for (let position = 1; position <= count; position += 1) {
      if (round === 1) {
        const homeTeamId = seeded[(position - 1) * 2] ?? null;
        const awayTeamId = seeded[(position - 1) * 2 + 1] ?? null;
        slots.push({ round, position, homeTeamId, awayTeamId, homeSourcePosition: null, awaySourcePosition: null,
          byeWinnerTeamId: homeTeamId && !awayTeamId ? homeTeamId : awayTeamId && !homeTeamId ? awayTeamId : null,
          bye: !homeTeamId || !awayTeamId, empty: !homeTeamId && !awayTeamId });
      } else {
        const home = slots.find((slot) => slot.round === round - 1 && slot.position === position * 2 - 1)!;
        const away = slots.find((slot) => slot.round === round - 1 && slot.position === position * 2)!;
        slots.push({ round, position, homeTeamId: null, awayTeamId: null,
          homeSourcePosition: position * 2 - 1, awaySourcePosition: position * 2, byeWinnerTeamId: null,
          bye: home.empty || away.empty, empty: home.empty && away.empty });
      }
    }
  }
  return slots;
}
