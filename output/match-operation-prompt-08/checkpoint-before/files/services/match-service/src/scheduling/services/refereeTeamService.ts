import { config } from "../../config";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { assertCanManageTournament } from "../authorization";
import type { RefereeAccount, RefereeAccessEmail, RefereeTeamMemberRecord } from "../models/refereeTeam";
import {
  addRefereeTeamMember, claimRefereeAccessEmailEvent, createRefereeAccessEmailEvent,
  findRefereeTeamMember, findRefereeAccessEmailEvent, finishRefereeAccessEmailEvent, listRefereeTeamMembers,
  markRefereeMemberNotification, updateRefereeTeamProfile,
} from "../repositories/refereeTeamRepository";
import { getOfficialScheduleContext, getTournamentScheduleSettings } from "./schedulingService";
import { parseAddRefereeTeamInput, parseRefereeEmail, parseRefereeProfilePatch, parseRefereeRequestId, parseRefereeResendInput } from "./refereeTeamValidation";

type Actor = AuthenticatedRequest;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const errorCode = (value: unknown, fallback: string) => typeof value === "string" && /^[A-Z0-9_]{1,100}$/.test(value) ? value : fallback;

async function authorize(actor: Actor, tournamentId: string) {
  parseRefereeRequestId(tournamentId);
  await assertCanManageTournament(actor, tournamentId);
  const tournament = await getTournamentScheduleSettings(tournamentId);
  let published = false;
  try { published = Boolean((await getOfficialScheduleContext(tournamentId)).schedulePublishedAt); }
  catch (error) {
    if (!(error instanceof AppError) || !["PUBLISHED_DRAW_REQUIRED", "PUBLISHED_FIXTURES_REQUIRED"].includes(error.code)) throw error;
  }
  const terminal = ["COMPLETED", "CANCELLED"].includes(tournament.status);
  return { tournament, readOnly: terminal || !published,
    readOnlyReason: terminal ? "Giải đấu đã kết thúc hoặc đã hủy; đội ngũ trọng tài chỉ được xem."
      : !published ? "Cần công bố đầy đủ lịch thi đấu ở Bước 5 trước khi quản lý đội ngũ trọng tài." : null };
}

function assertMutable(access: Awaited<ReturnType<typeof authorize>>) {
  if (access.readOnly) throw new AppError(409, access.readOnlyReason!, ["COMPLETED", "CANCELLED"].includes(access.tournament.status) ? "TOURNAMENT_READ_ONLY" : "PUBLISHED_SCHEDULE_REQUIRED");
}

async function authRequest(actor: Actor, tournamentId: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!config.internalApiKey) throw new AppError(503, "Chưa cấu hình kết nối Auth Service.", "SERVICE_MISCONFIGURED");
  const url = new URL(path, config.authServiceUrl);
  const scope = { actorUserId: actor.userId!, tournamentId };
  if (!body) for (const [key, value] of Object.entries(scope)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { method: body ? "POST" : "GET", headers: { "x-gateway-internal-key": config.internalApiKey, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify({ ...body, ...scope }) } : {}), signal: AbortSignal.timeout(20_000) });
  } catch { throw new AppError(503, "Không thể kết nối Auth Service.", "AUTH_SERVICE_UNAVAILABLE"); }
  let result: unknown;
  try { result = await response.json(); } catch { throw new AppError(502, "Phản hồi Auth Service không hợp lệ.", "AUTH_SERVICE_INVALID_RESPONSE"); }
  if (!response.ok) {
    const upstream = object(result) && object(result.error) ? result.error : {};
    const status = [400, 403, 404, 409].includes(response.status) ? response.status : 502;
    throw new AppError(status, typeof upstream.message === "string" ? upstream.message.slice(0, 500) : "Auth Service không thể xử lý yêu cầu.", errorCode(upstream.code, "AUTH_SERVICE_ERROR"));
  }
  if (!object(result)) throw new AppError(502, "Phản hồi Auth Service không hợp lệ.", "AUTH_SERVICE_INVALID_RESPONSE");
  return result;
}

function account(value: unknown): RefereeAccount {
  if (!object(value) || typeof value.userId !== "string" || typeof value.email !== "string" || typeof value.fullName !== "string"
    || !(value.phone === null || typeof value.phone === "string") || !["ACTIVE", "LOCKED", "DISABLED"].includes(String(value.accountStatus))
    || typeof value.isActive !== "boolean" || typeof value.emailVerified !== "boolean" || !Array.isArray(value.roles) || value.roles.some((role) => typeof role !== "string")) {
    throw new AppError(502, "Thông tin tài khoản từ Auth Service không hợp lệ.", "AUTH_SERVICE_INVALID_RESPONSE");
  }
  return value as RefereeAccount;
}

