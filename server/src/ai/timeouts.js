import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { readBlob, writeBlob } from "../store/persist.js";
import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS } from "../../../shared/aiLimits.js";

const BLOB_KEY = "studio/ai-timeouts.json";
const MAX_RECORDS = 80;

export { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS };

function isAbortError(err) {
  const name = String(err?.name || "");
  const message = String(err?.message || "");
  return name === "AbortError" || name === "APIUserAbortError" || /aborted|timeout/i.test(message);
}

async function readRecords() {
  const raw = await readBlob(BLOB_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecords(records) {
  await writeBlob(BLOB_KEY, `${JSON.stringify(records, null, 2)}\n`, "application/json");
}

export async function listAiTimeouts() {
  return readRecords();
}

export async function recordAiTimeout(input = {}) {
  const entry = {
    id: String(input.id || uuid()),
    at: input.at || new Date().toISOString(),
    kind: String(input.kind || "chat"),
    label: String(input.label || "ai"),
    model: String(input.model || ""),
    ms: Number(input.ms) || AI_TIMEOUT_MS,
    limitMs: AI_TIMEOUT_MS,
    reason: String(input.reason || "timeout"),
    source: String(input.source || "server"),
    hosting: config.vercel ? "vercel" : "local",
    message: AI_TIMEOUT_MESSAGE,
  };
  const current = await readRecords();
  const duplicate = current.find((item) => {
    if (item.kind !== entry.kind || item.label !== entry.label) return false;
    return Math.abs(new Date(item.at).getTime() - new Date(entry.at).getTime()) < 120_000;
  });
  if (duplicate) return { entry: duplicate, created: false, records: current };
  const records = [entry, ...current].slice(0, MAX_RECORDS);
  await writeRecords(records);
  return { entry, created: true, records };
}

export async function withAiTimeout(meta, run) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), AI_TIMEOUT_MS);
  const timeout = new Promise((_, reject) => {
    const fail = () => {
      const err = new Error("AI timeout");
      err.name = "AbortError";
      reject(err);
    };
    if (ac.signal.aborted) fail();
    else ac.signal.addEventListener("abort", fail, { once: true });
  });
  try {
    const result = await Promise.race([run(ac.signal), timeout]);
    const ms = Date.now() - started;
    if (ms >= AI_TIMEOUT_MS) {
      await recordAiTimeout({ ...meta, ms, reason: "slow", source: "server" });
    }
    return result;
  } catch (err) {
    const ms = Date.now() - started;
    if (ac.signal.aborted || isAbortError(err) || ms >= AI_TIMEOUT_MS) {
      await recordAiTimeout({ ...meta, ms: Math.max(ms, AI_TIMEOUT_MS), reason: "timeout", source: "server" });
      const timeout = new Error(AI_TIMEOUT_MESSAGE);
      timeout.code = "AI_TIMEOUT";
      timeout.status = 504;
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
