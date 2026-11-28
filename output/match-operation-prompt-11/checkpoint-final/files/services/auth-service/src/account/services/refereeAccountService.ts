import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { config } from "../../config";
import { AppError } from "../lib/errors";
import { findUserById } from "../repositories/userRepository";
import { RefereeAccountRepository, assertRefereeAccountAvailable } from "../repositories/refereeAccountRepository";
import { sendRefereeTeamAccountAccess } from "../../services/authService";
import type { RefereeAccountEnsureInput, RefereeAccountScope, RefereeAccessEmailInput } from "../models/refereeAccount";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRefereeEmail(value: unknown): string {
  if (typeof value !== "string" || value.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new AppError(400, "A valid email address is required", "VALIDATION_ERROR");
  return value.trim().toLowerCase();
}

export function parseRefereeScope(value: unknown): RefereeAccountScope {
  const input = value as Partial<RefereeAccountScope> | null;
  if (!input || typeof input.actorUserId !== "string" || !uuid.test(input.actorUserId) || typeof input.tournamentId !== "string" || !uuid.test(input.tournamentId)) throw new AppError(400, "actorUserId and tournamentId are required", "VALIDATION_ERROR");
  return { actorUserId: input.actorUserId, tournamentId: input.tournamentId };
}

export function parseRefereeEnsureInput(value: unknown): RefereeAccountEnsureInput {
  const scope = parseRefereeScope(value);
  const input = value as Record<string, unknown>;
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : undefined;
  if (input.fullName !== undefined && (!fullName || fullName.length > 255)) throw new AppError(400, "A valid full name is required", "VALIDATION_ERROR");
  const phone = input.phone === null ? null : typeof input.phone === "string" ? input.phone.trim() : undefined;
  if (input.phone !== undefined && input.phone !== null && (typeof phone !== "string" || !/^[0-9+().\s-]{7,30}$/.test(phone))) throw new AppError(400, "A valid phone number is required", "VALIDATION_ERROR");
  if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9:._-]{8,128}$/.test(input.idempotencyKey)) throw new AppError(400, "A valid idempotencyKey is required", "VALIDATION_ERROR");
  return { ...scope, email: normalizeRefereeEmail(input.email), ...(fullName ? { fullName } : {}), ...(phone !== undefined ? { phone } : {}), idempotencyKey: input.idempotencyKey };
}

export class RefereeAccountService {
  constructor(
    private readonly repository = new RefereeAccountRepository(),
    private readonly dependencies = { findUserById, fetch: globalThis.fetch, sendAccess: sendRefereeTeamAccountAccess, makePasswordHash: async () => bcrypt.hash(randomBytes(48).toString("hex"), 10) },
  ) {}

  async assertManager(scope: RefereeAccountScope): Promise<void> {
    const actor = await this.dependencies.findUserById(scope.actorUserId);
    if (!actor || !actor.isActive || !actor.emailVerified || actor.accountStatus !== "ACTIVE" || !actor.roles.includes("BTC")) throw new AppError(403, "An active verified tournament organizer is required", "FORBIDDEN");
    if (!config.internalApiKey) throw new AppError(503, "Tournament authorization is not configured", "SERVICE_MISCONFIGURED");
    let response: Response;
    try {
      response = await this.dependencies.fetch(new URL(`/internal/tournaments/${encodeURIComponent(scope.tournamentId)}/manager-access`, config.tournamentServiceUrl), {
        headers: { "x-gateway-internal-key": config.internalApiKey, "x-user-id": actor.id, "x-user-roles": actor.roles.join(",") }, signal: AbortSignal.timeout(5_000),
      });
    } catch { throw new AppError(503, "Tournament authorization is unavailable", "UPSTREAM_UNAVAILABLE"); }
    if (response.status === 403 || response.status === 404) throw new AppError(403, "You do not manage this tournament", "FORBIDDEN");
    if (response.status !== 204) throw new AppError(502, "Tournament authorization could not be verified", "UPSTREAM_ERROR");
  }

  async lookup(email: unknown, scope: RefereeAccountScope) {
    await this.assertManager(scope);
    return { account: await this.repository.findByEmail(normalizeRefereeEmail(email)) };
  }

  async resolve(value: unknown) {
    const scope = parseRefereeScope(value);
    await this.assertManager(scope);
    const input = value as { userIds?: unknown };
    if (!Array.isArray(input.userIds) || input.userIds.length > 500 || input.userIds.some(id => typeof id !== "string" || !uuid.test(id))) throw new AppError(400, "A valid list of user IDs is required", "VALIDATION_ERROR");
    const userIds = [...new Set(input.userIds)] as string[];
    const users = await this.repository.resolve(userIds);
    const found = new Set(users.map(user => user.userId));
    return { users, missingUserIds: userIds.filter(id => !found.has(id)) };
  }

  async ensure(value: unknown) {
    const input = parseRefereeEnsureInput(value);
    await this.assertManager(input);
    // Password is generated only inside Auth; it is neither chosen by BTC nor
    // returned. The recipient sets the actual password through activation.
    return this.repository.ensure(input, await this.dependencies.makePasswordHash());
  }

  async sendAccess(userId: string, value: unknown) {
    const scope = parseRefereeScope(value);
    await this.assertManager(scope);
    const input = value as { tournamentName?: unknown; eventKey?: unknown };
    if (!uuid.test(userId) || typeof input.tournamentName !== "string" || !input.tournamentName.trim() || input.tournamentName.trim().length > 255 || typeof input.eventKey !== "string" || !/^[A-Za-z0-9:._-]{8,255}$/.test(input.eventKey)) throw new AppError(400, "Valid account, tournament name and event key are required", "VALIDATION_ERROR");
    const account = (await this.repository.resolve([userId]))[0];
    if (!account || !account.roles.includes("REFEREE")) throw new AppError(404, "Referee account not found", "ACCOUNT_NOT_FOUND");
    assertRefereeAccountAvailable(account);
    const request: RefereeAccessEmailInput = { ...scope, userId, tournamentName: input.tournamentName.trim(), eventKey: input.eventKey };
    const reservation = await this.repository.reserveDelivery(request);
    if (!reservation.reserved) return reservation.delivery;
    let delivery;
    try { delivery = await this.repository.withAccessDispatchLock(userId, () => this.dependencies.sendAccess({ userId, tournamentName: request.tournamentName, eventKey: request.eventKey })); }
    catch (error) {
      const knownFailure = error instanceof AppError && ["REFEREE_ACCOUNT_UNAVAILABLE", "EMAIL_DELIVERY_FAILED", "EMAIL_DELIVERY_NOT_CONFIGURED", "SERVICE_MISCONFIGURED"].includes(error.code ?? "");
      delivery = knownFailure ? { status: "FAILED" as const, errorCode: error.code } : { status: "PENDING" as const, errorCode: "EMAIL_STATUS_UNCERTAIN" };
    }
    await this.repository.completeDelivery(request.eventKey, delivery);
    return delivery;
  }
}

let instance: RefereeAccountService | undefined;
export function getRefereeAccountService(): RefereeAccountService { return instance ??= new RefereeAccountService(); }
