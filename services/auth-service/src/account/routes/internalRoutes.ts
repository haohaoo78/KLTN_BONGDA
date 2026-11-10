import { Router, type NextFunction, type Request, type Response } from "express";
import { findUserById, listBtcAssignedInstitutionIds, listUsers } from "../repositories/userRepository";
import { AppError } from "../lib/errors";
import { requireTrustedGateway } from "../middleware/gatewayUser";

const router = Router();

router.get(
  "/institutions/:institutionId/btc-accounts",
  requireTrustedGateway,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { institutionId } = req.params;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId)) {
        throw new AppError(400, "A valid institution ID is required", "VALIDATION_ERROR");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search.length > 100) {
        throw new AppError(400, "Search text is too long", "VALIDATION_ERROR");
      }
      const { items } = await listUsers(100, 0, {
        role: "BTC",
        status: "active",
        institutionId,
        search: search || undefined,
      });
      res.json({
        users: items.map((user) => ({
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          institutionId: user.institutionId,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/users/:id/organizational-access",
  requireTrustedGateway,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      const user = await findUserById(req.params.id);
      if (!user) {
        throw new AppError(404, "User not found", "NOT_FOUND");
      }
      res.json({
        userId: user.id,
        roles: user.roles,
        institutionId: user.institutionId,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/institutions/btc-assignments",
  requireTrustedGateway,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const institutionIds: unknown = req.body?.institutionIds;
      if (
        !Array.isArray(institutionIds) ||
        institutionIds.length > 500 ||
        institutionIds.some((id) =>
          typeof id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
        )
      ) {
        throw new AppError(400, "A valid list of institution IDs is required", "VALIDATION_ERROR");
      }
      const assignedInstitutionIds = await listBtcAssignedInstitutionIds(institutionIds);
      res.json({ assignedInstitutionIds });
    } catch (error) {
      next(error);
    }
  },
);

export const internalRoutes = router;
