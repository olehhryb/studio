import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function parseSshUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return {};
  try {
    const withProto = /:\/\//.test(s) ? s : `ssh://${s}`;
    const u = new URL(withProto);
    return {
      host: u.hostname || "",
      port: u.port ? Number(u.port) : undefined,
      username: decodeURIComponent(u.username || ""),
    };
  } catch {
    const at = s.includes("@") ? s.split("@") : [null, s];
    const hostPort = (at[1] || s).split(":");
    return {
      host: hostPort[0],
      port: hostPort[1] ? Number(hostPort[1]) : undefined,
      username: at[0] || "",
    };
  }
}

function loadPrivateKey() {
  const inline = String(process.env.SSH_PRIVATE_KEY || "").trim();
  const keyPath = String(process.env.SSH_PRIVATE_KEY_PATH || "").trim();
  if (inline && /BEGIN .+ PRIVATE KEY/.test(inline)) {
    return inline.replace(/\\n/g, "\n");
  }
  const candidate = keyPath || (inline && !inline.includes("\n") ? inline : "");
  if (candidate) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.join(root, candidate);
    if (fs.existsSync(resolved)) return fs.readFileSync(resolved, "utf8");
  }
  return "";
}

const fromUrl = parseSshUrl(process.env.SSH_URL || process.env.SSH_HOST || process.env.SSH_SERVER_URL || "");

export function getSshConfig() {
  const username = String(process.env.SSH_USERNAME || process.env.SSH_USER || fromUrl.username || "").trim();
  const host = String(process.env.SSH_HOST || fromUrl.host || "").trim();
  const port = Number(process.env.SSH_PORT || fromUrl.port || 22);
  const password = String(process.env.SSH_PASSWORD || "").trim();
  const privateKey = loadPrivateKey();
  const passphrase = String(process.env.SSH_PRIVATE_KEY_PASSPHRASE || "").trim();
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 22,
    username,
    password,
    privateKey,
    passphrase,
    configured: Boolean(host && username && (password || privateKey)),
  };
}

const SHARED_HOSTING_SITE_DBS = {
  site1: { name: "site1", user: "site1", password: "site1pass" },
  site2: { name: "site2", user: "site2", password: "site2pass" },
  site3: { name: "site3", user: "site3", password: "site3pass" },
};

function siteKeyFromRemotePath(remotePath) {
  return path.posix.basename(String(remotePath || "").replace(/\\/g, "/").replace(/\/+$/, ""));
}

export function getWpDbConfig(remotePath, brief = {}) {
  const config = {
    host: String(brief.wpDbHost || process.env.WP_DB_HOST || "localhost").trim(),
    user: String(process.env.WP_DB_USER || process.env.WP_DB_USERNAME || "").trim(),
    password: String(process.env.WP_DB_PASSWORD || "").trim(),
    name: String(process.env.WP_DB_NAME || "").trim(),
    adminUser: String(process.env.WP_ADMIN_USER || "admin").trim(),
    adminPassword: String(brief.wpAdminPassword || process.env.WP_ADMIN_PASSWORD || "").trim(),
    adminEmail: String(brief.wpAdminEmail || process.env.WP_ADMIN_EMAIL || "").trim(),
    editorUser: String(process.env.WP_EDITOR_USER || "editor").trim(),
    editorEmail: String(brief.wpEditorEmail || "").trim(),
    precreated: false,
  };
  const site = SHARED_HOSTING_SITE_DBS[siteKeyFromRemotePath(remotePath)];
  if (site) {
    config.name = site.name;
    config.user = site.user;
    config.password = site.password;
    config.precreated = true;
  }
  if (brief.wpDbName) config.name = String(brief.wpDbName).trim();
  if (brief.wpDbUser) config.user = String(brief.wpDbUser).trim();
  if (brief.wpDbPassword) config.password = String(brief.wpDbPassword).trim();
  return config;
}
