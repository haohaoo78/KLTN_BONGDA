function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3004),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: requireEnv(
    "DATABASE_URL",
    "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_team",
  ),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  tournamentServiceUrl: requireEnv(
    "TOURNAMENT_SERVICE_URL",
    "http://localhost:3003",
  ),
  notificationServiceUrl: requireEnv(
    "NOTIFICATION_SERVICE_URL",
    "http://localhost:3006",
  ),
  authServiceUrl: requireEnv(
    "AUTH_SERVICE_URL",
    "http://localhost:3001",
  ),
};
