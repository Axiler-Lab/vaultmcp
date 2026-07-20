import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { pool };
