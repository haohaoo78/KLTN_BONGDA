import type { IncomingMessage } from "node:http";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { ServiceName, type HealthResponse } from "@sfl/shared";
import { config } from "./config";
import { createCorsMiddleware } from "./middleware/cors";
import {
  attachSessionHeadersForProxy,
  optionalSessionMiddleware,
  sessionMiddleware,
  type AuthenticatedRequest,
} from "./middleware/session";

const app = express();

app.use(createCorsMiddleware(config.corsOrigins));

app.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    service: ServiceName.GATEWAY,
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.get("/", (_req, res) => {
  res.json({
    name: "Student Football League API Gateway",
    version: "0.1.0",
  });
});

function rewriteApiPath(
  _path: string,
  req: IncomingMessage & { originalUrl?: string; url?: string },
): string {
  const raw = req.originalUrl ?? req.url ?? "";
  const qIndex = raw.indexOf("?");
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const search = qIndex >= 0 ? raw.slice(qIndex) : "";
  const next = pathname.replace(/^\/api/, "") || "/";
  return `${next}${search}`;
}

function pathOf(req: IncomingMessage & { originalUrl?: string; url?: string }): string {
  const raw = req.originalUrl ?? req.url ?? "";
  return raw.split("?")[0] ?? "";
}

function resolveTarget(req: IncomingMessage): string {
  const rest = pathOf(req).replace(/^\/api/, "") || "/";

  if (rest.startsWith("/auth")) return config.authServiceUrl;
  if (rest.startsWith("/users")) return config.authServiceUrl;
  if (rest.startsWith("/public/teams")) return config.organizationServiceUrl;
  if (rest.startsWith("/notifications")) return config.notificationServiceUrl;
  if (rest.startsWith("/my/tournaments")) return config.tournamentServiceUrl;
  if (rest.startsWith("/my/schedules")) return config.matchServiceUrl;
  if(/^\/tournaments\/[^/]+\/operations\/(?:start|complete)\/?$/.test(rest)) return config.tournamentServiceUrl;
  if (/^\/players\/[^/]+\/tournaments\/[^/]+\/suspension\/?$/.test(rest)) {
    return config.matchServiceUrl;
  }

  const nested = rest.match(/^\/tournaments\/[^/]+\/([^/?]+)/);
  if (nested) {
    const seg = nested[1];
    if (seg === "matches" || seg === "fixtures" || seg === "bracket" || seg === "standings" || seg === "statistics" || seg === "cards" || seg === "operations" || seg === "forfeit-decisions" || seg === "complaint-appeals" || seg === "result-correction-requests" ||
      seg === "suspensions" || seg === "complaints" || seg === "schedules" || seg === "scheduling-resources" || seg === "referee-team" || seg === "knockout-stage") {
      return config.matchServiceUrl;
    }
    if (seg === "registrations" || seg === "registration-review-summary" || seg === "registration-change-requests" || seg === "rosters" || seg === "withdrawal-requests") return config.organizationServiceUrl;
  }

  if (
    rest.startsWith("/tournaments") ||
    rest.startsWith("/seasons") ||
    rest.startsWith("/regulation-versions") ||
    rest.startsWith("/groups") ||
    rest.startsWith("/draws") ||
    rest.startsWith("/regulations") ||
    rest.startsWith("/registration-periods")
  ) {
    return config.tournamentServiceUrl;
  }

  if (
    rest.startsWith("/teams") ||
    rest.startsWith("/players") ||
    rest.startsWith("/registrations") ||
    rest.startsWith("/registration-change-requests") ||
    rest.startsWith("/approval-reviews") ||
    rest.startsWith("/withdrawal-requests") ||
    rest.startsWith("/institutions") ||
    rest.startsWith("/rosters") ||
    rest.startsWith("/tournament-invitations") ||
    rest.startsWith("/player-withdrawal-requests") ||
    rest.startsWith("/player-requests") ||
    rest.startsWith("/player-leave-requests") ||
    rest.startsWith("/club-requests")
  ) {
    return config.organizationServiceUrl;
  }

  if (
    rest.startsWith("/matches") ||
    rest.startsWith("/match-results") ||
    rest.startsWith("/result-correction-requests") ||
    rest.startsWith("/pause-requests") ||
    rest.startsWith("/lineups") ||
    rest.startsWith("/match-events") ||
    rest.startsWith("/match-reports")
  ) {
    return config.matchServiceUrl;
  }

  if (
    rest.startsWith("/venues") ||
    rest.startsWith("/schedules") ||
    rest.startsWith("/venue-availability")
  ) {
    return config.matchServiceUrl;
  }

  if (
    rest.startsWith("/cards") ||
    rest.startsWith("/suspensions") ||
    rest.startsWith("/complaints") ||
    rest.startsWith("/disciplinary-decisions")
  ) {
    return config.matchServiceUrl;
  }

  return config.authServiceUrl;
}

