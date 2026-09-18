import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getSshConfig } from "./ssh/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

export const config = {
  port: Number(process.env.PORT || 3001),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "changeme",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "dall-e-3",
  mockWp: String(process.env.MOCK_WP || "").toLowerCase() === "true",
  debugLogs: String(process.env.DEBUG_LOGS || "").toLowerCase() === "true",
  ssh: getSshConfig(),
  root,
  storageDir: path.join(root, "storage"),
  dataDir: path.join(root, "server", "data"),
  pluginDir: path.join(root, "server", "plugins", "wtg-bridge"),
  siteConfigsDir: path.join(root, "site_configs"),
  themesDir: path.join(root, "themes"),
};
