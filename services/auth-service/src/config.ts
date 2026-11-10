function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";
const sessionSecret =
  process.env.SESSION_SECRET ?? "dev-only-change-me-not-for-production";
const internalApiKey = process.env.INTERNAL_API_KEY ?? "";

if (nodeEnv === "production") {
  if (
    sessionSecret.length < 32 ||
    sessionSecret.startsWith("dev-") ||
    sessionSecret.startsWith("replace-") ||
    sessionSecret === "change-me-in-production-use-long-random-string"
  ) {
    throw new Error("Production requires a strong SESSION_SECRET");
  }
  if (
    internalApiKey.length < 32 ||
    internalApiKey === "dev-internal-api-key-change-in-production" ||
    internalApiKey.startsWith("replace-")
  ) {
    throw new Error("Production requires a strong INTERNAL_API_KEY");
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv,
  redisUrl: requireEnv("REDIS_URL", "redis://localhost:6379/0"),
  databaseUrl: requireEnv("DATABASE_URL", "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_auth"),
  accountDatabaseUrl: requireEnv(
    "ACCOUNT_DATABASE_URL",
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/sfl_user",
  ),
  internalApiKey,
  notificationServiceUrl: requireEnv("NOTIFICATION_SERVICE_URL", "http://localhost:3006"),
  organizationServiceUrl: requireEnv("ORGANIZATION_SERVICE_URL", "http://localhost:3004"),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "sfl_sid",
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 86400),
  refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? "sfl_refresh",
  refreshTokenTtlSeconds: Number(
    process.env.REFRESH_TOKEN_TTL_SECONDS ?? 30 * 24 * 60 * 60,
  ),
  sessionSecret,
  isProduction,
  cookieSecure:
    nodeEnv === "production" || process.env.COOKIE_SECURE === "true",
};
