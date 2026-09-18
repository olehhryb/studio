import fsp from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

function isSensitiveKey(key) {
  const k = String(key);
  if (/^access-control/i.test(k)) return false;
  return /pass(word)?|token|secret|^authorization$|api[-_]?key|cookie|credential|private[_-]?key/i.test(k);
}
const MAX_TEXT = 80_000;

let enabled = config.debugLogs;
let writing = Promise.resolve();

function stateFile() {
  return path.join(config.dataDir, "debug-logs.json");
}

export function logDir() {
  return path.join(config.root, "logs");
}

export function logFilePath(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return path.join(logDir(), `http-${day}.jsonl`);
}

export async function loadDebugState() {
  try {
    const saved = JSON.parse(await fsp.readFile(stateFile(), "utf8"));
    if (typeof saved.enabled === "boolean") enabled = saved.enabled;
  } catch {
    enabled = config.debugLogs;
  }
  return getDebugStatus();
}

async function persistState() {
  await fsp.mkdir(config.dataDir, { recursive: true });
  await fsp.writeFile(stateFile(), JSON.stringify({ enabled }, null, 2));
}

export function isDebugEnabled() {
  return enabled;
}

export async function setDebugEnabled(value) {
  enabled = Boolean(value);
  await persistState();
  if (enabled) {
    await fsp.mkdir(logDir(), { recursive: true });
    await logEvent({
      type: "system",
      message: "Debug logging enabled",
    });
  }
  return getDebugStatus();
}

export async function getDebugStatus() {
  const file = logFilePath();
  let bytes = 0;
  try {
    bytes = (await fsp.stat(file)).size;
  } catch {
    bytes = 0;
  }
  return {
    enabled,
    file: enabled || bytes ? file : null,
    bytes,
  };
}

export function redact(value) {
  return redactValue(value);
}

function redactValue(value, key = "") {
  if (isSensitiveKey(key)) return "[redacted]";
  if (value == null) return value;
  if (Buffer.isBuffer(value)) return { type: "binary", bytes: value.length };
  if (typeof value === "string") {
    if (isSensitiveKey(key)) return "[redacted]";
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n…[truncated ${value.length - MAX_TEXT} chars]` : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    if (typeof value.pipe === "function") return { type: "stream" };
    if (typeof FormData !== "undefined" && value instanceof FormData) {
      return { type: "form-data", keys: [...value.keys()] };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(v, k);
    return out;
  }
  return value;
}

function summarizeHeaders(headers) {
  if (!headers) return {};
  const raw =
    typeof headers.entries === "function"
      ? Object.fromEntries(headers.entries())
      : { ...headers };
  return redactValue(raw);
}

function summarizeBody(body, contentType = "") {
  if (body == null || body === "") return null;
  if (Buffer.isBuffer(body)) return { type: "binary", bytes: body.length };
  if (typeof body === "object") return redactValue(body);
  const text = String(body);
  if (/image|octet-stream|zip|pdf/i.test(contentType)) {
    return { type: "binary", bytes: Buffer.byteLength(text) };
  }
  try {
    return redactValue(JSON.parse(text));
  } catch {
    return redactValue(text);
  }
}

export function logEvent(entry) {
  if (!enabled && entry.type !== "system") return writing;
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    }) + "\n";
  writing = writing.then(async () => {
    await fsp.mkdir(logDir(), { recursive: true });
    await fsp.appendFile(logFilePath(), line);
  }).catch((err) => {
    console.error("Debug log write failed:", err.message);
  });
  return writing;
}

export function logHttp(entry) {
  if (!enabled) return writing;
  const record = {
    type: "http",
    direction: entry.direction || "inbound",
    method: entry.method,
    url: entry.url,
    status: entry.status,
    ms: entry.ms,
    request: {
      headers: summarizeHeaders(entry.requestHeaders),
      body: summarizeBody(entry.requestBody, entry.requestType),
    },
    response: {
      headers: summarizeHeaders(entry.responseHeaders),
      body: summarizeBody(entry.responseBody, entry.responseType),
    },
    error: entry.error || undefined,
  };
  if (entry.target) record.target = entry.target;
  console.log(
    `[debug] ${record.direction} ${record.method || ""} ${record.url} ${record.status ?? ""} ${record.ms ?? ""}ms`.trim()
  );
  return logEvent(record);
}

export function httpLogger(req, res, next) {
  if (req.path.startsWith("/api/debug")) return next();

  const started = Date.now();
  const requestBody = req.body;
  let responseBody;
  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  res.json = (body) => {
    responseBody = body;
    return origJson(body);
  };
  res.send = (body) => {
    responseBody = body;
    return origSend(body);
  };

  res.on("finish", () => {
    if (!isDebugEnabled()) return;
    const type = String(res.getHeader("content-type") || "");
    if (/text\/event-stream/i.test(type)) {
      logHttp({
        direction: "inbound",
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - started,
        requestHeaders: req.headers,
        requestBody,
        responseHeaders: res.getHeaders(),
        responseBody: { type: "sse", note: "streamed events; see later http records" },
        responseType: type,
      });
      return;
    }
    logHttp({
      direction: "inbound",
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - started,
      requestHeaders: req.headers,
      requestBody,
      responseHeaders: res.getHeaders(),
      responseBody,
      responseType: type,
    });
  });

  next();
}