function memberView(member: RefereeTeamMemberRecord, canonical: RefereeAccount) {
  const { tournamentId: _tournamentId, ...record } = member;
  const { userId: _userId, ...identity } = canonical;
  return { ...record, identity };
}

async function resolveAccounts(actor: Actor, tournamentId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, RefereeAccount>();
  const result = await authRequest(actor, tournamentId, "/internal/referee-accounts/resolve", { userIds: [...new Set(userIds)] });
  if (!Array.isArray(result.users) || !Array.isArray(result.missingUserIds) || result.missingUserIds.length) throw new AppError(502, "Không thể xác minh đầy đủ tài khoản của đội ngũ trọng tài.", "REFEREE_ACCOUNTS_UNAVAILABLE");
  const users = new Map(result.users.map((value) => { const summary = account(value); return [summary.userId, summary] as const; }));
  if (userIds.some((id) => !users.has(id))) throw new AppError(502, "Auth Service thiếu tài khoản được yêu cầu.", "REFEREE_ACCOUNTS_UNAVAILABLE");
  return users;
}

async function requiredMember(tournamentId: string, memberId: string) {
  parseRefereeRequestId(memberId);
  const member = await findRefereeTeamMember(tournamentId, memberId);
  if (!member) throw new AppError(404, "Không tìm thấy trọng tài trong giải.", "REFEREE_TEAM_MEMBER_NOT_FOUND");
  return member;
}

async function notifyMembership(memberId: string, userId: string, tournamentId: string, tournamentName: string) {
  try {
    const response = await fetch(new URL("/internal/notifications", config.notificationServiceUrl), {
      method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": config.internalApiKey }, signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ userId, type: "SYSTEM", title: "Bạn đã được thêm vào đội ngũ trọng tài", body: `BTC đã thêm bạn vào đội ngũ trọng tài giải ${tournamentName}.`,
        data: { tournamentId, refereeTeamMemberId: memberId }, idempotencyKey: `referee-team-member:${memberId}` }),
    });
    if (!response.ok) throw new Error("notification failed");
    await markRefereeMemberNotification(memberId, "SENT", null);
  } catch { await markRefereeMemberNotification(memberId, "FAILED", "REFEREE_MEMBER_NOTIFICATION_FAILED"); }
}

/** Only explicit add/resend actions dispatch; listing or reloading a team never sends email. */
async function dispatchAccessEmail(actor: Actor, tournamentId: string, tournamentName: string, requestId: string) {
  const event = await claimRefereeAccessEmailEvent(tournamentId, requestId);
  if (!event) return;
  let outcome: { status: RefereeAccessEmail["status"]; sentAt?: string; errorCode?: string };
  try {
    const result = await authRequest(actor, tournamentId, `/internal/referee-accounts/${encodeURIComponent(event.userId)}/access-email`, { tournamentName, eventKey: event.eventKey });
    if (!["PENDING", "SENT", "FAILED"].includes(String(result.status))) throw new Error("invalid email delivery status");
    outcome = { status: result.status as RefereeAccessEmail["status"], ...(typeof result.sentAt === "string" && Number.isFinite(Date.parse(result.sentAt)) ? { sentAt: result.sentAt } : {}),
      ...(result.errorCode ? { errorCode: errorCode(result.errorCode, "REFEREE_ACCESS_EMAIL_FAILED") } : {}) };
  } catch {
    // A lost response may follow SMTP acceptance. Preserve uncertainty, never
    // silently create a new key or automatically send the same message again.
    outcome = { status: "PENDING", errorCode: "EMAIL_STATUS_UNCERTAIN" };
  }
  await finishRefereeAccessEmailEvent(event.id, outcome);
}

export async function getTournamentRefereeTeam(actor: Actor, tournamentId: string) {
  const access = await authorize(actor, tournamentId);
  const members = await listRefereeTeamMembers(tournamentId);
  const accounts = await resolveAccounts(actor, tournamentId, members.map((member) => member.userId));
  const assignedMembers = members.filter((member) => member.assignmentCount > 0).length;
  return { tournamentId, readOnly: access.readOnly, readOnlyReason: access.readOnlyReason,
    members: members.map((member) => memberView(member, accounts.get(member.userId)!)),
    stats: { totalMembers: members.length, assignedMembers, unassignedMembers: members.length - assignedMembers, totalAssignments: members.reduce((sum, member) => sum + member.assignmentCount, 0) } };
}

