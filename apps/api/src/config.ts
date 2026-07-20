import { deriveMasterKey } from "@vaultmcp/shared/crypto";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
loadDotenv({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z
    .string()
    .default("postgres://vaultmcp:vaultmcp@localhost:5432/vaultmcp"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  VAULT_MASTER_KEY: z.string().min(16),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default("vaultmcp_session"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  const data = parsed.data;
  return {
    ...data,
    COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === "production",
    masterKey: deriveMasterKey(data.VAULT_MASTER_KEY),
  };
}

export const env = loadEnv();
