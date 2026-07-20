import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "./client.js";
import { backfillEnvelopeCrypto } from "../services/workspace-keys.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsFolder = path.join(__dirname, "../../drizzle");
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Schema migrations complete");

  const { workspacesMinted, secretsUpgraded } = await backfillEnvelopeCrypto();
  if (workspacesMinted > 0 || secretsUpgraded > 0) {
    console.log(
      `Envelope crypto backfill: minted DEKs for ${workspacesMinted} workspace(s), upgraded ${secretsUpgraded} secret(s)`,
    );
  } else {
    console.log("Envelope crypto backfill: nothing to do");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