export async function lookupTournamentRefereeAccount(actor: Actor, tournamentId: string, emailValue: unknown) {
  await authorize(actor, tournamentId);
  const email = parseRefereeEmail(emailValue);
  const result = await authRequest(actor, tournamentId, `/internal/referee-accounts?email=${encodeURIComponent(email)}`);
  const canonical = result.account === null ? null : account(result.account);
  const members = canonical ? await listRefereeTeamMembers(tournamentId) : [];
  return { found: Boolean(canonical), account: canonical ? { ...canonical, hasRefereeRole: canonical.roles.includes("REFEREE") } : null,
    alreadyMember: Boolean(canonical && members.some((member) => member.userId === canonical.userId)) };
}

export async function createTournamentRefereeMember(actor: Actor, tournamentId: string, value: unknown) {
  const access = await authorize(actor, tournamentId);
  assertMutable(access);
  const input = parseAddRefereeTeamInput(value);
  const priorEvent = await findRefereeAccessEmailEvent(tournamentId, input.requestId);
  if (priorEvent) {
    if (priorEvent.operation !== "ADD" || priorEvent.requestedBy !== actor.userId) throw new AppError(409, "Mã thao tác đã được dùng cho yêu cầu khác.", "REFEREE_REQUEST_REUSED");
    const canonical = (await resolveAccounts(actor, tournamentId, [priorEvent.userId])).get(priorEvent.userId)!;
    if (canonical.email.toLowerCase() !== input.email) throw new AppError(409, "Mã thao tác đã được dùng cho yêu cầu khác.", "REFEREE_REQUEST_REUSED");
    await notifyMembership(priorEvent.memberId, canonical.userId, tournamentId, access.tournament.name);
    await dispatchAccessEmail(actor, tournamentId, access.tournament.name, input.requestId);
    return { member: memberView(await requiredMember(tournamentId, priorEvent.memberId), canonical), created: false };
  }
  const existingMembers = await listRefereeTeamMembers(tournamentId);
  if (existingMembers.length) {
    const lookup = await authRequest(actor, tournamentId, `/internal/referee-accounts?email=${encodeURIComponent(input.email)}`);
    if (lookup.account !== null && existingMembers.some((member) => member.userId === account(lookup.account).userId)) throw new AppError(409, "Trọng tài đã có trong đội ngũ của giải.", "REFEREE_ALREADY_IN_TEAM");
  }
  const result = await authRequest(actor, tournamentId, "/internal/referee-accounts", { email: input.email, fullName: input.fullName, phone: input.phone, idempotencyKey: `referee-team:${tournamentId}:${input.requestId}` });
  const canonical = account(result.account);
  if (canonical.email.toLowerCase() !== input.email || !canonical.roles.includes("REFEREE")) throw new AppError(502, "Auth Service chưa xác lập đúng tài khoản trọng tài.", "AUTH_SERVICE_INVALID_RESPONSE");
  const saved = await addRefereeTeamMember(tournamentId, canonical.userId, input.profile, actor.userId!, input.requestId);
  await notifyMembership(saved.memberId, canonical.userId, tournamentId, access.tournament.name);
  await dispatchAccessEmail(actor, tournamentId, access.tournament.name, input.requestId);
  return { member: memberView(await requiredMember(tournamentId, saved.memberId), canonical), created: saved.created };
}

export async function patchTournamentRefereeMember(actor: Actor, tournamentId: string, memberId: string, value: unknown) {
  const access = await authorize(actor, tournamentId);
  assertMutable(access);
  const member = await requiredMember(tournamentId, memberId);
  const profile = parseRefereeProfilePatch(value, member.profile);
  if (!await updateRefereeTeamProfile(tournamentId, memberId, profile)) throw new AppError(404, "Không tìm thấy trọng tài trong giải.", "REFEREE_TEAM_MEMBER_NOT_FOUND");
  const canonical = (await resolveAccounts(actor, tournamentId, [member.userId])).get(member.userId)!;
  return { member: memberView(await requiredMember(tournamentId, memberId), canonical) };
}

export async function resendTournamentRefereeAccess(actor: Actor, tournamentId: string, memberId: string, value: unknown) {
  const access = await authorize(actor, tournamentId);
  assertMutable(access);
  const member = await requiredMember(tournamentId, memberId);
  const requestId = parseRefereeResendInput(value);
  await createRefereeAccessEmailEvent(tournamentId, memberId, actor.userId!, requestId);
  await dispatchAccessEmail(actor, tournamentId, access.tournament.name, requestId);
  const canonical = (await resolveAccounts(actor, tournamentId, [member.userId])).get(member.userId)!;
  return { member: memberView(await requiredMember(tournamentId, memberId), canonical) };
}
