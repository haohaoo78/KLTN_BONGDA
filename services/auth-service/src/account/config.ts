function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  databaseUrl: requireEnv("ACCOUNT_DATABASE_URL", process.env.DATABASE_URL),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
};
