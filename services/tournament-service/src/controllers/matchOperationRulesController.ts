import type { NextFunction, Request, Response } from "express";
import { validateMatchOperationRules, resolveMatchOperationRules } from "@sfl/shared";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { findTournamentById } from "../repositories/tournamentRepository";
import { createOperationRuleVersion, listOperationRuleVersions, publishOperationRuleVersion, readMatchRulesSource } from "../repositories/matchOperationRulesRepository";
import { AppError } from "../lib/errors";
import { hasTournamentAssignment } from "../repositories/organizerRepository";

function integer(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 0) throw new AppError(400, "Phiên bản phải là số nguyên không âm.", "VALIDATION_ERROR"); return value as number; }
function id(value: unknown): string { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) throw new AppError(400, "Định danh không hợp lệ.", "VALIDATION_ERROR"); return value; }
export const matchOperationRulesController = {
  async governance(req:Request,res:Response,next:NextFunction){
    try{const tournament=await findTournamentById(id(req.params.tournamentId));if(!tournament)throw new AppError(404,'Không tìm thấy giải.','TOURNAMENT_NOT_FOUND');
      const version=(await listOperationRuleVersions(tournament.id)).find(v=>v.status==='PUBLISHED'&&v.baseRegulationVersion===tournament.rules?.publishedVersion);
      res.json({governance:{tournamentId:tournament.id,status:tournament.status,baseRegulationVersion:tournament.rules?.publishedVersion??null,supplementId:version?.id??null,values:version?.rules.values??{}}});
    }catch(e){next(e);}
  },
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tournamentId = id(req.params.tournamentId), tournament = await findTournamentById(tournamentId);
      const manager = Boolean(req.userId && req.userRoles?.includes("BTC") && (tournament?.createdBy === req.userId || await hasTournamentAssignment(tournamentId, req.userId)));
      const versions = await listOperationRuleVersions(tournamentId);
      res.json({ versions: manager ? versions : versions.filter(v => v.status === "PUBLISHED") });
    } catch (e) { next(e); }
  },
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tournamentId = id(req.params.tournamentId), tournament = await findTournamentById(tournamentId);
      if (!tournament) throw new AppError(404, "Không tìm thấy giải.", "TOURNAMENT_NOT_FOUND");
      const checked = validateMatchOperationRules(req.body.rules, tournament.footballFormat);
      const baseRegulationVersion = integer(req.body.baseRegulationVersion);
      if (baseRegulationVersion !== tournament.rules?.publishedVersion || !tournament.rules?.publishedAt) checked.errors.push("Chỉ bổ sung cho phiên bản điều lệ hiện đang được công bố.");
      const v = checked.rules.values, duration = tournament.rules?.matchDurationMinutes;
      if (typeof v.periodMinutes === "number" && typeof v.periods === "number" && duration !== v.periodMinutes * v.periods) checked.errors.push("Thời lượng hiệp phải khớp tổng thời lượng đã công bố. Thay đổi tổng thời lượng cần quy trình sửa điều lệ riêng.");
      if (checked.errors.length) throw new AppError(400, checked.errors.join(" "), "INVALID_OPERATION_RULES", { errors: checked.errors });
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if (!reason || reason.length > 4000) throw new AppError(400, "Cần lý do bổ sung không quá 4.000 ký tự.", "VALIDATION_ERROR");
      const baseSnapshot = { regulationVersion: baseRegulationVersion, footballFormat: tournament.footballFormat, competitionFormat: tournament.competitionFormat,
        rankingCriteria: tournament.rankingCriteria ?? [], rules: { ...tournament.rules! } };
      const version = await createOperationRuleVersion({ tournamentId, baseRegulationVersion, expectedRevision: integer(req.body.expectedRevision), rules: checked.rules, baseSnapshot, reason, actorId: req.userId! });
      res.status(201).json({ version });
    } catch (e) { next(e); }
  },
  async publish(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try { res.json({ version: await publishOperationRuleVersion(id(req.params.tournamentId), integer(Number(req.params.revision)), integer(req.body.expectedRevision), req.userId!) }); } catch (e) { next(e); }
  },
  async source(req: Request, res: Response, next: NextFunction) {
    try {
      const source = await readMatchRulesSource(id(req.params.tournamentId), id(req.query.drawVersionId), req.query.supplementId ? id(req.query.supplementId) : null);
      // Shared resolver is also used by Match Service and the regulation UI.
      res.json({ ...source, readiness: resolveMatchOperationRules(source.base, source.supplement, null).missing });
    } catch (e) { next(e); }
  },
};
