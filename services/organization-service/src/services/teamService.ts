import type {
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamRegistration,
  TeamRegistrationCreateInput,
  TeamRegistrationUpdateInput,
  Player,
  PlayerCreateInput,
  PlayerUpdateInput,
  RosterCreateInput,
} from "../models/team";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import {
  findTeamById,
  findPublicTeamDetail,
  findTeamsForUser,
  findTeamsManagedByUser,
  listTeams,
  createTeam,
  linkTeamToInstitutionIfUnlinked,
  updateTeam,
  deleteTeam,
  findTeamRegistration,
  findTeamRegistrationById,
  listTournamentIdsByTeam,
  listTeamRegistrations,
  getNextPendingRegistrationId,
  getNextWaitlistRegistrationId,
  withTournamentRegistrationReviewLock,
  listTeamRegistrationsByTeam as findTeamRegistrationsByTeam,
  listConflictAdjustmentRegistrations,
  listReviewableRegistrationsForFinalization,
  listSupplementRegistrationsForExpiry,
  listApprovedRegistrationPlayerClaims,
  listTournamentDrawCandidates as findTournamentDrawCandidates,
  createTeamRegistration,
  saveTeamRegistrationSnapshot,
  updateTeamRegistration,
  resubmitTeamRegistration as resubmitTeamRegistrationRecord,
  appendTeamRegistrationHistory,
  listTeamRegistrationVersions as listTeamRegistrationVersionsRecord,
  listPlayers,
  listActivePlayerIdsForTeam,
  findPlayerByTeamAndUser,
  findPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  listTournamentRegistrationCounts as findTournamentRegistrationCounts,
} from "../repositories/teamRepository";
import { assertInstitutionAvailableForRegistration } from "./institutionService";
import { addRostersBatch, getInstitution, getRosters } from "./institutionService";
import { randomUUID } from "node:crypto";
import { getTournamentRegistrationDraft } from "../repositories/tournamentRegistrationDraftRepository";
import { buildResubmissionRoster } from "./registrationDraftRoster";
import { getTournamentSummary } from "../lib/tournamentSummaryClient";
import {
  approveTournamentTeamWithdrawal,
  reserveTournamentRegistration,
  syncTournamentRegistrationReservation,
  isTournamentRegistrationReviewOpen,
  getTournamentRegistrationReviewState,
  assertApprovalRevocationAllowed,
  syncApprovedRegistrationPlayerClaims as reconcileTournamentPlayerClaims,
  reserveTournamentInvitationParticipation,
} from "../lib/teamAuthorization";
import {
  claimRegistrationDecision,
  completeRegistrationDecision,
  enqueueRegistrationDecision,
  failRegistrationDecision,
} from "../repositories/registrationDecisionOutboxRepository";
import { getAcceptedTournamentInvitations, listAcceptedTournamentInvitations, listAcceptedTournamentInvitationClaims } from "../repositories/tournamentInvitationRepository";
import { queueOrganizationNotifications } from "./organizationNotificationOutboxService";
import {
  createWithdrawalRequest,
  cancelWithdrawalRequest,
  beginWithdrawalDecision,
  completeWithdrawalDecision,
  releaseWithdrawalDecision,
  findWithdrawalRequest,
  listWithdrawalRequests,
  listWithdrawalRequestsByRegistration,
} from "../repositories/teamWithdrawalRepository";
import {
  createApprovalReview,
  findApprovalReview,
  listApprovalReviews,
  respondToApprovalReview,
  retainApprovalReview,
  countOpenApprovalReviews,
  requestApprovalReviewSupplement,
} from "../repositories/approvalReviewRepository";

const SYSTEM_FINALIZATION_ACTOR = "00000000-0000-0000-0000-000000000001";

// Teams
export async function getTeam(id: string): Promise<Team> {
  const team = await findTeamById(id);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  return team;
}

export async function getPublicTeamDetail(id: string) {
  const detail = await findPublicTeamDetail(id);
  if (!detail) {
    throw new AppError(404, "Public team not found", "TEAM_NOT_FOUND");
  }
  return detail;
}

export async function getTeamsForUser(userId: string): Promise<Team[]> {
  return findTeamsForUser(userId);
}

export async function getTeamsManagedByUser(userId: string): Promise<Team[]> {
  return findTeamsManagedByUser(userId);
}

export async function isActivePlayerInTeam(teamId: string, userId: string): Promise<boolean> {
  return (await findPlayerByTeamAndUser(teamId, userId)) !== null;
}

export async function getTeamTournamentIds(teamId: string): Promise<string[]> {
  return listTournamentIdsByTeam(teamId);
}

export async function getTeams(
  limit: number,
  offset: number,
  isActive?: boolean,
  institutionId?: string,
  search?: string,
  sortBy: "NAME" | "CREATED_AT" = "CREATED_AT",
): Promise<{ items: Team[]; total: number }> {
  return listTeams(limit, offset, isActive, institutionId, search, sortBy);
}

export async function listTournamentDrawCandidates(tournamentId: string) {
  return findTournamentDrawCandidates(tournamentId);
}

export async function createNewTeam(input: TeamCreateInput): Promise<Team> {
  // Validation: maxPlayers must be positive
  if (input.maxPlayers !== undefined && input.maxPlayers <= 0) {
    throw new AppError(400, "maxPlayers must be greater than 0", "INVALID_MAX_PLAYERS");
  }

  // Validation: name cannot be empty
  if (!input.name.trim()) {
    throw new AppError(400, "Team name is required", "INVALID_NAME");
  }

  if (!input.institutionId) {
    throw new AppError(400, "A representative institution is required", "INSTITUTION_REQUIRED");
  }
  await assertInstitutionAvailableForRegistration(input.institutionId);
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }

  return createTeam(input);
}

export async function linkTeamToVerifiedInstitution(teamId: string, institutionId: string): Promise<Team> {
  const existing = await findTeamById(teamId);
  if (!existing) throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  if (existing.institutionId) {
    if (existing.institutionId === institutionId) return existing;
    throw new AppError(409, "This team is already linked to another school", "TEAM_ALREADY_LINKED");
  }
  await assertInstitutionAvailableForRegistration(institutionId);
  const linked = await linkTeamToInstitutionIfUnlinked(teamId, institutionId);
  if (linked) return linked;
  const current = await findTeamById(teamId);
  if (current?.institutionId === institutionId) return current;
  throw new AppError(409, "The team could not be linked because its school changed", "TEAM_LINK_CONFLICT");
}

export async function updateTeamInfo(id: string, input: TeamUpdateInput): Promise<Team> {
  const existing = await findTeamById(id);
  if (!existing) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Validation: maxPlayers must be positive
  if (input.maxPlayers !== undefined && input.maxPlayers <= 0) {
    throw new AppError(400, "maxPlayers must be greater than 0", "INVALID_MAX_PLAYERS");
  }

  // Validation: name cannot be empty
  if (input.name !== undefined && !input.name.trim()) {
    throw new AppError(400, "Team name is required", "INVALID_NAME");
  }

  // Business rule: captain must be in the team (future: check with player repository)
  // For MVP, allow any user as captain

  const updated = await updateTeam(id, input);
  if (!updated) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  return updated;
}

export async function removeTeam(id: string): Promise<void> {
  const existing = await findTeamById(id);
  if (!existing) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Business rule: cannot delete team with active registrations
  // For MVP, allow deletion (will cascade via FK)

  await deleteTeam(id);
}

