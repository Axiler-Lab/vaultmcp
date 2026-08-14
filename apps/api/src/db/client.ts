import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const serverless = Boolean(process.env.VERCEL);
const needsSsl = serverless && !/[?&]sslmode=/i.test(env.DATABASE_URL);
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: serverless ? 1 : 10,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const db = drizzle(pool, { schema });
export { pool };
