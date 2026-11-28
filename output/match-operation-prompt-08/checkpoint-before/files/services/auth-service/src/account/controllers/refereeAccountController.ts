import type { Request, Response, NextFunction } from "express";
import { getRefereeAccountService, parseRefereeScope } from "../services/refereeAccountService";

export const refereeAccountController = {
  async lookup(req: Request, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAccountService().lookup(req.query.email, parseRefereeScope(req.query))); } catch (error) { next(error); }
  },
  async resolve(req: Request, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAccountService().resolve(req.body)); } catch (error) { next(error); }
  },
  async ensure(req: Request, res: Response, next: NextFunction) {
    try { const result = await getRefereeAccountService().ensure(req.body); res.status(result.created ? 201 : 200).json(result); } catch (error) { next(error); }
  },
  async sendAccess(req: Request, res: Response, next: NextFunction) {
    try { res.json(await getRefereeAccountService().sendAccess(req.params.userId, req.body)); } catch (error) { next(error); }
  },
};