// Team Registrations
export async function getTeamRegistration(
  teamId: string,
  tournamentId: string,
): Promise<TeamRegistration> {
  const registration = await findTeamRegistration(teamId, tournamentId);
  if (!registration) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  return registration;
}

export async function getTeamRegistrationByRegistrationId(id: string): Promise<TeamRegistration> {
  const registration = await findTeamRegistrationById(id);
  if (!registration) {
    throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  }
  return registration;
}

export async function getTeamRegistrations(
  tournamentId: string,
  filters: { status?: string; institutionId?: string; search?: string } = {},
): Promise<TeamRegistration[]> {
  return listTeamRegistrations(tournamentId, filters);
}

export async function getTeamRegistrationsByTeam(teamId: string): Promise<TeamRegistration[]> {
  return findTeamRegistrationsByTeam(teamId);
}

export async function getTeamRegistrationHistory(registrationId: string) {
  const registration = await findTeamRegistrationById(registrationId);
  if (!registration) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  return listTeamRegistrationVersionsRecord(registrationId);
}

export async function listTournamentRegistrationCounts(
  tournamentId?: string,
  institutionId?: string,
) {
  return findTournamentRegistrationCounts(tournamentId, institutionId);
}

export async function registerTeamForTournament(
  input: Pick<TeamRegistrationCreateInput, "teamId" | "tournamentId"> & { actorId: string; notes?: string; roster?: Array<Pick<RosterCreateInput, "playerId" | "lineupRole" | "isGoalkeeper" | "evidenceUrl">> },
): Promise<TeamRegistration> {
  // Check if team exists
  const team = await findTeamById(input.teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }
  if (!team.institutionId) {
    throw new AppError(409, "The team must be linked to an active school before registration", "INSTITUTION_REQUIRED");
  }
  const institution = await getInstitution(team.institutionId);
  if (!institution || institution.status !== "ACTIVE" || !institution.isActive) {
    throw new AppError(409, "The team's school is not accepting registrations", "INSTITUTION_UNAVAILABLE");
  }

  // Check if already registered
  const existing = await findTeamRegistration(input.teamId, input.tournamentId);
  if (existing) {
    throw new AppError(409, "Team already registered for this tournament", "ALREADY_REGISTERED");
  }

  const submittedRoster = input.roster ?? [];
  if (!submittedRoster.length) {
    throw new AppError(400, "A team roster is required with the tournament application", "ROSTER_REQUIRED");
  }
  const activePlayers = await listPlayers(input.teamId);
  const activePlayerIds = new Set(activePlayers.map((player) => player.id));
  const uniquePlayerIds = new Set(submittedRoster.map((entry) => entry.playerId));
  if (submittedRoster.length > Math.min(team.maxPlayers, 30)) {
    throw new AppError(400, "Roster exceeds the team's registered player limit", "ROSTER_TOO_LARGE");
  }
  if (uniquePlayerIds.size !== submittedRoster.length || submittedRoster.some((entry) => !activePlayerIds.has(entry.playerId))) {
    throw new AppError(400, "Roster must contain unique active players from this team", "INVALID_ROSTER");
  }
  const acceptedInvitations = await getAcceptedTournamentInvitations(input.teamId, input.tournamentId, [...uniquePlayerIds]);
  if (acceptedInvitations.length !== submittedRoster.length) {
    throw new AppError(409, "Chỉ cầu thủ đã chấp nhận lời mời tham gia giải mới được đưa vào hồ sơ đội", "PLAYER_CONFIRMATION_REQUIRED");
  }
  if (activePlayers.some((player) => uniquePlayerIds.has(player.id) && (!player.fullName?.trim() || !player.studentId?.trim()))) {
    throw new AppError(400, "Every registered player needs a full name and student ID", "PLAYER_PROFILE_INCOMPLETE");
  }
  if (submittedRoster.some((entry) => !["STARTER", "SUBSTITUTE"].includes(entry.lineupRole ?? "SUBSTITUTE"))) {
    throw new AppError(400, "Each roster player must be assigned as starter or substitute", "INVALID_ROSTER_ROLE");
  }
  const jerseyNumbers = acceptedInvitations.map((entry) => entry.proposed_jersey_number).filter((value): value is number => Number.isInteger(value));
  if (new Set(jerseyNumbers).size !== jerseyNumbers.length) {
    throw new AppError(409, "Số áo dự kiến trong danh sách đăng ký không được trùng", "DUPLICATE_TOURNAMENT_JERSEY");
  }
  const starters = acceptedInvitations.filter((entry) => entry.lineup_role === "STARTER");
  const startingKeepers = starters.filter((entry) => entry.is_goalkeeper === true);
  if (starters.length === 0 || startingKeepers.length !== 1 || acceptedInvitations.some((entry) => entry.is_goalkeeper && entry.lineup_role !== "STARTER")) {
    throw new AppError(400, "Danh sách phải có ít nhất một cầu thủ đá chính và đúng một thủ môn đá chính", "INVALID_STARTING_LINEUP");
  }

  const registrationId = randomUUID();
  await reconcileExistingApprovedPlayerClaims();
  const reservationStatus = await reserveTournamentRegistration({
    registrationId,
    teamId: input.teamId,
    tournamentId: input.tournamentId,
    institutionId: team.institutionId,
    roster: acceptedInvitations.map((entry) => ({
      playerId: entry.player_id,
      lineupRole: entry.lineup_role,
      isGoalkeeper: entry.is_goalkeeper,
    })),
  });
  let registration: TeamRegistration;
  try {
    registration = await createTeamRegistration({
      ...input,
      id: registrationId,
      institutionId: team.institutionId,
    });
  } catch (error) {
    await syncTournamentRegistrationReservation(registrationId, "WITHDRAWN", false);
    throw error;
  }
  try {
    if (submittedRoster.length) {
      const createdRoster = await addRostersBatch(acceptedInvitations.map((entry) => {
        const player = activePlayers.find((item) => item.id === entry.player_id)!;
        return {
          teamId: input.teamId,
          tournamentId: input.tournamentId,
          playerId: entry.player_id,
          lineupRole: entry.lineup_role,
          isGoalkeeper: entry.is_goalkeeper,
          evidenceUrl: undefined,
          competitionRole: entry.competition_role,
          jerseyNumberSnapshot: entry.proposed_jersey_number,
          positionSnapshot: entry.position_snapshot,
          playerNameSnapshot: player.fullName,
          studentIdSnapshot: player.studentId,
        };
      }));
      await saveTeamRegistrationSnapshot({
        registrationId,
        actorId: input.actorId,
        roster: createdRoster.map((entry) => ({
          playerId: entry.playerId, playerName: entry.playerNameSnapshot, studentId: entry.studentIdSnapshot,
          birthDate: activePlayers.find((player) => player.id === entry.playerId)?.birthDate ?? null,
          competitionRole: entry.competitionRole, position: entry.positionSnapshot,
          jerseyNumber: entry.jerseyNumberSnapshot, lineupRole: entry.lineupRole, isGoalkeeper: entry.isGoalkeeper,
        })),
      });
    }
  } catch (error) {
    await updateTeamRegistration(registrationId, {
      status: "WITHDRAWN",
      notes: "Hồ sơ được lưu vào lịch sử nhưng quá trình nộp không hoàn tất do lỗi đồng bộ roster.",
    }, input.actorId);
    await appendTeamRegistrationHistory({
      registrationId, action: "WITHDRAWN", actorId: input.actorId,
      note: "Đăng ký chưa hoàn tất; hồ sơ được lưu để đối soát, không xóa lịch sử.",
    });
    await syncTournamentRegistrationReservation(registrationId, "WITHDRAWN", false);
    throw error;
  }
  if (reservationStatus === "WAITLIST") {
    registration = await updateTeamRegistration(registrationId, {
      status: "WAITLIST",
      notes: "Giải hoặc trường đã đủ chỉ tiêu khi hồ sơ được gửi; hồ sơ được giữ trong danh sách chờ suất.",
    }, input.actorId) ?? registration;
    await appendTeamRegistrationHistory({ registrationId, action: "WAITLISTED", actorId: input.actorId, note: "Giải hoặc trường đã đủ chỉ tiêu tại thời điểm gửi hồ sơ; roster chưa khóa quyền tham gia." });
  }
  await syncTournamentRegistrationReservation(registrationId, reservationStatus, true);
  return registration;
}

