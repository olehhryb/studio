import { NodeSSH } from "node-ssh";
import { logEvent } from "../debugLog.js";
import { getSshConfig } from "./config.js";

export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function redactCommand(command) {
  return String(command)
    .replace(/--dbpass=\S+/gi, "--dbpass=[redacted]")
    .replace(/--user_pass=\S+/gi, "--user_pass=[redacted]")
    .replace(/--admin_password=\S+/gi, "--admin_password=[redacted]");
}

function keyLooksEncrypted(key) {
  const text = String(key || "");
  return /ENCRYPTED/i.test(text) || /Proc-Type:\s*4,\s*ENCRYPTED/i.test(text) || /bcrypt/i.test(text);
}

export async function connectSsh() {
  const cfg = getSshConfig();
  if (!cfg.configured) {
    throw new Error("SSH is not configured. Set SSH_URL (or SSH_HOST), SSH_USERNAME, and SSH_PASSWORD or SSH_PRIVATE_KEY in .env");
  }
  const ssh = new NodeSSH();
  const opts = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    readyTimeout: 20000,
  };
  if (cfg.privateKey) {
    opts.privateKey = cfg.privateKey;
    if (cfg.passphrase) opts.passphrase = cfg.passphrase;
  }
  if (cfg.password) opts.password = cfg.password;
  if (cfg.privateKey && keyLooksEncrypted(cfg.privateKey) && !cfg.passphrase) {
    throw new Error(
      "SSH private key is encrypted. Set SSH_PRIVATE_KEY_PASSPHRASE in .env."
    );
  }
  try {
    await ssh.connect(opts);
    await logEvent({
      type: "ssh",
      message: "connected",
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
    });
    return ssh;
  } catch (err) {
    await logEvent({
      type: "ssh",
      message: "connect failed",
      host: cfg.host,
      error: err.message,
    });
    throw new Error(
      /passphrase|encrypted/i.test(err.message) && !cfg.passphrase
        ? `SSH key for ${cfg.username}@${cfg.host} is encrypted. Set SSH_PRIVATE_KEY_PASSPHRASE in .env.`
        : `SSH connection to ${cfg.username}@${cfg.host}:${cfg.port} failed: ${err.message}`
    );
  }
}

export async function sshExec(ssh, command) {
  await logEvent({ type: "ssh", command: redactCommand(command) });
  const result = await ssh.execCommand(command);
  await logEvent({
    type: "ssh",
    code: result.code,
    stdout: String(result.stdout || "").slice(0, 20_000),
    stderr: String(result.stderr || "").slice(0, 20_000),
  });
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `SSH command failed (${result.code})`).trim());
  }
  return result;
}

export async function withSsh(fn) {
  const ssh = await connectSsh();
  try {
    return await fn(ssh);
  } finally {
    ssh.dispose();
  }
}
