import type { TournamentRegistrationDraft } from "../repositories/tournamentRegistrationDraftRepository";

type AcceptedInvitation = {
  player_id: string;
  lineup_role: "STARTER" | "SUBSTITUTE";
  is_goalkeeper: boolean;
  competition_role: string;
  proposed_jersey_number: number | null;
  position_snapshot: string | null;
  full_name: string;
  student_id: string;
  birth_date: string | Date | null;
};

export type ResubmissionRosterEntry = {
  playerId: string;
  lineupRole: "STARTER" | "SUBSTITUTE";
  isGoalkeeper: boolean;
  competitionRole: string;
  jerseyNumber: number | null;
  position: string | null;
  playerName: string;
  studentId: string;
  birthDate: string | null;
};

export function buildResubmissionRoster(
  accepted: AcceptedInvitation[],
  draft: TournamentRegistrationDraft | null,
): ResubmissionRosterEntry[] {
  const editingDraft = draft?.editingSubmitted ? draft.roster : [];
  const acceptedById = new Map(accepted.map((entry) => [entry.player_id, entry]));
  const draftById = new Map(editingDraft.map((entry) => [entry.playerId, entry]));

  if (draftById.size !== editingDraft.length) {
    throw new Error("DRAFT_ROSTER_DUPLICATE_PLAYER");
  }
  if ([...draftById.keys()].some((playerId) => !acceptedById.has(playerId))) {
    throw new Error("DRAFT_ROSTER_INVITATION_NOT_ACCEPTED");
  }

  const orderedIds = [
    ...editingDraft.map((entry) => entry.playerId),
    ...accepted.map((entry) => entry.player_id),
  ].filter((playerId, index, ids) => ids.indexOf(playerId) === index);

  return orderedIds.map((playerId) => {
    const invitation = acceptedById.get(playerId)!;
    const draftEntry = draftById.get(playerId);
    return {
      playerId,
      lineupRole: draftEntry?.lineupRole ?? invitation.lineup_role,
      isGoalkeeper: draftEntry?.isGoalkeeper ?? invitation.is_goalkeeper,
      competitionRole: draftEntry?.competitionRole ?? invitation.competition_role,
      jerseyNumber: draftEntry ? draftEntry.proposedJerseyNumber : invitation.proposed_jersey_number,
      position: draftEntry ? draftEntry.position : invitation.position_snapshot,
      playerName: invitation.full_name,
      studentId: invitation.student_id,
      birthDate: invitation.birth_date ? String(invitation.birth_date).slice(0, 10) : null,
    };
  });
}