export async function updateTeamRegistrationStatus(
  id: string,
  input: TeamRegistrationUpdateInput,
  approvedBy?: string,
): Promise<TeamRegistration> {
  const current = await findTeamRegistrationById(id);
  if (!current) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  const isReviewDecision = ["APPROVED", "REJECTED", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(input.status ?? "");
  if (!isReviewDecision) return applyTeamRegistrationStatus(id, input, approvedBy);
  const systemFinalization = input.status === "REJECTED" && (
    ["CONFLICT_ADJUSTMENT_REQUIRED", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(current.status)
    || (approvedBy === SYSTEM_FINALIZATION_ACTOR && ["PENDING", "WAITLIST"].includes(current.status))
  );
  if (current.status !== "PENDING" && current.status !== "WAITLIST" && !systemFinalization) {
    throw new AppError(409, "Chỉ hồ sơ đang chờ xét duyệt mới nhận quyết định", "REGISTRATION_NOT_PENDING");
  }
  if (current.status === "WAITLIST") {
    if (input.status !== "APPROVED") return applyTeamRegistrationStatus(id, input, approvedBy);
    return withTournamentRegistrationReviewLock(current.tournamentId, async () => {
      const latest = await findTeamRegistrationById(id);
      if (!latest || latest.status !== "WAITLIST") throw new AppError(409, "Hồ sơ không còn trong danh sách chờ suất.", "REGISTRATION_NOT_WAITLISTED");
      const nextWaitlistId = await getNextWaitlistRegistrationId(latest.tournamentId);
      if (nextWaitlistId !== latest.id) throw new AppError(409, "Vui lòng xét hồ sơ chờ suất theo thứ tự đăng ký; hồ sơ này chưa đến lượt.", "REGISTRATION_NOT_NEXT_IN_WAITLIST");
      return applyTeamRegistrationStatus(id, input, approvedBy);
    });
  }
  if (systemFinalization) return applyTeamRegistrationStatus(id, input, approvedBy);
  // Review decisions follow the server-assigned submission order. Keep the
  // queue lock through downstream quota/reservation updates so two BTC users
  // cannot skip the current application or decide it twice.
  return withTournamentRegistrationReviewLock(current.tournamentId, async () => {
    const latest = await findTeamRegistrationById(id);
    if (!latest || latest.status !== "PENDING") {
      throw new AppError(409, "Hồ sơ không còn ở trạng thái chờ duyệt. Vui lòng tải lại danh sách.", "REGISTRATION_NOT_PENDING");
    }
    // The repository update is conditional on no submitted-version edit draft
    // existing, so this queue check and the decision cannot race a captain edit.
    const nextRegistrationId = await getNextPendingRegistrationId(latest.tournamentId);
    if (nextRegistrationId !== latest.id) {
      throw new AppError(409, "Vui lòng xử lý hồ sơ theo thứ tự đăng ký. Hồ sơ này chưa đến lượt.", "REGISTRATION_NOT_NEXT_IN_QUEUE");
    }
    return applyTeamRegistrationStatus(id, input, approvedBy);
  });
}

async function applyTeamRegistrationStatus(
  id: string,
  input: TeamRegistrationUpdateInput,
  approvedBy?: string,
): Promise<TeamRegistration> {
  // Validation: status must be valid
  const validStatuses = ["PENDING", "APPROVED", "REJECTED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "WITHDRAWN"];
  if (input.status && !validStatuses.includes(input.status)) {
    throw new AppError(400, "Invalid status", "INVALID_STATUS");
  }

  // Business rule: only approve if status is APPROVED
  if (input.status === "APPROVED" && !approvedBy) {
    throw new AppError(400, "approvedBy is required when approving", "MISSING_APPROVER");
  }
  if (["REJECTED", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "WITHDRAWN"].includes(input.status ?? "") && !approvedBy) {
    throw new AppError(400, "reviewer identity is required for this decision", "MISSING_REVIEWER");
  }

  if (!input.status) {
    const updated = await updateTeamRegistration(id, input, approvedBy);
    if (!updated) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
    return updated;
  }

  const current = await findTeamRegistrationById(id);
  if (!current) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  if (input.status === "REVISION_REQUIRED" || input.status === "NEEDS_SUPPLEMENT") {
    if (!(await isTournamentRegistrationReviewOpen(current.tournamentId))) {
      throw new AppError(409, "Đăng ký đã đóng; BTC không thể yêu cầu bổ sung hồ sơ sau thời điểm này.", "REGISTRATION_CLOSED");
    }
    const note = input.notes?.trim();
    if (!note) throw new AppError(400, "Ghi rõ nội dung đội cần bổ sung", "REVISION_NOTE_REQUIRED");
    const deadline = input.supplementDeadline ? new Date(input.supplementDeadline) : null;
    if (!deadline || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      throw new AppError(400, "Vui lòng nhập thời hạn bổ sung trong tương lai", "SUPPLEMENT_DEADLINE_REQUIRED");
    }
    const updated = await updateTeamRegistration(id, { status: "NEEDS_SUPPLEMENT", notes: note, supplementDeadline: deadline.toISOString() }, approvedBy);
    if (!updated) throw new AppError(409, "Hồ sơ đã thay đổi trước khi lưu yêu cầu bổ sung", "REGISTRATION_NOT_PENDING");
    if (approvedBy) await appendTeamRegistrationHistory({ registrationId: id, action: "NEEDS_SUPPLEMENT", actorId: approvedBy, note: `${note}\nHạn bổ sung: ${deadline.toISOString()}` });
    try { await queueOrganizationNotifications([{
      userId: (await findTeamById(current.teamId))!.captainId,
      type: "TOURNAMENT_REGISTRATION",
      title: "Hồ sơ đội cần bổ sung",
      body: `${note}\nHạn bổ sung: ${deadline.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      data: { registrationId: id, tournamentId: current.tournamentId, status: "NEEDS_SUPPLEMENT", supplementDeadline: deadline.toISOString() },
    }]); } catch (error) { console.error("[organization-service] could not queue captain notification of revision request", error); }
    return updated;
  }
  if (input.status === "APPROVED") {
    const roster = await getRosters(current.tournamentId, current.teamId);
    if (!roster.length) {
      throw new AppError(409, "Đội chưa gửi danh sách cầu thủ cho giải", "REGISTRATION_ROSTER_REQUIRED");
    }
  }
  const queued = await enqueueRegistrationDecision(id, {
    ...input,
    status: input.status as "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN",
  }, approvedBy);
  if (!(await processRegistrationDecision(queued.outboxId))) {
    throw new AppError(409, "Quyết định đang được đồng bộ; vui lòng tải lại danh sách sau ít phút", "REGISTRATION_DECISION_SYNC_PENDING");
  }
  const updated = await getTeamRegistrationByRegistrationId(id);
  if (input.status === "REJECTED" || input.status === "APPROVED") {
    const notSelectedAtLock = input.status === "REJECTED"
      && approvedBy === SYSTEM_FINALIZATION_ACTOR
      && input.notes?.includes("chốt danh sách");
    try { await queueOrganizationNotifications([{
      userId: (await findTeamById(current.teamId))!.captainId,
      type: "TOURNAMENT_REGISTRATION",
      title: input.status === "APPROVED" ? "Hồ sơ đội đã được duyệt" : notSelectedAtLock ? "Hồ sơ không được chọn khi chốt danh sách" : "Hồ sơ đội bị từ chối",
      body: input.status === "APPROVED" ? "BTC đã duyệt hồ sơ đăng ký đội tham gia giải." : input.notes?.trim() || "BTC đã từ chối hồ sơ đăng ký đội.",
      data: { registrationId: id, tournamentId: current.tournamentId, status: input.status },
    }]); } catch (error) { console.error("[organization-service] could not queue captain notification of team registration decision", error); }
  }
  return updated;
}

export async function resubmitTeamRegistrationForCaptain(id: string, captainId: string): Promise<TeamRegistration> {
  const initial = await findTeamRegistrationById(id);
  if (!initial) throw new AppError(409, "Chỉ hồ sơ đang yêu cầu bổ sung mới được gửi lại", "REGISTRATION_NOT_RESUBMITTABLE");
  {
    const current = await findTeamRegistrationById(id);
    if (!current || !( ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(current.status)
      || (current.status === "PENDING" && (await getTournamentRegistrationDraft(current.teamId, current.tournamentId))?.editingSubmitted)
      || (current.status === "REJECTED" && current.resubmissionAllowed))) {
      throw new AppError(409, "Hồ sơ hiện không được phép gửi lại", "REGISTRATION_NOT_RESUBMITTABLE");
    }
    if (current.supplementDeadline && new Date(current.supplementDeadline).getTime() < Date.now()) {
      throw new AppError(409, "Đã quá hạn bổ sung hồ sơ; liên hệ BTC để xin gia hạn", "SUPPLEMENT_DEADLINE_EXPIRED");
    }
    const team = await findTeamById(current.teamId);
    if (!team || team.captainId !== captainId) throw new AppError(403, "You cannot manage this team", "FORBIDDEN");
    if (["PENDING", "REJECTED", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(current.status) && !(await isTournamentRegistrationReviewOpen(current.tournamentId))) {
      throw new AppError(409, "Hạn đăng ký đã đóng; không thể cập nhật hoặc gửi lại hồ sơ.", "REGISTRATION_CLOSED");
    }
    const accepted = await listAcceptedTournamentInvitations(current.teamId, current.tournamentId);
    if (!accepted.length) {
      throw new AppError(409, "Hồ sơ bổ sung chỉ gồm cầu thủ còn hoạt động và đã xác nhận lời mời", "PLAYER_CONFIRMATION_REQUIRED");
    }
    // The accepted invitations define who is eligible to be submitted. For a
    // PENDING + DRAFT_CHANGES application, preserve the captain's saved roster
    // choices (lineup, goalkeeper flag, jersey and position) for those eligible
    // players. Newly accepted invitations are appended using their confirmed
    // invitation data; withdrawn/unaccepted players can never be reintroduced
    // by stale draft JSON.
    const registrationDraft = current.status === "PENDING"
      ? await getTournamentRegistrationDraft(current.teamId, current.tournamentId)
      : null;
    let normalized;
    try {
      normalized = buildResubmissionRoster(accepted as Parameters<typeof buildResubmissionRoster>[0], registrationDraft);
    } catch (error) {
      if (error instanceof Error && error.message === "DRAFT_ROSTER_DUPLICATE_PLAYER") {
        throw new AppError(409, "Bản chỉnh sửa có cầu thủ bị trùng. Hãy tải lại roster và lưu nháp trước khi gửi.", error.message);
      }
      if (error instanceof Error && error.message === "DRAFT_ROSTER_INVITATION_NOT_ACCEPTED") {
        throw new AppError(409, "Bản chỉnh sửa có cầu thủ chưa xác nhận hoặc đã rút. Hãy tải lại roster và lưu nháp trước khi gửi.", error.message);
      }
      throw error;
    }
    const rules = await getTournamentSummary(current.tournamentId);
    const maxPlayers = Math.min(team.maxPlayers, rules.maxPlayersPerTeam);
    if (!rules.minPlayers || !maxPlayers || rules.minGoalkeepers < 0) {
      throw new AppError(409, "Điều lệ giải chưa cấu hình hợp lệ số cầu thủ tối thiểu/tối đa và thủ môn tối thiểu.", "TOURNAMENT_ROSTER_RULES_INVALID");
    }
    if (normalized.length < rules.minPlayers) {
      throw new AppError(409, `Roster thiếu ${rules.minPlayers - normalized.length} cầu thủ đã xác nhận (tối thiểu ${rules.minPlayers}).`, "ROSTER_BELOW_MINIMUM");
    }
    if (normalized.length > maxPlayers) {
      throw new AppError(409, `Roster có ${normalized.length} cầu thủ, vượt tối đa ${maxPlayers} theo điều lệ.`, "ROSTER_ABOVE_MAXIMUM");
    }
    const goalkeeperCount = normalized.filter((entry) => entry.isGoalkeeper).length;
    if (goalkeeperCount < rules.minGoalkeepers) {
      throw new AppError(409, `Roster thiếu ${rules.minGoalkeepers - goalkeeperCount} thủ môn đã xác nhận (tối thiểu ${rules.minGoalkeepers}).`, "ROSTER_GOALKEEPER_BELOW_MINIMUM");
    }
    const jerseys = normalized.map((entry) => entry.jerseyNumber).filter((value): value is number => value !== null);
    if (new Set(jerseys).size !== jerseys.length) throw new AppError(409, "Số áo trong danh sách bổ sung không được trùng", "DUPLICATE_TOURNAMENT_JERSEY");
    const reservationStatus = await reserveTournamentRegistration({
      registrationId: id,
      teamId: current.teamId,
      tournamentId: current.tournamentId,
      institutionId: current.institutionId ?? team.institutionId ?? "",
      isResubmission: true,
      roster: normalized.map((entry) => ({ playerId: entry.playerId, lineupRole: entry.lineupRole, isGoalkeeper: entry.isGoalkeeper })),
    });
    let updated = await resubmitTeamRegistrationRecord(id, captainId, normalized);
    if (!updated) throw new AppError(409, "Hồ sơ đã thay đổi hoặc không còn thuộc quyền gửi lại", "REGISTRATION_NOT_RESUBMITTABLE");
    if (reservationStatus === "WAITLIST") {
      updated = await updateTeamRegistration(id, { status: "WAITLIST", waitlistReason: "TOURNAMENT_CAPACITY", notes: "Giải hoặc trường đã đủ chỉ tiêu; hồ sơ hoàn thiện nằm trong danh sách chờ suất." }, captainId) ?? updated;
      await appendTeamRegistrationHistory({ registrationId: id, action: "WAITLISTED", actorId: captainId, note: "Roster đã điều chỉnh hợp lệ nhưng giải hoặc trường đã đủ chỉ tiêu; hồ sơ chuyển sang chờ suất." });
    }
    await syncTournamentRegistrationReservation(id, reservationStatus, true);
    return updated;
  }
}

export async function withdrawPendingTeamRegistrationForCaptain(
  id: string,
  captainId: string,
  reason: string,
): Promise<TeamRegistration> {
  const note = reason.trim();
  if (note.length < 10) throw new AppError(400, "Vui lòng nhập lý do rút hồ sơ (ít nhất 10 ký tự)", "WITHDRAWAL_REASON_REQUIRED");
  const first = await findTeamRegistrationById(id);
  if (!first) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  return withTournamentRegistrationReviewLock(first.tournamentId, async () => {
    const current = await findTeamRegistrationById(id);
    if (!current) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
    const team = await findTeamById(current.teamId);
    if (!team || team.captainId !== captainId) throw new AppError(403, "You cannot manage this team", "FORBIDDEN");
    if (!["PENDING", "WAITLIST", "REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(current.status)) {
      throw new AppError(409, "Hồ sơ không còn ở trạng thái đội trưởng được tự rút. Đội đã duyệt cần gửi yêu cầu rút để BTC xử lý.", "REGISTRATION_NOT_WITHDRAWABLE");
    }
    const pending = await getPool().query(
      `SELECT 1 FROM team_registration_decision_outbox WHERE registration_id=$1 AND state IN ('PENDING','PROCESSING') LIMIT 1`, [id],
    );
    if (pending.rowCount) throw new AppError(409, "Hồ sơ đang có quyết định BTC đồng bộ; vui lòng tải lại rồi thử lại.", "REGISTRATION_DECISION_SYNC_PENDING");
    const updated = await updateTeamRegistrationStatus(id, { status: "WITHDRAWN", notes: `Đội trưởng chủ động rút hồ sơ: ${note}` }, captainId);
    try { await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "Đã rút hồ sơ đăng ký giải",
      body: "Hồ sơ đã được rút. Lời mời còn chờ đã hủy và quyền tham gia trong giải được giải phóng.",
      data: { registrationId: id, tournamentId: current.tournamentId, status: "WITHDRAWN" },
    }]); } catch (error) { console.error("[organization-service] pending withdrawal notification enqueue failed", error); }
    await notifyRegistrationPlayersOfWithdrawal(current.teamId, current.tournamentId, id);
    return updated;
  });
}

async function notifyRegistrationPlayersOfWithdrawal(teamId: string, tournamentId: string, registrationId: string): Promise<void> {
  try {
    const [roster, players] = await Promise.all([getRosters(tournamentId, teamId), getPlayers(teamId)]);
    const userByPlayerId = new Map(players.filter((player) => player.userId).map((player) => [player.id, player.userId!]));
    const userIds = [...new Set(roster.map((entry) => userByPlayerId.get(entry.playerId)).filter((id): id is string => Boolean(id)))];
    if (!userIds.length) return;
    await queueOrganizationNotifications(userIds.map((userId) => ({
      userId, type: "TOURNAMENT_REGISTRATION", title: "Đội đã rút khỏi giải",
      body: "Hồ sơ đội đã được rút; lời mời thuộc giải này không còn hiệu lực.",
      data: { registrationId, tournamentId, status: "WITHDRAWN" },
    })));
  } catch (error) { console.error("[organization-service] withdrawal player notifications enqueue failed", error); }
}

export async function cancelApprovedTeamWithdrawalRequest(requestId: string, captainId: string) {
  const request = await findWithdrawalRequest(requestId);
  if (!request) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
  const team = await findTeamById(request.teamId);
  if (!team || team.captainId !== captainId) throw new AppError(403, "You cannot manage this team", "FORBIDDEN");
  const updated = await cancelWithdrawalRequest(requestId, captainId);
  try { await queueOrganizationNotifications([{
    userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "Đã hủy yêu cầu rút đội",
    body: "BTC chưa quyết định; yêu cầu rút đã được hủy và hồ sơ vẫn giữ trạng thái hiện tại.",
    data: { registrationId: request.registrationId, tournamentId: request.tournamentId, withdrawalRequestId: requestId, status: "CANCELLED" },
  }]); } catch (error) { console.error("[organization-service] withdrawal cancellation notification enqueue failed", error); }
  return updated;
}

export async function requestApprovedTeamWithdrawal(
  registrationId: string, captainId: string, reason: string,
) {
  const registration = await findTeamRegistrationById(registrationId);
  if (!registration) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  const team = await findTeamById(registration.teamId);
  if (!team || team.captainId !== captainId) throw new AppError(403, "You cannot manage this team", "FORBIDDEN");
  if (registration.status !== "APPROVED") throw new AppError(409, "Yêu cầu này chỉ áp dụng cho đội đã được BTC duyệt", "REGISTRATION_NOT_APPROVED");
  const note = reason.trim();
  if (note.length < 10 || note.length > 2000) throw new AppError(400, "Lý do rút đội phải từ 10 đến 2000 ký tự", "WITHDRAWAL_REASON_REQUIRED");
  const request = await createWithdrawalRequest({
    registrationId, teamId: registration.teamId, tournamentId: registration.tournamentId, requestedBy: captainId, reason: note,
  });
  try {
    await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "Đã gửi yêu cầu rút đội",
      body: "Yêu cầu đã được gửi đến BTC và đang chờ quyết định.",
      data: { registrationId, tournamentId: registration.tournamentId, withdrawalRequestId: request.id },
    }]);
  } catch (error) { console.error("[organization-service] withdrawal request notification enqueue failed", error); }
  return request;
}

export async function getTournamentWithdrawalRequests(tournamentId: string) {
  return listWithdrawalRequests(tournamentId);
}

export async function getRegistrationWithdrawalRequests(registrationId: string) {
  return listWithdrawalRequestsByRegistration(registrationId);
}

export async function decideApprovedTeamWithdrawal(
  requestId: string, decision: "APPROVED" | "REJECTED", decidedBy: string, note: string,
) {
  const request = await findWithdrawalRequest(requestId);
  if (!request) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
  if (request.status !== "PENDING" && !(request.status === "PROCESSING" && request.desiredDecision === decision)) {
    throw new AppError(409, "Withdrawal request has already been decided or is processing another decision", "WITHDRAWAL_REQUEST_ALREADY_DECIDED");
  }
  if (decision === "REJECTED" && note.trim().length < 5) {
    throw new AppError(400, "BTC phải nêu lý do khi từ chối yêu cầu rút", "DECISION_NOTE_REQUIRED");
  }
  let approvedRegistration: TeamRegistration | null = null;
  if (decision === "APPROVED") {
    approvedRegistration = await findTeamRegistrationById(request.registrationId);
    if (!approvedRegistration?.institutionId) throw new AppError(409, "Registration is missing its school link", "REGISTRATION_SCHOOL_REQUIRED");
  }
  const claimed = await beginWithdrawalDecision({ id: requestId, decision, decidedBy, note });
  if (decision === "APPROVED" && approvedRegistration?.institutionId) {
    try {
      await approveTournamentTeamWithdrawal({
        registrationId: request.registrationId,
        tournamentId: request.tournamentId,
        actorId: decidedBy,
        reason: `${request.reason}${note.trim() ? `\nQuyết định BTC: ${note.trim()}` : ""}`,
      });
    } catch (error) {
      // A definitive downstream rejection (for example, a draw was already
      // published) is not retryable. Release the queue item so BTC can choose
      // a valid alternative, such as rejecting the withdrawal with a reason.
      if (error instanceof AppError && error.status >= 400 && error.status < 500) {
        await releaseWithdrawalDecision({ id: claimed.id, decision });
      }
      throw error;
    }
  }
  const updated = await completeWithdrawalDecision(claimed.id, decision);
  const team = await findTeamById(request.teamId);
  if (team) {
    try { await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION",
      title: decision === "APPROVED" ? "BTC đã chấp thuận rút đội" : "BTC đã từ chối yêu cầu rút đội",
      body: decision === "APPROVED" ? "Đội đã được rút khỏi danh sách đăng ký giải." : note.trim(),
      data: { registrationId: request.registrationId, tournamentId: request.tournamentId, withdrawalRequestId: requestId, status: decision },
    }]); } catch (error) { console.error("[organization-service] withdrawal decision notification enqueue failed", error); }
  }
  if (decision === "APPROVED") await notifyRegistrationPlayersOfWithdrawal(request.teamId, request.tournamentId, request.registrationId);
  return updated;
}

export async function openApprovedRegistrationReview(input: {
  registrationId: string; requestedBy: string; reason: string; responseDeadline: string;
}) {
  const registration = await findTeamRegistrationById(input.registrationId);
  if (!registration) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  if (registration.status !== "APPROVED") throw new AppError(409, "Chỉ hồ sơ đã duyệt mới được xem xét lại", "REGISTRATION_NOT_APPROVED");
  const reason = input.reason.trim();
  const deadline = new Date(input.responseDeadline);
  if (reason.length < 10 || reason.length > 2000) throw new AppError(400, "Lý do xem xét lại phải từ 10 đến 2000 ký tự", "REVIEW_REASON_REQUIRED");
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) throw new AppError(400, "Hạn giải trình phải là thời điểm trong tương lai", "REVIEW_DEADLINE_REQUIRED");
  if (!(await isTournamentRegistrationReviewOpen(registration.tournamentId))) {
    throw new AppError(409, "Chỉ được mở xem xét lại trước khi giải khóa danh sách", "APPROVED_REVIEW_PERIOD_CLOSED");
  }
  const review = await createApprovalReview({ ...input, reason, responseDeadline: deadline.toISOString() });
  const team = await findTeamById(registration.teamId);
  if (team) {
    try { await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "BTC yêu cầu giải trình hồ sơ đã duyệt",
      body: `${reason}\nHạn phản hồi: ${deadline.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      data: { registrationId: registration.id, tournamentId: registration.tournamentId, approvalReviewId: review.id, status: "APPROVAL_REVIEW_OPEN" },
    }]); } catch (error) { console.error("[organization-service] approval review notification enqueue failed", error); }
  }
  return review;
}

export async function getApprovedRegistrationReviews(registrationId: string) {
  const registration = await findTeamRegistrationById(registrationId);
  if (!registration) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
  return listApprovalReviews(registrationId);
}

export async function getApprovedRegistrationReviewContext(reviewId: string) {
  return findApprovalReview(reviewId);
}

export async function getPendingApprovalReviewCount(tournamentId: string): Promise<number> {
  return countOpenApprovalReviews(tournamentId);
}

export async function respondToApprovedRegistrationReview(input: { reviewId: string; captainId: string; response: string }) {
  const response = input.response.trim();
  if (response.length < 10 || response.length > 2000) throw new AppError(400, "Nội dung giải trình phải từ 10 đến 2000 ký tự", "REVIEW_RESPONSE_REQUIRED");
  const review = await respondToApprovalReview(input.reviewId, input.captainId, response);
  const context = await findApprovalReview(input.reviewId);
  if (context) {
    try { await queueOrganizationNotifications([{
      userId: context.requestedBy, type: "TOURNAMENT_REGISTRATION", title: "Đội đã gửi giải trình",
      body: "BTC có thể xem phản hồi trong hồ sơ đội và hoàn tất xem xét lại.",
      data: { registrationId: context.registrationId, tournamentId: context.tournamentId, approvalReviewId: review.id, status: "APPROVAL_REVIEW_RESPONDED" },
    }]); } catch (error) { console.error("[organization-service] approval review response notification enqueue failed", error); }
  }
  return review;
}

export async function decideApprovedRegistrationReview(input: {
  reviewId: string; decision: "RETAIN_APPROVAL" | "REVOKE_APPROVAL" | "REQUEST_SUPPLEMENT"; decidedBy: string; note: string; supplementDeadline?: string;
}) {
  const context = await findApprovalReview(input.reviewId);
  if (!context) throw new AppError(404, "Approval review not found", "APPROVAL_REVIEW_NOT_FOUND");
  if (!["OPEN", "RESPONDED", "SUPPLEMENT_REQUIRED"].includes(context.status)) throw new AppError(409, "Yêu cầu xem xét lại đã được xử lý", "APPROVAL_REVIEW_ALREADY_DECIDED");
  const note = input.note.trim();
  if (input.decision === "REVOKE_APPROVAL" && (note.length < 10 || note.length > 2000)) {
    throw new AppError(400, "Lý do thu hồi phê duyệt phải từ 10 đến 2000 ký tự", "APPROVAL_REVOCATION_REASON_REQUIRED");
  }
  if (input.decision === "REQUEST_SUPPLEMENT") {
    const deadline = new Date(input.supplementDeadline ?? "");
    if (note.length < 10 || note.length > 2000) throw new AppError(400, "Nội dung yêu cầu bổ sung phải từ 10 đến 2000 ký tự", "DECISION_NOTE_REQUIRED");
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) throw new AppError(400, "Hạn bổ sung phải là thời điểm trong tương lai", "SUPPLEMENT_DEADLINE_REQUIRED");
    if (context.registrationStatus !== "APPROVED") throw new AppError(409, "Hồ sơ không còn ở trạng thái đã duyệt", "REGISTRATION_NOT_APPROVED");
    if (!(await isTournamentRegistrationReviewOpen(context.tournamentId))) {
      throw new AppError(409, "Đăng ký đã đóng; BTC không thể yêu cầu bổ sung hồ sơ sau thời điểm này.", "REGISTRATION_CLOSED");
    }
    if (context.registrationStatus !== "APPROVED") throw new AppError(409, "Hồ sơ không còn ở trạng thái đã duyệt", "REGISTRATION_NOT_APPROVED");
    const review = await requestApprovalReviewSupplement(input.reviewId, note, deadline.toISOString(), input.decidedBy);
    const team = await findTeamById(context.teamId);
    if (team) try { await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "BTC yêu cầu bổ sung hồ sơ đã duyệt",
      body: `${note}\nHạn bổ sung: ${deadline.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`,
      data: { registrationId: context.registrationId, tournamentId: context.tournamentId, approvalReviewId: input.reviewId, status: "SUPPLEMENT_REQUIRED" },
    }]); } catch (error) { console.error("[organization-service] approval supplement notification enqueue failed", error); }
    return { review, registration: await getTeamRegistrationByRegistrationId(context.registrationId) };
  }
  if (input.decision === "RETAIN_APPROVAL") {
    const review = await retainApprovalReview(input.reviewId, input.decidedBy, note);
    const team = await findTeamById(context.teamId);
    if (team) try { await queueOrganizationNotifications([{
      userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "BTC giữ nguyên phê duyệt",
      body: note || "BTC đã hoàn tất xem xét lại và giữ nguyên quyết định duyệt đội.",
      data: { registrationId: context.registrationId, tournamentId: context.tournamentId, approvalReviewId: review.id, status: "APPROVED" },
    }]); } catch (error) { console.error("[organization-service] approval review decision notification enqueue failed", error); }
    return { review, registration: await getTeamRegistrationByRegistrationId(context.registrationId) };
  }

  if (context.registrationStatus !== "APPROVED") throw new AppError(409, "Hồ sơ không còn ở trạng thái đã duyệt", "REGISTRATION_NOT_APPROVED");
  const tournamentReviewState = await getTournamentRegistrationReviewState(context.tournamentId);
  assertApprovalRevocationAllowed(tournamentReviewState.status);
  const queued = await enqueueRegistrationDecision(context.registrationId, { status: "REJECTED", notes: note }, input.decidedBy,
    { approvalReviewId: input.reviewId, action: "REVOKE_APPROVAL" });
  if (!(await processRegistrationDecision(queued.outboxId))) throw new AppError(409, "Quyết định thu hồi đang đồng bộ; hãy tải lại sau ít phút", "REGISTRATION_DECISION_SYNC_PENDING");
  const team = await findTeamById(context.teamId);
  if (team) try { await queueOrganizationNotifications([{
    userId: team.captainId, type: "TOURNAMENT_REGISTRATION", title: "BTC đã thu hồi phê duyệt",
    body: note, data: { registrationId: context.registrationId, tournamentId: context.tournamentId, approvalReviewId: input.reviewId, status: "APPROVAL_REVOKED" },
  }]); } catch (error) { console.error("[organization-service] approval revocation notification enqueue failed", error); }
  return { review: await findApprovalReview(input.reviewId), registration: await getTeamRegistrationByRegistrationId(context.registrationId) };
}

