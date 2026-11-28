/** Validates an already player-confirmed team submission as one roster. BTC does not review individual players. */
export function isTeamRosterReady(input: {
  rosterCount: number;
  listedCount: number;
  minimumPlayers: number;
  maximumPlayers: number;
  goalkeepers: number;
  minimumGoalkeepers: number;
  starters: number;
  requiredStarters: number;
  startingGoalkeepers: number;
}): boolean {
  return input.rosterCount === input.listedCount
    && input.rosterCount >= input.minimumPlayers
    && input.rosterCount <= input.maximumPlayers
    && input.goalkeepers >= input.minimumGoalkeepers
    && input.starters === input.requiredStarters
    && input.startingGoalkeepers === 1;
}
