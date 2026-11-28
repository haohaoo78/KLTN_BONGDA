import { AppError } from "../lib/errors";
import { getTournamentRegistrationReviewState, getLockedRosterAdditionEligibility } from "../lib/teamAuthorization";
import { getAcceptedTournamentInvitations, markTournamentInvitationsWithdrawn } from "../repositories/tournamentInvitationRepository";
import {
  createRegistrationChangeRequest, decideRegistrationChangeRequest, finalizeRegistrationChangeRequest,
  getChangeRequestRegistration, getRegistrationChangeRequestById, resetRegistrationChangeDecision, listRegistrationChangeRequests, type RegistrationChangeKind,
} from "../repositories/teamRegistrationChangeRequestRepository";
import { releaseTournamentInvitationParticipation } from "../lib/teamAuthorization";
import { getTeam } from "./teamService";
import { queueOrganizationNotifications } from "./organizationNotificationOutboxService";

function rosterEntry(invite: Record<string, unknown>) {
  return {
    playerId: String(invite.player_id), fullName: invite.full_name ?? null,
    studentId: invite.student_id ?? null, competitionRole: invite.competition_role,
    lineupRole: invite.lineup_role, isGoalkeeper: invite.is_goalkeeper === true,
    proposedJerseyNumber: invite.proposed_jersey_number ?? null, position: invite.position_snapshot ?? null,
    invitationId: String(invite.id),
  };
}

export async function requestRegistrationChange(input: {
  registrationId: string; requestedBy: string; kind: RegistrationChangeKind; reason: string; playerIds: string[];
}) {
  const registration = await getChangeRequestRegistration(input.registrationId);
  if (!registration) throw new AppError(404,"Không tìm thấy hồ sơ đăng ký","REGISTRATION_NOT_FOUND");
  if (registration.status !== "APPROVED") throw new AppError(409,"Chỉ hồ sơ APPROVED mới được đề xuất thay đổi","REGISTRATION_NOT_APPROVED");
  if (!input.reason.trim() || input.reason.length > 2000) throw new AppError(400,"Cần nhập lý do (tối đa 2000 ký tự)","CHANGE_REASON_REQUIRED");
  if (!input.playerIds.length || input.playerIds.length > 40 || new Set(input.playerIds).size !== input.playerIds.length) throw new AppError(400,"Danh sách cầu thủ không hợp lệ","INVALID_PROPOSED_ROSTER");
  const state = await getTournamentRegistrationReviewState(String(registration.tournament_id));
  const locked = ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(state.status);
  if (input.kind === "APPROVED_AMENDMENT" && !["OPEN_REGISTRATION","REGISTRATION_CLOSED"].includes(state.status)) throw new AppError(409,"Chỉ được đề xuất chỉnh sửa hồ sơ trước khi giải khóa roster","ROSTER_LOCKED");
  if (input.kind === "LOCKED_PLAYER_ADDITION" && !locked) throw new AppError(409,"Yêu cầu bổ sung ngoại lệ chỉ dùng sau khi roster đã khóa và giải chưa kết thúc","ROSTER_NOT_LOCKED");
  const accepted = await getAcceptedTournamentInvitations(String(registration.team_id), String(registration.tournament_id), input.playerIds);
  if (accepted.length !== input.playerIds.length) throw new AppError(409,"Chỉ được chọn cầu thủ đã xác nhận lời mời cho giải này","ROSTER_INVITATION_NOT_ACCEPTED");
  const proposed = accepted.map(rosterEntry);
  const officialRoster = Array.isArray(registration.submitted_roster) ? registration.submitted_roster as Array<Record<string, unknown>> : [];
  const oldSet = new Set(officialRoster.map((x) => String(x.playerId ?? x.player_id ?? "")));
  const newSet = new Set(input.playerIds);
  if (oldSet.size === newSet.size && [...oldSet].every((id) => newSet.has(id))) throw new AppError(409,"Đề xuất không làm thay đổi roster hiện tại","ROSTER_CHANGE_HAS_NO_CHANGES");
  const minPlayers=state.minPlayers ?? 1, maxPlayers=state.maxPlayersPerTeam ?? 40, minGoalkeepers=state.minGoalkeepers ?? 0;
  if (proposed.length < minPlayers || proposed.length > maxPlayers) throw new AppError(409,`Roster đề xuất phải có từ ${minPlayers} đến ${maxPlayers} cầu thủ đã xác nhận`,"ROSTER_SIZE_INVALID");
  if (proposed.filter((item) => item.isGoalkeeper).length < minGoalkeepers) throw new AppError(409,`Roster đề xuất cần tối thiểu ${minGoalkeepers} thủ môn đã xác nhận`,"ROSTER_GOALKEEPERS_INVALID");
  if (input.kind === "LOCKED_PLAYER_ADDITION") {
    const officialIds = oldSet;
    const addedIds = input.playerIds.filter((id) => !officialIds.has(id));
    if (addedIds.length !== 1) throw new AppError(409,"Chỉ được bổ sung đúng một cầu thủ mới","LOCKED_ROSTER_ADDITION_ONLY");
    const eligibility = await getLockedRosterAdditionEligibility(String(registration.tournament_id), addedIds);
    if (!eligibility.eligible) throw new AppError(409,eligibility.reason ?? "Không còn đủ điều kiện bổ sung cầu thủ","LOCKED_ROSTER_ADDITION_NOT_ALLOWED");
    if ((eligibility.alreadyAppearedPlayerIds ?? []).length) throw new AppError(409,"Cầu thủ đã xuất hiện trong trận đấu đã diễn ra","PLAYER_ALREADY_APPEARED");
  }
  return createRegistrationChangeRequest({registrationId:input.registrationId,requestKind:input.kind,requestedBy:input.requestedBy,reason:input.reason,proposedRoster:proposed});
}

