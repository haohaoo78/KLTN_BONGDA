function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? "development",
  authServiceUrl: requireEnv("AUTH_SERVICE_URL", "http://localhost:3001"),
  tournamentServiceUrl: requireEnv("TOURNAMENT_SERVICE_URL", "http://localhost:3003"),
  organizationServiceUrl: requireEnv(
    "ORGANIZATION_SERVICE_URL",
    process.env.TEAM_SERVICE_URL ?? "http://localhost:3004",
  ),
  matchServiceUrl: requireEnv("MATCH_SERVICE_URL", "http://localhost:3005"),
  notificationServiceUrl: requireEnv("NOTIFICATION_SERVICE_URL", "http://localhost:3006"),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "sfl_sid",
};
