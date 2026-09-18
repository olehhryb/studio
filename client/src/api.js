const TOKEN_KEY = "wtg_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(res, data) {
  if (data?.error) return data.error;
  if (res.status >= 500) return "API is starting up. Try signing in again.";
  return res.statusText || "Request failed";
}

async function request(path, options = {}, attempt = 0) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const retries = options.retries ?? 2;
  try {
    const res = await fetch(path, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(12000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) {
        await delay(500 * (attempt + 1));
        return request(path, options, attempt + 1);
      }
      throw new Error(errorMessage(res, data));
    }
    return data;
  } catch (err) {
    const retryable = /timeout|failed to fetch|network|ECONNRESET|starting up/i.test(err.message || err.name || "");
    if (attempt < retries && retryable) {
      await delay(500 * (attempt + 1));
      return request(path, options, attempt + 1);
    }
    if (err.name === "TimeoutError" || /timeout/i.test(err.message || "")) {
      throw new Error("API did not respond. Use http://localhost:5173 and keep a single npm run dev running.");
    }
    throw err;
  }
}

export const api = {
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request("/api/auth/me"),
  health: () => request("/api/health"),
  generate: (brief) => request("/api/generate", { method: "POST", body: JSON.stringify(brief) }),
  listSites: () => request("/api/sites"),
  createSite: (brief = {}) => request("/api/sites", { method: "POST", body: JSON.stringify(brief) }),
  getSite: (id) => request(`/api/sites/${id}`),
  updateSite: (id, brief) => request(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(brief) }),
  updateSitePages: (id, pages) => request(`/api/sites/${id}/pages`, { method: "PUT", body: JSON.stringify({ pages }) }),
  installSite: (id, brief) => request(`/api/sites/${id}/install`, { method: "POST", body: JSON.stringify(brief) }),
  listThemes: (siteId) => request(`/api/sites/${siteId}/themes`),
  createTheme: (siteId, payload = {}) =>
    request(`/api/sites/${siteId}/themes`, { method: "POST", body: JSON.stringify(payload) }),
  getTheme: (siteId, themeId) => request(`/api/sites/${siteId}/themes/${themeId}`),
  updateTheme: (siteId, themeId, payload) =>
    request(`/api/sites/${siteId}/themes/${themeId}`, { method: "PUT", body: JSON.stringify(payload) }),
  generateTheme: (siteId, themeId, payload) =>
    request(`/api/sites/${siteId}/themes/${themeId}/generate`, { method: "POST", body: JSON.stringify(payload) }),
  uploadThemeLogo: (siteId, themeId, file, meta = {}) => {
    const body = new FormData();
    body.append("logo", file);
    if (meta.width != null) body.append("width", String(meta.width));
    if (meta.height != null) body.append("height", String(meta.height));
    if (meta.prompt) body.append("prompt", meta.prompt);
    return request(`/api/sites/${siteId}/themes/${themeId}/logo`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30000),
    });
  },
  generateThemeLogo: (siteId, themeId, payload) =>
    request(`/api/sites/${siteId}/themes/${themeId}/logo/generate`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
      retries: 0,
    }),
  activateThemeLogo: (siteId, themeId, logoId) =>
    request(`/api/sites/${siteId}/themes/${themeId}/logos/${logoId}/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  generatePages: (siteId, payload) =>
    request(`/api/sites/${siteId}/pages`, {
      method: "POST",
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    }),
  getSiteBuilders: (siteId) =>
    request(`/api/sites/${siteId}/builders`, { signal: AbortSignal.timeout(25000) }),
  job: (id) => request(`/api/generate/${id}`),
  debugStatus: () => request("/api/debug"),
  setDebug: (enabled) => request("/api/debug", { method: "POST", body: JSON.stringify({ enabled }) }),
};

export function withAuthUrl(url) {
  if (!url) return url;
  if (!url.startsWith("/api/")) return url;
  const token = getToken();
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}token=${encodeURIComponent(token || "")}`;
}

export function subscribeJob(jobId, onEvent) {
  const token = getToken();
  const source = new EventSource(`/api/generate/${jobId}/events?token=${encodeURIComponent(token || "")}`);
  source.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  };
  return () => source.close();
}
