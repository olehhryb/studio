import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS } from "../../shared/aiLimits.js";

const listeners = new Set();
let liveWarning = "";

export { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS };

export function getLiveAiWarning() {
  return liveWarning;
}

export function setLiveAiWarning(message) {
  liveWarning = String(message || "");
  for (const fn of listeners) fn(liveWarning);
}

export function subscribeLiveAiWarning(fn) {
  listeners.add(fn);
  fn(liveWarning);
  return () => listeners.delete(fn);
}
