function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const config = {
  port: Number(process.env.PORT ?? 3006),
  nodeEnv,
  databaseUrl: requireEnv("DATABASE_URL", "postgresql://sfl:sfl_dev_password@localhost:5432/sfl_notification"),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  isProduction: nodeEnv === "production",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPassword: process.env.SMTP_PASS ?? process.env.SMTP_PASSWORD ?? "",
  mailFrom: process.env.MAIL_FROM ?? process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? "",
  mailFromName: process.env.MAIL_FROM_NAME ?? "Sân Cỏ",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
};
