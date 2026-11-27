import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { assertCanManageMatch, assertCanManageTournament } from "../scheduling/authorization";
import { getEffectiveMatchRules, listRuleBindingCandidates, applyOperationRuleVersion } from "../services/matchOperationRulesService";
import { AppError } from "../lib/errors";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const matchOperationRulesController = {
  async get(req: AuthenticatedRequest,res: Response,next: NextFunction) { try {
    if (!uuid.test(req.params.matchId)) throw new AppError(400,"Mã trận không hợp lệ.","VALIDATION_ERROR");
    await assertCanManageMatch(req,req.params.matchId); res.json({ rules: await getEffectiveMatchRules(req.params.matchId) });
  } catch(e) { next(e); } },
  async candidates(req: AuthenticatedRequest,res: Response,next: NextFunction) { try {
    await assertCanManageTournament(req,req.params.tournamentId); res.json({ matches: await listRuleBindingCandidates(req.params.tournamentId) });
  } catch(e) { next(e); } },
  async apply(req: AuthenticatedRequest,res: Response,next: NextFunction) { try {
    await assertCanManageTournament(req,req.params.tournamentId);
    const { supplementId,matches,reason } = req.body;
    if (!uuid.test(supplementId ?? "") || !Array.isArray(matches) || !matches.length || matches.length>1000 ||
        matches.some(m => !m || !uuid.test(m.matchId) || !Number.isInteger(m.expectedBindingRevision) || m.expectedBindingRevision<0) ||
        new Set(matches.map(m=>m.matchId)).size!==matches.length || typeof reason!=="string" || !reason.trim() || reason.length>4000) throw new AppError(400,"Cần phiên bản, danh sách trận không trùng, phiên bản từng trận và lý do áp dụng hợp lệ.","VALIDATION_ERROR");
    res.json(await applyOperationRuleVersion({ tournamentId:req.params.tournamentId,supplementId,matches,reason:reason.trim(),actorId:req.userId!,confirmLegacyBaseVersion:req.body.confirmLegacyBaseVersion === true }));
  } catch(e) { next(e); } },
};