export async function getTournamentRegistrationChangeRequests(tournamentId: string) {
  return listRegistrationChangeRequests(tournamentId);
}

export async function decideRegistrationChange(input: { id:string; actorId:string; decision:"APPROVED"|"REJECTED"; note:string }) {
  const existing = await getRegistrationChangeRequestById(input.id);
  if (!existing) throw new AppError(404,"Không tìm thấy yêu cầu thay đổi","CHANGE_REQUEST_NOT_FOUND");
  if (input.decision === "APPROVED" && existing.status !== "APPROVED") {
    const before = await getChangeRequestRegistration(existing.registrationId);
    if (!before) throw new AppError(404,"Hồ sơ đăng ký không còn tồn tại","REGISTRATION_NOT_FOUND");
    await validateApprovalEligibility(existing,String(before.tournament_id));
  }
  const started = await decideRegistrationChangeRequest(input);
  const registration = await getChangeRequestRegistration(started.registrationId);
  if (!registration) throw new AppError(404,"Hồ sơ đăng ký không còn tồn tại","REGISTRATION_NOT_FOUND");
  if (input.decision === "APPROVED" && started.status !== "APPROVED") {
    try { await validateApprovalEligibility(started, String(registration.tournament_id)); }
    catch (error) { await resetRegistrationChangeDecision(input.id,input.actorId,error instanceof Error ? error.message : "Không còn đủ điều kiện"); throw error; }
  }
  const completed = await finalizeRegistrationChangeRequest(input);
  const registrationAfter = await getChangeRequestRegistration(completed.registrationId);
  const previousIds = new Set(started.previousRoster.map((x) => String(x.playerId ?? x.player_id ?? "")).filter(Boolean));
  const proposedIds = new Set(started.proposedRoster.map((x) => String(x.playerId ?? x.player_id ?? "")).filter(Boolean));
  const releasedPlayerIds = input.decision === "APPROVED"
    ? [...previousIds].filter((id) => !proposedIds.has(id))
    : [...proposedIds].filter((id) => !previousIds.has(id));
  const invitations = registrationAfter && releasedPlayerIds.length
    ? await getAcceptedTournamentInvitations(String(registrationAfter.team_id),String(registrationAfter.tournament_id),releasedPlayerIds)
    : [];
  const invitationIds = invitations.map((item) => String(item.id));
  for (const invitationId of invitationIds) await releaseTournamentInvitationParticipation(invitationId);
  await markTournamentInvitationsWithdrawn(invitationIds);
  if (registrationAfter) {
    const team = await getTeam(String(registrationAfter.team_id));
    if (team.captainId) await queueOrganizationNotifications([{
      userId: team.captainId,
      type: "TOURNAMENT_REGISTRATION" as const,
      title: input.decision === "APPROVED" ? "Yêu cầu thay đổi roster đã được chấp thuận" : "Yêu cầu thay đổi roster bị từ chối",
      body: input.note.trim(),
      data: { registrationId: completed.registrationId, changeRequestId: completed.id, decision: input.decision },
      idempotencyKey: `registration-change:${completed.id}:${input.decision}`,
    }]);
  }
  return completed;
}

async function validateApprovalEligibility(request: {
  requestKind: RegistrationChangeKind; previousRoster: Array<Record<string, unknown>>;
  proposedRoster: Array<Record<string, unknown>>;
}, knownTournamentId?: string) {
  let tournamentId = knownTournamentId;
  if (!tournamentId) throw new AppError(409,"Không thể xác minh giải đấu của yêu cầu","CHANGE_REQUEST_CONTEXT_MISSING");
  const state = await getTournamentRegistrationReviewState(tournamentId);
  const locked = ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(state.status);
  if (request.requestKind === "APPROVED_AMENDMENT" && !["OPEN_REGISTRATION","REGISTRATION_CLOSED"].includes(state.status)) throw new AppError(409,"Roster đã khóa trong lúc BTC xử lý yêu cầu","ROSTER_LOCKED");
  if (request.requestKind === "LOCKED_PLAYER_ADDITION") {
    const officialIds = new Set(request.previousRoster.map((x) => String(x.playerId ?? x.player_id ?? "")));
    const ids = request.proposedRoster.map((x) => String(x.playerId ?? x.player_id ?? "")).filter((id) => !officialIds.has(id));
    const check = await getLockedRosterAdditionEligibility(tournamentId, ids);
    if (!check.eligible || (check.alreadyAppearedPlayerIds ?? []).length) throw new AppError(409,check.reason ?? "Không còn đủ điều kiện bổ sung roster","LOCKED_ROSTER_ADDITION_NOT_ALLOWED");
  }
}
