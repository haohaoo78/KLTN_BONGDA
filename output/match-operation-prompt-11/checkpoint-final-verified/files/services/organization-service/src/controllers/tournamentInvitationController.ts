import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { AppError } from "../lib/errors";
import { assertCanManageTeam, getUnavailableTournamentPlayerIds, isTournamentRegistrationReviewOpen, releaseTournamentInvitationParticipation, reserveTournamentInvitationParticipation, requireUserId, syncTournamentRegistrationReservation, getTournamentRegistrationReviewState, getLockedRosterAdditionEligibility } from "../lib/teamAuthorization";
import { getTeam, getPlayer, getTeamRegistration } from "../services/teamService";
import { assertTournamentRosterEditable } from "../lib/teamAuthorization";
import {
  createTournamentInvitations, getInvitationWithCaptain, listAcceptedTournamentInvitations,
  listTournamentInvitationsForPlayer, listTournamentInvitationsForTeam,
  respondToTournamentInvitation,
  updateInvitationForCaptain,
  markTournamentInvitationInvalidated,
} from "../repositories/tournamentInvitationRepository";
import { queueOrganizationNotifications } from "../services/organizationNotificationOutboxService";
import { getTournamentSummary } from "../lib/tournamentSummaryClient";
import {
  createPlayerTournamentWithdrawalRequest,
  listPlayerTournamentWithdrawalRequestsForPlayer,
  listPlayerTournamentWithdrawalRequestsForTeam,
  getPlayerTournamentWithdrawalRequest,
  beginPlayerTournamentWithdrawalDecision,
  completePlayerTournamentWithdrawalDecision,
  releasePlayerTournamentWithdrawalDecision,
} from "../repositories/playerTournamentWithdrawalRepository";
import { deleteTournamentRegistrationDraft, getTournamentRegistrationDraft, saveTournamentRegistrationDraft } from "../repositories/tournamentRegistrationDraftRepository";

