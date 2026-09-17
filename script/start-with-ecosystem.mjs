import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ecosystem = require("../ecosystem.config.cjs");
const appConfig = ecosystem.apps?.[0];

if (!appConfig?.env) {
  throw new Error("ecosystem.config.cjs does not contain an app environment");
}

const child = spawn(process.execPath, ["dist/index.cjs"], {
  stdio: "inherit",
  env: {
    ...appConfig.env,
    // Explicit VPS/PM2 environment variables override imported defaults.
    ...process.env,
    NODE_ENV: "production",
    PORT: process.env.PORT || String(appConfig.env.PORT || "5000"),
  },
});

const forwardSignal = (signal) => child.kill(signal);
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});