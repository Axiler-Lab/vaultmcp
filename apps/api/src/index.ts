import { createApp } from "./app.js";
import { env } from "./config.js";
import { connectRedis } from "./redis.js";

export { createApp };

const app = createApp();

async function main() {
  await connectRedis();
  app.listen(env.PORT, () => {
    console.log(`VaultMCP API listening on ${env.PUBLIC_URL} (port ${env.PORT})`);
  });
}

if (!process.env.VERCEL) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export default app;
