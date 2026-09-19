import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getSshConfig, getWpDbHost } from "./ssh/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, ".env.local"), override: true });

const vercel = Boolean(process.env.VERCEL);
const blobStore = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const workRoot = vercel || blobStore ? "/tmp/wtg" : root;

export const config = {
  port: Number(process.env.PORT || 3001),
  clientOrigin: process.env.CLIENT_ORIGIN || (vercel && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173"),
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "changeme",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "dall-e-3",
  mockWp: String(process.env.MOCK_WP || "").toLowerCase() === "true",
  debugLogs: String(process.env.DEBUG_LOGS || "").toLowerCase() === "true",
  ssh: getSshConfig(),
  wpDbHost: getWpDbHost(),
  root,
  vercel,
  blobStore,
  ephemeralFs: vercel,
  storageDir: path.join(workRoot, "storage"),
  dataDir: vercel ? path.join(workRoot, "server", "data") : path.join(root, "server", "data"),
  pluginDir: path.join(root, "server", "plugins", "wtg-bridge"),
  siteConfigsDir: path.join(workRoot, "site_configs"),
  themesDir: path.join(workRoot, "themes"),
  logsDir: vercel ? path.join(workRoot, "logs") : path.join(root, "logs"),
};
