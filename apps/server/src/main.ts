import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { ConfigError, loadConfig, ROOT_DIR } from "./config.js";

loadDotenv({ path: join(ROOT_DIR, ".env"), quiet: true });

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

const app = await buildApp(config, {
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});
if (config.devLogin) app.log.warn("DEV_LOGIN=1: /auth/dev-login lets anyone log in as anyone. Never use this on a public server.");
if (!config.discourseConnectSecret) app.log.warn("DISCOURSE_CONNECT_SECRET not set: forum login is disabled");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    app.log.info(`${sig}: shutting down`);
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`Track Studio at ${config.baseUrl} (forum ${config.forumUrl}, data in ${config.dataDir})`);
