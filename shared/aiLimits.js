const MIN_MS = 30_000;
const DEFAULT_MS = 600_000;

function readTimeoutMs() {
  const raw = typeof process !== "undefined" ? Number(process.env?.AI_TIMEOUT_MS) : NaN;
  if (Number.isFinite(raw) && raw >= MIN_MS) return Math.round(raw);
  return DEFAULT_MS;
}

export const AI_TIMEOUT_MS = readTimeoutMs();

export const AI_TIMEOUT_MESSAGE = `AI request did not finish within ${Math.round(AI_TIMEOUT_MS / 1000)} seconds.`;