function apiSession(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const path = req.originalUrl.split("?")[0] ?? "";
  if (
    path.startsWith("/api/institutions") &&
    (req.method !== "GET" || !/^\/api\/institutions\/?$/.test(path))
  ) {
    sessionMiddleware(req, res, next);
    return;
  }
  if (path.startsWith("/api/auth")) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  if (
    req.method === "GET" &&
    /^\/api\/players\/[^/]+\/tournaments\/[^/]+\/suspension\/?$/.test(path)
  ) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  if (
    req.method === "GET" &&
    /^\/api\/schedules\/test-workflow\/[^/]+\/public\/?$/.test(path)
  ) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  if (
    req.method === "GET" &&
    /^\/api\/tournaments\/[^/]+\/draw-management\/test-state\/public\/?$/.test(path)
  ) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  // The schedule service exposes this exact projection publicly and returns
  // only published rows. Keep schedule administration and all schedule writes
  // behind session authentication below.
  if (
    req.method === "GET" &&
    /^\/api\/tournaments\/[^/]+\/schedules\/?$/.test(path)
  ) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  // Public tournament details fetch only approved match results. The Match
  // service redacts pending/rejected results, so guests can follow published fixtures.
  if (req.method === "GET" && /^\/api\/matches\/[^/]+\/result\/?$/.test(path)) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  if (req.method === "GET" && (
    path === "/api/matches/live" ||
      path === "/api/matches/live/stream" ||
    /^\/api\/matches\/[^/]+\/(?:live-state|stream)\/?$/.test(path)
  )) {
    optionalSessionMiddleware(req, res, next);
    return;
  }

  const required = [
    "/api/users",
    "/api/my/tournaments",
    "/api/my/schedules",
    "/api/notifications",
    "/api/teams",
    "/api/players",
    "/api/registrations",
    "/api/registration-change-requests",
    "/api/approval-reviews",
    "/api/withdrawal-requests",
    "/api/rosters",
    "/api/tournament-invitations",
    "/api/player-withdrawal-requests",
    "/api/player-requests",
    "/api/club-requests",
    "/api/matches",
    "/api/match-results",
    "/api/result-correction-requests",
    "/api/lineups",
    "/api/match-events",
    "/api/match-reports",
    "/api/schedules",
    "/api/venue-availability",
    "/api/cards",
    "/api/suspensions",
    "/api/complaints",
    "/api/complaint-appeals",
    "/api/seasons",
    "/api/regulation-versions",
    "/api/groups",
    "/api/draws",
  ];

  if (
    /^\/api\/tournaments\/[^/]+\/(?:withdrawal-requests|registration-review-summary)\/?$/.test(path) ||
    /^\/api\/tournaments\/[^/]+\/operations\/(?:manage|summary|start|complete)\/?$/.test(path) ||
    /^\/api\/tournaments\/[^/]+\/(?:schedules|scheduling-resources|referee-team)(?:\/|$)/.test(path) ||
    /^\/api\/tournaments\/[^/]+\/forfeit-decisions\/?$/.test(path) ||
    /^\/api\/tournaments\/[^/]+\/complaint-appeals\/?$/.test(path) ||
    required.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  ) {
    sessionMiddleware(req, res, next);
    return;
  }

  optionalSessionMiddleware(req, res, next);
}

app.use("/api/internal", (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
});

app.use(
  "/api",
  apiSession,
  createProxyMiddleware({
    changeOrigin: true,
    router: resolveTarget,
    pathRewrite: rewriteApiPath,
    headers: {
      "x-gateway-internal-key": config.internalApiKey,
    },
    on: {
      proxyReq(proxyReq, req) {
        attachSessionHeadersForProxy(
          proxyReq,
          req as AuthenticatedRequest,
        );
      },
      proxyRes(proxyRes) {
        const setCookie = proxyRes.headers["set-cookie"];
        if (!setCookie) return;
        proxyRes.headers["set-cookie"] = setCookie.map((cookie) =>
          cookie.replace(/;\s*Domain=[^;]*/gi, ""),
        );
      },
      error(error, req, res, target) {
        console.error(`[api-gateway] upstream request failed for ${req.url} (${String(target)}): ${error.message}`);
        if (!("headersSent" in res) || res.headersSent || res.destroyed) return;
        const timedOut = (error as NodeJS.ErrnoException).code === "ETIMEDOUT";
        res.statusCode = timedOut ? 504 : 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({
          error: {
            code: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
            message: "Dịch vụ xử lý yêu cầu hiện không khả dụng. Vui lòng thử lại sau.",
          },
        }));
      },
    },
  }),
);

app.listen(config.port, () => {
  console.log(`[${ServiceName.GATEWAY}] listening on ${config.port}`);
});
