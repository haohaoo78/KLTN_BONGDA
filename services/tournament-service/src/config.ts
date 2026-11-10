function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3003),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: requireEnv(
    "DATABASE_URL",
    "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_tournament",
  ),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  organizationServiceUrl: requireEnv(
    "ORGANIZATION_SERVICE_URL",
    "http://localhost:3004",
  ),
  matchServiceUrl: requireEnv(
    "MATCH_SERVICE_URL",
    "http://localhost:3005",
  ),
  authServiceUrl: requireEnv(
    "AUTH_SERVICE_URL",
    "http://localhost:3001",
  ),
};