export const tournamentInvitationController = {
  async getDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId, tournamentId } = req.params;
      await assertCanManageTeam(req, teamId);
      res.json({ draft: await getTournamentRegistrationDraft(teamId, tournamentId) });
    } catch (error) { next(error); }
  },

  async saveDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId, tournamentId } = req.params;
      await assertCanManageTeam(req, teamId);
      await assertTournamentRosterEditable(tournamentId);
      let editableRegistration: Awaited<ReturnType<typeof getTeamRegistration>> | null = null;
      try {
        editableRegistration = await getTeamRegistration(teamId, tournamentId);
        const editableStatus = ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED", "PENDING"].includes(editableRegistration.status)
          || (editableRegistration.status === "REJECTED" && editableRegistration.resubmissionAllowed)
          || (editableRegistration.status === "PENDING" && (await getTournamentRegistrationDraft(teamId, tournamentId))?.editingSubmitted === true);
        if (!editableStatus) {
          throw new AppError(409, "Hồ sơ đã gửi cho BTC; không thể lưu bản nháp chỉnh sửa roster", "REGISTRATION_ROSTER_SNAPSHOT_LOCKED");
        }
      } catch (error) {
        if (error instanceof AppError && error.code !== "REGISTRATION_NOT_FOUND") throw error;
      }
      if (editableRegistration && !(await isTournamentRegistrationReviewOpen(tournamentId))) {
        throw new AppError(409, "Đã hết hạn đăng ký; không thể bắt đầu hoặc tiếp tục chỉnh sửa hồ sơ.", "REGISTRATION_CLOSED");
      }
      const rawRoster = req.body?.roster;
      if (!Array.isArray(rawRoster) || rawRoster.length > 40) throw new AppError(400, "Roster draft must contain at most 40 players", "INVALID_REGISTRATION_DRAFT");
      const roster = [];
      const seen = new Set<string>();
      for (const item of rawRoster) {
        if (!item || typeof item.playerId !== "string" || seen.has(item.playerId)) throw new AppError(400, "Draft players must be unique", "INVALID_REGISTRATION_DRAFT");
        seen.add(item.playerId);
        const player = await getPlayer(item.playerId);
        if (player.teamId !== teamId || player.leftAt || !player.userId) throw new AppError(400, "Draft can only include active players in this club", "INVALID_DRAFT_PLAYER");
        if (!(["PLAYER", "PLAYING_CAPTAIN", "VICE_CAPTAIN"].includes(item.competitionRole)
          && ["STARTER", "SUBSTITUTE"].includes(item.lineupRole)
          && (item.position === null || item.position === undefined || ["GK", "DEF", "MID", "FWD"].includes(item.position))
          && (item.proposedJerseyNumber === null || item.proposedJerseyNumber === undefined || (Number.isInteger(item.proposedJerseyNumber) && item.proposedJerseyNumber >= 1 && item.proposedJerseyNumber <= 99)))) {
          throw new AppError(400, "Invalid player role, position, or jersey number in draft", "INVALID_REGISTRATION_DRAFT");
        }
        roster.push({
          playerId: player.id,
          competitionRole: item.competitionRole,
          lineupRole: item.lineupRole,
          isGoalkeeper: item.isGoalkeeper === true || item.position === "GK",
          proposedJerseyNumber: item.proposedJerseyNumber ?? player.jerseyNumber ?? null,
          position: item.position ?? player.position ?? null,
        });
      }
      const draft = await saveTournamentRegistrationDraft({
        teamId, tournamentId, updatedBy: requireUserId(req), roster,
        notes: typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 2000) : "",
        registrationId: editableRegistration?.id ?? null,
        baseVersion: editableRegistration?.version ?? null,
        editingSubmitted: Boolean(editableRegistration),
        draftState: editableRegistration ? "DRAFT_CHANGES" : "DRAFT",
      });
      res.json({ draft });
    } catch (error) { next(error); }
  },

  async deleteDraft(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId, tournamentId } = req.params;
      await assertCanManageTeam(req, teamId);
      await deleteTournamentRegistrationDraft(teamId, tournamentId);
      res.status(204).send();
    } catch (error) { next(error); }
  },

  async createBatch(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { teamId, tournamentId } = req.params;
      await assertCanManageTeam(req, teamId);
      let lockedAdditionMode = false;
      let approvedAmendmentMode = false;
      try {
        const registration = await getTeamRegistration(teamId,tournamentId);
        const state = await getTournamentRegistrationReviewState(tournamentId);
        lockedAdditionMode = registration.status === "APPROVED" && ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(state.status);
        approvedAmendmentMode = registration.status === "APPROVED" && ["OPEN_REGISTRATION","REGISTRATION_CLOSED"].includes(state.status);
        if (!lockedAdditionMode) await assertTournamentRosterEditable(tournamentId);
      } catch (error) { if (!(error instanceof AppError && error.code === "REGISTRATION_NOT_FOUND")) throw error; await assertTournamentRosterEditable(tournamentId); }
      try {
        const registration = await getTeamRegistration(teamId, tournamentId);
      const draft = await getTournamentRegistrationDraft(teamId, tournamentId);
      if (!["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(registration.status)
        && !(registration.status === "PENDING" && draft?.editingSubmitted) && !lockedAdditionMode && !approvedAmendmentMode) throw new AppError(409, "Hồ sơ chỉ được cập nhật trước quyết định BTC khi đang có bản chỉnh sửa mở.", "REGISTRATION_ROSTER_SNAPSHOT_LOCKED");
      } catch (error) {
        if (error instanceof AppError && error.code !== "REGISTRATION_NOT_FOUND") throw error;
      }
      const team = await getTeam(teamId);
      const tournament = await getTournamentSummary(tournamentId);
      if (!tournament.startDate || !tournament.endDate || tournament.endDate < tournament.startDate) {
        throw new AppError(409, "Giải cần có ngày bắt đầu và kết thúc trước khi lập roster", "TOURNAMENT_DATES_REQUIRED");
      }
      const players = req.body?.players;
      if (!Array.isArray(players) || players.length === 0 || players.length > 40) {
        throw new AppError(400, "Select between 1 and 40 players", "INVALID_INVITATION_BATCH");
      }
      if (lockedAdditionMode && players.length !== 1) throw new AppError(409,"Sau khi khóa roster chỉ được mời từng cầu thủ bổ sung theo yêu cầu ngoại lệ","LOCKED_ROSTER_ADDITION_ONLY");
      const seen = new Set<string>();
      const normalized = [];
      const expiryInput = typeof req.body.expiresAt === "string" ? Date.parse(req.body.expiresAt) : Date.now() + 7 * 86400000;
      if (!Number.isFinite(expiryInput) || expiryInput <= Date.now() || expiryInput > Date.now() + 30 * 86400000) {
        throw new AppError(400, "Invitation expiry must be within the next 30 days", "INVALID_INVITATION_EXPIRY");
      }
      for (const raw of players) {
        if (!raw || typeof raw.playerId !== "string" || seen.has(raw.playerId)) {
          throw new AppError(400, "Each selected player must be unique", "INVALID_INVITATION_BATCH");
        }
        seen.add(raw.playerId);
        const player = await getPlayer(raw.playerId);
        if (player.teamId !== teamId || player.leftAt || !player.userId || !player.fullName?.trim() || !player.studentId?.trim()) {
          throw new AppError(400, "Only active club members with a linked account, name, and student ID can be invited", "INVALID_INVITED_PLAYER");
        }
        const competitionRole = raw.competitionRole ?? "PLAYER";
        const lineupRole = raw.lineupRole ?? "SUBSTITUTE";
        const position = raw.position ?? player.position;
        const jersey = raw.proposedJerseyNumber;
        if (!["PLAYER", "PLAYING_CAPTAIN", "VICE_CAPTAIN"].includes(competitionRole) || !["STARTER", "SUBSTITUTE"].includes(lineupRole)) {
          throw new AppError(400, "Invalid competition role or lineup role", "INVALID_INVITATION_ROLE");
        }
        if (position !== null && position !== undefined && !["GK", "DEF", "MID", "FWD"].includes(position)) {
          throw new AppError(400, "Invalid player position", "INVALID_POSITION");
        }
        if (jersey !== undefined && jersey !== null && (!Number.isInteger(jersey) || jersey < 1 || jersey > 99)) {
          throw new AppError(400, "Proposed jersey number must be between 1 and 99", "INVALID_JERSEY_NUMBER");
        }
        normalized.push({
          teamId, tournamentId, playerId: player.id, invitedBy: requireUserId(req),
          competitionRole, lineupRole, isGoalkeeper: raw.isGoalkeeper === true || position === "GK",
          proposedJerseyNumber: jersey ?? player.jerseyNumber,
          positionSnapshot: typeof position === "string" ? position : null,
          message: typeof req.body.message === "string" ? req.body.message.trim().slice(0, 1000) : null,
          expiresAt: new Date(expiryInput).toISOString(),
        });
      }
      const proposedNumbers = normalized.map((item) => item.proposedJerseyNumber).filter((value): value is number => value !== null);
      if (new Set(proposedNumbers).size !== proposedNumbers.length) throw new AppError(409, "Không thể mời hai cầu thủ cùng số áo dự kiến", "DUPLICATE_TOURNAMENT_JERSEY");
      const unavailable = await getUnavailableTournamentPlayerIds(tournamentId, teamId, normalized.map((item) => item.playerId));
      if (unavailable.length) throw new AppError(409, "Một số cầu thủ đã xác nhận roster ở giải có thời gian trùng; hãy bỏ họ khỏi danh sách mời", "PLAYER_TOURNAMENT_DATE_CONFLICT");
      if (lockedAdditionMode) {
        const eligibility = await getLockedRosterAdditionEligibility(tournamentId, normalized.map((item) => item.playerId));
        if (!eligibility.eligible || (eligibility.alreadyAppearedPlayerIds ?? []).length) throw new AppError(409,eligibility.reason ?? "Không còn đủ điều kiện bổ sung cầu thủ","LOCKED_ROSTER_ADDITION_NOT_ALLOWED");
      }
      const created = await createTournamentInvitations(normalized.map((item) => ({
        ...item,
        tournamentStartDate: tournament.startDate!, tournamentEndDate: tournament.endDate!, tournamentName: tournament.name,
      })));
      await queueOrganizationNotifications(created.map((invite) => ({
        userId: invite.player_user_id,
        type: "TOURNAMENT_INVITATION" as const,
        title: `Lời mời tham gia giải từ ${team.name}`,
        body: `${team.name} mời bạn tham gia ${tournament.name}. Hãy xem vai trò, vị trí và số áo dự kiến rồi phản hồi.`,
        data: {
          invitationId: invite.id,
          teamId,
          tournamentId,
          teamName: team.name,
          tournamentName: tournament.name,
          tournamentStartDate: tournament.startDate,
          tournamentEndDate: tournament.endDate,
          expiresAt: new Date(invite.expires_at).toISOString(),
        },
      })));
      res.status(201).json({ invitations: created, notificationQueued: true });
    } catch (error) { next(error); }
  },

  async listMine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const invitations = await listTournamentInvitationsForPlayer(requireUserId(req));
      const tournamentIds = [...new Set(invitations.map((item) => String(item.tournament_id)))];
      const summaries = await Promise.all(tournamentIds.map(async (id) => {
        try { return [id, await getTournamentSummary(id)] as const; }
        catch { return [id, null] as const; }
      }));
      const editableByTournament = new Map<string, boolean>();
      await Promise.all([...new Set(invitations.filter((item) => item.status === "ACCEPTED").map((item) => String(item.tournament_id)))].map(async (id) => {
        try { await assertTournamentRosterEditable(id); editableByTournament.set(id, true); }
        catch { editableByTournament.set(id, false); }
      }));
      const summaryById = new Map(summaries);
      res.json({ invitations: invitations.map((item) => ({
        ...item,
        tournament_name: summaryById.get(String(item.tournament_id))?.name ?? null,
        tournament_start_date: summaryById.get(String(item.tournament_id))?.startDate ?? null,
        tournament_end_date: summaryById.get(String(item.tournament_id))?.endDate ?? null,
        can_request_withdrawal: item.status === "ACCEPTED"
          && (!item.registration_status || ["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(item.registration_status))
          && editableByTournament.get(String(item.tournament_id)) === true,
      })) });
    }
    catch (error) { next(error); }
  },

  async listForTeam(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTeam(req, req.params.teamId);
      res.json({ invitations: await listTournamentInvitationsForTeam(req.params.teamId, req.params.tournamentId) });
    } catch (error) { next(error); }
  },

  async respond(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = req.body?.status;
      if (status !== "ACCEPTED" && status !== "DECLINED") throw new AppError(400, "Cầu thủ rút xác nhận phải gửi yêu cầu để đội trưởng xem xét", "INVALID_INVITATION_RESPONSE");
      const before = await getInvitationWithCaptain(req.params.id);
      if (!before || before.player_user_id !== requireUserId(req)) throw new AppError(404, "Invitation not found", "INVITATION_NOT_FOUND");
      try {
        const registration = await getTeamRegistration(before.team_id, before.tournament_id);
      const draft = await getTournamentRegistrationDraft(before.team_id, before.tournament_id);
      const tournamentState = await getTournamentRegistrationReviewState(before.tournament_id);
      const lockedAdditionMode = registration.status === "APPROVED" && ["ROSTER_LOCKED","PREPARING","IN_PROGRESS"].includes(tournamentState.status);
      const approvedAmendmentMode = registration.status === "APPROVED" && ["OPEN_REGISTRATION","REGISTRATION_CLOSED"].includes(tournamentState.status);
      if (!["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(registration.status)
        && !(registration.status === "PENDING" && draft?.editingSubmitted) && !lockedAdditionMode && !approvedAmendmentMode) throw new AppError(409, "Danh sách cầu thủ đã được gửi cho BTC và đang khóa", "REGISTRATION_ROSTER_SNAPSHOT_LOCKED");
      if (lockedAdditionMode && status === "ACCEPTED") {
        const eligibility = await getLockedRosterAdditionEligibility(before.tournament_id,[before.player_id]);
        if (!eligibility.eligible || (eligibility.alreadyAppearedPlayerIds ?? []).length) throw new AppError(409,eligibility.reason ?? "Không còn đủ điều kiện bổ sung cầu thủ","LOCKED_ROSTER_ADDITION_NOT_ALLOWED");
      }
      } catch (error) {
        if (error instanceof AppError && error.code !== "REGISTRATION_NOT_FOUND") throw error;
      }
      if (status === "ACCEPTED") {
        try {
          await reserveTournamentInvitationParticipation({ invitationId: before.id, tournamentId: before.tournament_id, teamId: before.team_id, playerId: before.player_id });
        } catch (error) {
          if (error instanceof AppError && error.code === "PLAYER_TOURNAMENT_DATE_CONFLICT") {
            const conflicts = error.details?.conflictingTournaments;
            const firstConflict = Array.isArray(conflicts) && conflicts[0] && typeof conflicts[0] === "object"
              ? conflicts[0] as { tournament_id?: unknown; tournament_name?: unknown }
              : null;
            await markTournamentInvitationInvalidated(
              before.id,
              requireUserId(req),
              error.message,
              typeof firstConflict?.tournament_id === "string" ? firstConflict.tournament_id : undefined,
              typeof firstConflict?.tournament_name === "string" ? firstConflict.tournament_name : undefined,
            );
          }
          throw error;
        }
      }
      let invitation: Awaited<ReturnType<typeof respondToTournamentInvitation>>;
      try {
        invitation = await respondToTournamentInvitation(req.params.id, requireUserId(req), status);
      } catch (error) {
        if (status === "ACCEPTED") {
          try { await releaseTournamentInvitationParticipation(before.id); }
          catch (releaseError) {
            console.error("[organization-service] failed to compensate tournament invitation claim", {
              invitationId: before.id,
              error: releaseError instanceof Error ? releaseError.message : "UNKNOWN",
            });
          }
        }
        throw error;
      }
      if (!invitation) {
        const current = await getInvitationWithCaptain(req.params.id);
        if (status === "ACCEPTED" && current?.status === "ACCEPTED") {
          res.json({ invitation: current, conflictedInvitations: [] });
          return;
        }
        if (status === "ACCEPTED") await releaseTournamentInvitationParticipation(req.params.id);
        throw new AppError(409, "Invitation is no longer awaiting your response or has expired", "INVITATION_NOT_RESPONDABLE");
      }
      const teamInfo = await getInvitationWithCaptain(invitation.id);
      if (teamInfo) {
        try {
          await queueOrganizationNotifications([{
            userId: teamInfo.captain_id,
            type: "TOURNAMENT_INVITATION",
            title: status === "ACCEPTED" ? "Cầu thủ đã xác nhận lời mời" : "Cầu thủ đã từ chối lời mời",
            body: `Trạng thái lời mời tham gia giải đã được cập nhật.`,
            data: { invitationId: invitation.id, status },
            idempotencyKey: `invitation-response:${invitation.id}:${status}`,
          }]);
        } catch (error) { console.error("[organization-service] could not queue captain notification", error); }
      }
      res.json({ invitation, invalidatedInvitations: invitation.invalidatedInvitations ?? [] });
    } catch (error) { next(error); }
  },

  async requestPlayerWithdrawal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const invitation = await getInvitationWithCaptain(req.params.id);
      if (!invitation || invitation.player_user_id !== requireUserId(req)) throw new AppError(404, "Invitation not found", "INVITATION_NOT_FOUND");
      await assertTournamentRosterEditable(invitation.tournament_id);
      const request = await createPlayerTournamentWithdrawalRequest({
        invitationId: invitation.id, playerUserId: requireUserId(req), reason: typeof req.body?.reason === "string" ? req.body.reason : "",
      });
      await queueOrganizationNotifications([{
        userId: invitation.captain_id, type: "TOURNAMENT_INVITATION", title: "Cầu thủ yêu cầu rút xác nhận",
        body: `Cầu thủ ${invitation.player_name ?? "trong roster"} đã gửi yêu cầu rút xác nhận. Yêu cầu đang chờ đội trưởng xử lý.`,
        data: { withdrawalRequestId: request.id, invitationId: invitation.id, teamId: invitation.team_id, tournamentId: invitation.tournament_id },
        idempotencyKey: `player-withdrawal:${request.id}:captain`,
      }]);
      res.status(201).json({ withdrawalRequest: request });
    } catch (error) { next(error); }
  },

  async listMyPlayerWithdrawals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json({ withdrawalRequests: await listPlayerTournamentWithdrawalRequestsForPlayer(requireUserId(req)) }); }
    catch (error) { next(error); }
  },

  async listTeamPlayerWithdrawals(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTeam(req, req.params.teamId);
      res.json({ withdrawalRequests: await listPlayerTournamentWithdrawalRequestsForTeam(req.params.teamId, req.params.tournamentId) });
    } catch (error) { next(error); }
  },

  async decidePlayerWithdrawal(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const request = await getPlayerTournamentWithdrawalRequest(req.params.requestId);
      if (!request?.teamId || !request.tournamentId) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
      await assertCanManageTeam(req, request.teamId);
      const decision = req.body?.decision;
      if (decision !== "APPROVED" && decision !== "REJECTED") throw new AppError(400, "decision must be APPROVED or REJECTED", "VALIDATION_ERROR");
      if (decision === "APPROVED" && request.status !== "APPROVED") await assertTournamentRosterEditable(request.tournamentId);
      const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
      if (decision === "REJECTED" && note.length < 5) throw new AppError(400, "Nêu lý do khi từ chối yêu cầu rút", "DECISION_NOTE_REQUIRED");
      const registration = await getTeamRegistration(request.teamId, request.tournamentId).catch((error) => {
        if (error instanceof AppError && error.code === "REGISTRATION_NOT_FOUND") return null;
        throw error;
      });
      if (decision === "APPROVED" && registration && !["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(registration.status)) {
        throw new AppError(409, "Hồ sơ đã được BTC duyệt hoặc roster đã khóa; yêu cầu rút tự nguyện không thể được chấp thuận.", "PLAYER_WITHDRAWAL_NOT_ALLOWED");
      }
      const claimed = await beginPlayerTournamentWithdrawalDecision({ id: request.id, decision, actorId: requireUserId(req), note });
      let withdrawalRequest;
      try { withdrawalRequest = await completePlayerTournamentWithdrawalDecision(claimed.id, decision, requireUserId(req), note); }
      catch (error) {
        await releasePlayerTournamentWithdrawalDecision(claimed.id, decision);
        throw error;
      }
      if (decision === "APPROVED") await releaseTournamentInvitationParticipation(request.invitationId);
      if (decision === "APPROVED" && registration) {
        const [updatedRegistration, acceptedInvitations] = await Promise.all([
          getTeamRegistration(request.teamId, request.tournamentId),
          listAcceptedTournamentInvitations(request.teamId, request.tournamentId),
        ]);
        await syncTournamentRegistrationReservation(
          registration.id,
          "PENDING",
          true,
          { tournamentId: updatedRegistration.tournamentId, teamId: updatedRegistration.teamId, institutionId: updatedRegistration.institutionId },
          acceptedInvitations.map((invitation) => invitation.player_id),
        );
      }
      await queueOrganizationNotifications([{
        userId: request.playerUserId, type: "TOURNAMENT_INVITATION",
        title: decision === "APPROVED" ? "Yêu cầu rút xác nhận đã được chấp nhận" : "Yêu cầu rút xác nhận đã bị từ chối",
        body: decision === "APPROVED" ? `Đội trưởng đã chấp nhận yêu cầu rút. ${note}`.trim() : `Đội trưởng đã từ chối yêu cầu rút. ${note}`,
        data: { withdrawalRequestId: request.id, invitationId: request.invitationId, status: decision, note },
        idempotencyKey: `player-withdrawal:${request.id}:${decision}`,
      }]);
      res.json({ withdrawalRequest });
    } catch (error) { next(error); }
  },

  async captainAction(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await assertCanManageTeam(req, req.params.teamId);
      if (req.params.action !== "cancel" && req.params.action !== "remind") throw new AppError(400, "Unsupported invitation action", "INVALID_INVITATION_ACTION");
      try {
        const registration = await getTeamRegistration(req.params.teamId, req.params.tournamentId);
      const draft = await getTournamentRegistrationDraft(req.params.teamId, req.params.tournamentId);
      if (!["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(registration.status)
        && !(registration.status === "PENDING" && draft?.editingSubmitted)) throw new AppError(409, "Danh sách lời mời đã được chốt trong hồ sơ gửi BTC", "REGISTRATION_ROSTER_SNAPSHOT_LOCKED");
      } catch (error) {
        if (error instanceof AppError && error.code !== "REGISTRATION_NOT_FOUND") throw error;
      }
      const action = req.params.action === "cancel" ? "CANCELLED" : "REMIND";
      if (action === "CANCELLED") {
        const current = await getInvitationWithCaptain(req.params.id);
        if (current?.status === "ACCEPTED") throw new AppError(409, "Cầu thủ đã xác nhận; hãy dùng quy trình yêu cầu rút và quyết định của đội trưởng", "ACCEPTED_INVITATION_WITHDRAWAL_REQUIRED");
      }
      const invitation = await updateInvitationForCaptain(req.params.id, req.params.teamId, action);
      if (!invitation) throw new AppError(409, "Lời mời không còn ở trạng thái có thể thực hiện thao tác này", "INVITATION_NOT_ACTIONABLE");
      if (action === "CANCELLED" && invitation.status === "CANCELLED") await releaseTournamentInvitationParticipation(invitation.id);
      const team = await getTeam(req.params.teamId);
      await queueOrganizationNotifications([{
        userId: invitation.player_user_id,
        type: "TOURNAMENT_INVITATION",
        title: action === "CANCELLED" ? "Lời mời tham gia giải đã được thu hồi" : `Nhắc phản hồi lời mời từ ${team.name}`,
        body: action === "CANCELLED" ? "Đội trưởng đã thu hồi lời mời." : "Đội trưởng nhắc bạn phản hồi lời mời tham gia giải.",
        data: { invitationId: invitation.id, status: invitation.status },
      }]);
      res.json({ invitation });
    } catch (error) { next(error); }
  },
};