/**
 * Deliver a durable decision event to Tournament service, then apply its result
 * locally. The row is committed before the network call, so process restarts and
 * temporary service outages cannot lose a BTC decision.
 */
export async function processRegistrationDecision(outboxId?: string): Promise<boolean> {
  const item = await claimRegistrationDecision(outboxId);
  if (!item) return false;
  try {
    if (item.desiredStatus === "APPROVED") await reconcileExistingApprovedPlayerClaims();
    const approvedRoster = item.desiredStatus === "APPROVED" ? await getRosters(item.tournamentId, item.teamId) : [];
    const syncResult = await syncTournamentRegistrationReservation(
      item.registrationId,
      item.desiredStatus === "NEEDS_SUPPLEMENT" ? "PENDING" : item.desiredStatus,
      true,
      { tournamentId: item.tournamentId, teamId: item.teamId, institutionId: item.institutionId },
      approvedRoster.map((player) => player.playerId),
    );
    const completion = await completeRegistrationDecision(item, syncResult);
    for (const adjusted of completion.conflictedRegistrations) {
      const team = await findTeamById(adjusted.teamId);
      if (!team) continue;
      const conflictRoster = await getRosters(adjusted.tournamentId, team.id);
      const playerNameById = new Map(conflictRoster.map((player) => [player.playerId, player.playerNameSnapshot ?? player.playerId]));
      const conflictNote = adjusted.conflicts.map((conflict) => `${playerNameById.get(conflict.playerId) ?? conflict.playerId} · ${conflict.conflictingTournamentName}`).join("\n");
      try {
        await queueOrganizationNotifications([{
          userId: team.captainId,
          type: "TOURNAMENT_REGISTRATION",
          title: "Hồ sơ cần điều chỉnh do trùng cầu thủ",
          body: `Một hoặc nhiều cầu thủ trong roster đã được duyệt ở giải có thời gian trùng nhau. Hãy thay cầu thủ và gửi lại trước hạn${adjusted.adjustmentDeadline ? ` ${new Date(adjusted.adjustmentDeadline).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : " đăng ký"}.\n${conflictNote}`,
          data: { registrationId: adjusted.id, tournamentId: adjusted.tournamentId, status: "CONFLICT_ADJUSTMENT_REQUIRED", conflicts: adjusted.conflicts, adjustmentDeadline: adjusted.adjustmentDeadline },
        }]);
      } catch (error) { console.error("[organization-service] could not queue player-conflict notification", adjusted.id, error); }
    }
    for (const waitlistedId of completion.waitlistedRegistrationIds) {
      const waitlisted = await getTeamRegistrationByRegistrationId(waitlistedId);
      const team = await findTeamById(waitlisted.teamId);
      if (team) try { await queueOrganizationNotifications([{
        userId: team.captainId,
        type: "TOURNAMENT_REGISTRATION",
        title: "Hồ sơ được chuyển vào danh sách chờ suất",
        body: "Giải hoặc trường đã đủ chỉ tiêu. Hồ sơ của đội vẫn được lưu; nếu có suất trống, BTC có thể tiếp tục xét duyệt.",
        data: { registrationId: waitlistedId, tournamentId: waitlisted.tournamentId, status: "WAITLIST" },
      }]); } catch (error) { console.error("[organization-service] could not queue waitlist notification", waitlistedId, error); }
    }
    return true;
  } catch (error) {
    const status = error instanceof AppError ? error.status : 503;
    await failRegistrationDecision(item, error, status >= 500);
    throw error;
  }
}

export async function processPendingRegistrationDecisions(limit = 10): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    try {
      if (!(await processRegistrationDecision())) return;
    } catch (error) {
      console.error("[organization-service] registration decision synchronization failed", error);
    }
  }
}

export async function expireClosedConflictAdjustments(limit = 100): Promise<void> {
  const candidates = await listConflictAdjustmentRegistrations(limit);
  const systemActorId = "00000000-0000-0000-0000-000000000001";
  for (const registration of candidates) {
    const deadlinePassed = Boolean(registration.adjustmentDeadline)
      && new Date(registration.adjustmentDeadline!).getTime() <= Date.now();
    if (!deadlinePassed && await isTournamentRegistrationReviewOpen(registration.tournamentId)) continue;
    try {
      await updateTeamRegistrationStatus(registration.id, {
        status: "REJECTED",
        notes: "Không khắc phục xung đột cầu thủ đúng hạn; hồ sơ tự động hết hiệu lực khi đóng đăng ký.",
      }, systemActorId);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "REGISTRATION_ALREADY_DECIDED") {
        console.error("[organization-service] could not expire a closed conflict adjustment", registration.id, error);
      }
    }
  }
}

export async function reconcileExistingApprovedPlayerClaims(): Promise<void> {
  const claims = await listApprovedRegistrationPlayerClaims();
  if (claims.length) await reconcileTournamentPlayerClaims(claims);
  const acceptedInvitations = await listAcceptedTournamentInvitationClaims();
  for (const invitation of acceptedInvitations) {
    try {
      await reserveTournamentInvitationParticipation({ invitationId: invitation.id, tournamentId: invitation.tournament_id, teamId: invitation.team_id, playerId: invitation.player_id });
    } catch (error) {
      if (error instanceof AppError && error.code === "PLAYER_TOURNAMENT_DATE_CONFLICT") {
        console.error("[organization-service] legacy accepted invitation conflicts with another confirmed tournament roster", invitation.id);
        continue;
      }
      throw error;
    }
  }
}

export async function finalizeUnselectedWaitlistRegistrations(limit = 100, tournamentId?: string): Promise<number> {
  const waitlist = await listReviewableRegistrationsForFinalization(tournamentId, limit);
  const systemActorId = "00000000-0000-0000-0000-000000000001";
  let finalizedCount = 0;
  for (const registration of waitlist) {
    const state = await getTournamentRegistrationReviewState(registration.tournamentId);
    if (!["ROSTER_LOCKED", "PREPARING", "IN_PROGRESS", "PAUSED", "COMPLETED"].includes(state.status)) continue;
    try {
      const reason = registration.status === "WAITLIST"
        ? "Hồ sơ chờ suất không được chọn trước khi chốt danh sách; giải đã khóa. Suất và quyền tham gia cầu thủ đã được giải phóng."
        : ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(registration.status)
          ? "Hồ sơ chưa hoàn thành bổ sung tại thời điểm chốt danh sách; kết thúc xét duyệt, không phải từ chối do vi phạm điều lệ."
          : registration.status === "CONFLICT_ADJUSTMENT_REQUIRED"
            ? "Hồ sơ chưa khắc phục xung đột cầu thủ trước khi chốt danh sách; kết thúc xét duyệt."
            : "Hồ sơ chờ xét duyệt chưa được chọn trước khi chốt danh sách; kết thúc xét duyệt theo quyết định khóa danh sách.";
      await updateTeamRegistrationStatus(registration.id, {
        status: "REJECTED",
        notes: reason,
      }, systemActorId);
      finalizedCount += 1;
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "REGISTRATION_ALREADY_DECIDED") {
        console.error("[organization-service] could not finalize an unselected waitlist entry", registration.id, error);
      }
    }
  }
  return finalizedCount;
}

export async function expireClosedSupplementRegistrations(limit = 100): Promise<void> {
  const candidates = await listSupplementRegistrationsForExpiry(limit);
  const systemActorId = "00000000-0000-0000-0000-000000000001";
  for (const registration of candidates) {
    const deadlinePassed = Boolean(registration.supplementDeadline) && new Date(registration.supplementDeadline!).getTime() <= Date.now();
    if (!deadlinePassed && await isTournamentRegistrationReviewOpen(registration.tournamentId)) continue;
    try {
      await updateTeamRegistrationStatus(registration.id, {
        status: "REJECTED",
        notes: deadlinePassed
          ? "Hết hạn bổ sung hồ sơ mà đội chưa gửi phiên bản hoàn thiện; kết thúc xét duyệt và giải phóng quyền giữ chỗ cầu thủ."
          : "Hồ sơ chưa hoàn thành bổ sung trước khi giải đấu đóng đăng ký. Hồ sơ hết hiệu lực, lịch sử được lưu và quyền giữ chỗ cầu thủ được giải phóng.",
      }, systemActorId);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "REGISTRATION_ALREADY_DECIDED") {
        console.error("[organization-service] could not expire an incomplete supplement", registration.id, error);
      }
    }
  }
}

// Players
export async function getPlayers(teamId: string, includeLeft: boolean = false): Promise<Player[]> {
  const team = await findTeamById(teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  return listPlayers(teamId, includeLeft);
}

export async function getActiveTeamPlayerIds(teamId: string, playerIds: string[]): Promise<string[]> {
  if (!playerIds.length) return [];
  const team = await findTeamById(teamId);
  if (!team) throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  return listActivePlayerIdsForTeam(teamId, playerIds);
}

export async function getPlayer(id: string): Promise<Player> {
  const player = await findPlayerById(id);
  if (!player) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }
  return player;
}

export async function addPlayerToTeam(input: PlayerCreateInput): Promise<Player> {
  // Check if team exists
  const team = await findTeamById(input.teamId);
  if (!team) {
    throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
  }

  // Check if player already in team
  if (!input.fullName.trim()) {
    throw new AppError(400, "Player name is required", "INVALID_PLAYER_NAME");
  }
  const existing = input.userId
    ? await findPlayerByTeamAndUser(input.teamId, input.userId)
    : null;
  if (existing) {
    throw new AppError(409, "User already in this team", "ALREADY_IN_TEAM");
  }
  if (
    input.birthDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ||
      Number.isNaN(Date.parse(`${input.birthDate}T00:00:00Z`)) ||
      new Date(`${input.birthDate}T00:00:00Z`) > new Date())
  ) {
    throw new AppError(400, "Birth date is invalid", "INVALID_BIRTH_DATE");
  }
  if (input.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    throw new AppError(400, "Contact email is invalid", "INVALID_CONTACT_EMAIL");
  }

  // Validation: position must be valid
  const validPositions = ["GK", "DEF", "MID", "FWD"];
  if (input.position && !validPositions.includes(input.position)) {
    throw new AppError(400, "Invalid position", "INVALID_POSITION");
  }

  // Validation: jersey number must be positive
  if (input.jerseyNumber !== undefined && input.jerseyNumber <= 0) {
    throw new AppError(400, "Jersey number must be greater than 0", "INVALID_JERSEY_NUMBER");
  }

  // Business rule: check team max players
  const currentPlayers = await listPlayers(input.teamId, false);
  if (currentPlayers.length >= team.maxPlayers) {
    throw new AppError(400, "Team has reached maximum players", "MAX_PLAYERS_REACHED");
  }
  if (
    input.jerseyNumber !== undefined &&
    currentPlayers.some((player) => player.jerseyNumber === input.jerseyNumber)
  ) {
    throw new AppError(409, "Jersey number is already in use by this team", "DUPLICATE_JERSEY_NUMBER");
  }
  if (
    input.studentId &&
    currentPlayers.some((player) => player.studentId?.toLowerCase() === input.studentId?.toLowerCase())
  ) {
    throw new AppError(409, "Student ID is already registered for this team", "DUPLICATE_STUDENT_ID");
  }

  return createPlayer(input);
}

export async function updatePlayerInfo(id: string, input: PlayerUpdateInput): Promise<Player> {
  // Validation: position must be valid
  const validPositions = ["GK", "DEF", "MID", "FWD"];
  if (input.position && !validPositions.includes(input.position)) {
    throw new AppError(400, "Invalid position", "INVALID_POSITION");
  }

  // Validation: jersey number must be positive
  if (input.jerseyNumber !== undefined && input.jerseyNumber <= 0) {
    throw new AppError(400, "Jersey number must be greater than 0", "INVALID_JERSEY_NUMBER");
  }

  const updated = await updatePlayer(id, input);
  if (!updated) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }

  return updated;
}

export async function removePlayerFromTeam(id: string): Promise<void> {
  const deleted = await deletePlayer(id);
  if (!deleted) {
    throw new AppError(404, "Player not found", "PLAYER_NOT_FOUND");
  }
}
