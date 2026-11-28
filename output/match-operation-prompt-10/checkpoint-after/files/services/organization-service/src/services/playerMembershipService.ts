import { AppError } from "../lib/errors";
import {
  createPlayerLeaveRequest,
  findPlayerLeaveRequest,
  getActiveTournamentIdsForLeaveRequest,
  listOverdueLeaveRequestsForReminders,
  listPlayerLeaveRequestsForUser,
  listTeamPlayerLeaveRequests,
  markLeaveRequestReminderSent,
  reviewPlayerLeaveRequest as saveLeaveRequestDecision,
  withdrawPlayerLeaveRequest,
} from "../repositories/membershipRequestRepository";
import { getTeam } from "./teamService";
import { sendMembershipNotification } from "./membershipNotificationService";
import { config } from "../config";

async function assertNoActiveTournamentRoster(requestId: string): Promise<void> {
  const tournamentIds = await getActiveTournamentIdsForLeaveRequest(requestId);
  for (const tournamentId of tournamentIds) {
    let response: Response;
    try {
      const endpoint = new URL(
        `/tournaments/${encodeURIComponent(tournamentId)}`,
        config.tournamentServiceUrl,
      );
      response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new AppError(503, "Tournament status could not be verified", "UPSTREAM_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new AppError(502, "Tournament status could not be verified", "UPSTREAM_ERROR");
    }
    const body = await response.json() as { tournament?: { status?: string } };
    const status = body.tournament?.status;
    if (!status) {
      throw new AppError(502, "Tournament service returned an invalid status", "UPSTREAM_ERROR");
    }
    if (!["COMPLETED", "CANCELLED"].includes(status)) {
      throw new AppError(
        409,
        "The player is on a roster for an active tournament; resolve tournament eligibility before approving departure",
        "ACTIVE_TOURNAMENT_ROSTER",
      );
    }
  }
}

export async function requestPlayerLeave(userId: string, reason: string) {
  const request = await createPlayerLeaveRequest(userId, reason);
  const team = await getTeam(request.teamId);
  await sendMembershipNotification({
    userId: team.captainId,
    title: "Yêu cầu rời đội mới",
    body: `${request.playerName} đã gửi yêu cầu rời ${request.teamName}.`,
    data: { teamId: request.teamId, requestId: request.id },
  });
  return request;
}

export async function getMyPlayerLeaveRequests(userId: string) {
  return listPlayerLeaveRequestsForUser(userId);
}

export async function getTeamPlayerLeaveRequests(teamId: string, overdueOnly = false) {
  return listTeamPlayerLeaveRequests(teamId, overdueOnly);
}

export async function reviewPlayerLeaveRequest(input: {
  requestId: string;
  reviewerId: string;
  decision: "APPROVED" | "REJECTED";
  decisionReason: string | null;
}) {
  const request = await findPlayerLeaveRequest(input.requestId);
  if (!request) {
    throw new AppError(404, "Leave request not found", "REQUEST_NOT_FOUND");
  }
  if (input.decision === "APPROVED") {
    await assertNoActiveTournamentRoster(input.requestId);
  }
  const updated = await saveLeaveRequestDecision(input);
  await sendMembershipNotification({
    userId: updated.userId,
    title: updated.status === "APPROVED" ? "Yêu cầu rời đội đã được duyệt" : "Yêu cầu rời đội bị từ chối",
    body: updated.status === "APPROVED"
      ? `Bạn đã rời ${updated.teamName}.`
      : `Yêu cầu rời ${updated.teamName} bị từ chối: ${updated.decisionReason ?? "Không có lý do."}`,
    data: { teamId: updated.teamId, requestId: updated.id, status: updated.status },
  });
  return updated;
}

export async function withdrawMyPlayerLeaveRequest(requestId: string, userId: string) {
  return withdrawPlayerLeaveRequest(requestId, userId);
}

export async function sendOverdueLeaveReminders(): Promise<void> {
  const requests = await listOverdueLeaveRequestsForReminders();
  for (const request of requests) {
    const team = await getTeam(request.teamId);
    await sendMembershipNotification({
      userId: team.captainId,
      title: "Yêu cầu rời đội đang chờ xử lý",
      body: `Yêu cầu của ${request.playerName} đã chờ hơn 3 ngày. Hãy xem xét hoặc chuyển Ban tổ chức xử lý.`,
      data: { teamId: request.teamId, requestId: request.id },
    });
    await markLeaveRequestReminderSent(request.id);
  }
}
