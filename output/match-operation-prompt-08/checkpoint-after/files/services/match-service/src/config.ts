function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3005),
  nodeEnv: process.env.NODE_ENV ?? "development",
  matchDemoModeEnabled: process.env.MATCH_DEMO_MODE_ENABLED === "true",
  matchDemoTournamentIds: (process.env.MATCH_DEMO_TOURNAMENT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean),
  schedulingTestApiEnabled: process.env.SCHEDULING_TEST_API_ENABLED === "true",
  databaseUrl: requireEnv(
    "DATABASE_URL",
    "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_match",
  ),
  schedulingDatabaseUrl: requireEnv("SCHEDULING_DATABASE_URL", process.env.DATABASE_URL),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  authServiceUrl: requireEnv("AUTH_SERVICE_URL", "http://localhost:3001"),
  notificationServiceUrl: requireEnv("NOTIFICATION_SERVICE_URL", "http://localhost:3006"),
  tournamentServiceUrl: requireEnv(
    "TOURNAMENT_SERVICE_URL",
    "http://localhost:3003",
  ),
  organizationServiceUrl: requireEnv(
    "ORGANIZATION_SERVICE_URL",
    "http://localhost:3004",
  ),
};
