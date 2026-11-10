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
  databaseUrl: requireEnv(
    "DATABASE_URL",
    "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_match",
  ),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  tournamentServiceUrl: requireEnv(
    "TOURNAMENT_SERVICE_URL",
    "http://localhost:3003",
  ),
  organizationServiceUrl: requireEnv(
    "ORGANIZATION_SERVICE_URL",
    "http://localhost:3004",
  ),
};
