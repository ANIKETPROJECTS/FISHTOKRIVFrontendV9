import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ecosystem = require("../ecosystem.config.cjs");
const appConfig = ecosystem.apps?.[0];

if (!appConfig?.env) {
  throw new Error("ecosystem.config.cjs does not contain an app environment");
}

const appEnv = {
  ...appConfig.env,
  // The storefront reads the public Razorpay identifier through Vite's
  // client-exposed prefix; keep it in sync with the configured server key.
  VITE_RAZORPAY_KEY_ID:
    appConfig.env.VITE_RAZORPAY_KEY_ID || appConfig.env.RAZORPAY_KEY_ID,
};

const child = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...appEnv,
      NODE_ENV: "development",
      // Replit's web preview is configured for port 5000.
      PORT: process.env.PORT || "5000",
    },
  },
);

const forwardSignal = (signal) => child.kill(signal);
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});