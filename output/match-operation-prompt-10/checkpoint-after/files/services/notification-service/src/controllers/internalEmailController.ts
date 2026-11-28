import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import { EmailDeliveryService } from "../services/emailDeliveryService";

export class InternalEmailController {
  constructor(private readonly emailDeliveryService: EmailDeliveryService) {}

  async sendRefereeAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body ?? {}, strings = ["eventKey", "email", "fullName", "tournamentId", "tournamentName", "matchId", "matchLabel", "position", "scheduledAt", "venueName", "location"];
      if (strings.some((key) => typeof body[key] !== "string" || body[key].length > (key === "matchLabel" || key === "location" ? 1000 : 255)) ||
        !/^[a-zA-Z0-9:_-]{10,255}$/.test(body.eventKey) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || /[\r\n]/.test(body.email) ||
        !body.fullName.trim() || !body.tournamentName.trim() || !body.position.trim() || !Number.isFinite(Date.parse(body.scheduledAt)) ||
        !["PUBLISHED", "REPLACED_IN", "REPLACED_OUT"].includes(body.kind) || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 1000))) {
        throw new AppError(400, "Invalid referee assignment email", "VALIDATION_ERROR");
      }
      res.json(await this.emailDeliveryService.sendRefereeAssignmentEmail(Object.fromEntries([...strings, "kind", ...(body.reason === undefined ? [] : ["reason"])].map((key) => [key, body[key]])) as unknown as import("../services/emailDeliveryService").RefereeAssignmentEmailInput));
    } catch (error) { next(error); }
  }

  async sendRefereeTeamAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { eventKey, accessType, token } = req.body ?? {};
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
      const tournamentName = typeof req.body?.tournamentName === "string" ? req.body.tournamentName.trim() : "";
      if (typeof eventKey !== "string" || !/^[a-zA-Z0-9:_-]{10,255}$/.test(eventKey) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
          !fullName || fullName.length > 255 || !tournamentName || tournamentName.length > 255 ||
          !["login", "account_activation", "verification"].includes(accessType) ||
          (accessType !== "login" && (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token))) ||
          (accessType === "login" && token !== undefined)) {
        throw new AppError(400, "Invalid referee access email", "VALIDATION_ERROR");
      }
      res.json(await this.emailDeliveryService.sendRefereeTeamAccessEmail({ eventKey, email, fullName, tournamentName, accessType, token }));
    } catch (error) { next(error); }
  }

  async sendAccountEmail(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const type = req.body?.type;
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const staffRole = req.body?.staffRole;

      if (
        type !== "verification" &&
        type !== "password_reset" &&
        type !== "account_activation" &&
        type !== "email_change"
      ) {
        throw new AppError(400, "Unsupported email type", "VALIDATION_ERROR");
      }
      if (
        (type === "account_activation" &&
          staffRole !== "BTC" &&
          staffRole !== "REFEREE") ||
        (type !== "account_activation" && staffRole !== undefined)
      ) {
        throw new AppError(400, "Invalid account role", "VALIDATION_ERROR");
      }
      if (
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^[a-f0-9]{64}$/i.test(token)
      ) {
        throw new AppError(400, "Invalid email request", "VALIDATION_ERROR");
      }

      await this.emailDeliveryService.sendAccountEmail(
        type,
        email,
        token,
        type === "account_activation" ? staffRole : undefined,
      );
      res.status(202).json({ status: "accepted" });
    } catch (error) {
      next(error);
    }
  }

  async sendTournamentInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
      const teamName = typeof req.body?.teamName === "string" ? req.body.teamName.trim() : "";
      const tournamentName = typeof req.body?.tournamentName === "string" ? req.body.tournamentName.trim() : "";
      const invitationId = typeof req.body?.invitationId === "string" ? req.body.invitationId : "";
      const expiresAt = typeof req.body?.expiresAt === "string" ? req.body.expiresAt : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
          !fullName || fullName.length > 255 || !teamName || teamName.length > 255 ||
          !tournamentName || tournamentName.length > 255 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId) ||
          !Number.isFinite(Date.parse(expiresAt))) {
        throw new AppError(400, "Invalid tournament invitation email", "VALIDATION_ERROR");
      }
      await this.emailDeliveryService.sendTournamentInvitationEmail({ email, fullName, teamName, tournamentName, invitationId, expiresAt });
      res.status(202).json({ status: "accepted" });
    } catch (error) {
      next(error);
    }
  }
}
