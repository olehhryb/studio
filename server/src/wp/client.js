import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logHttp } from "../debugLog.js";

function basicAuth(username, password) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function restUrls(siteUrl, pathname) {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const pretty = `${base}${pathname}`;
  const route = pathname.replace(/^\/wp-json/, "") || "/";
  const query = `${base}/?rest_route=${encodeURIComponent(route)}`;
  return pretty === query ? [pretty] : [pretty, query];
}

async function wpFetch(siteUrl, username, password, pathname, options = {}) {
  const urls = restUrls(siteUrl, pathname);
  let lastErr = null;
  for (const [index, url] of urls.entries()) {
    try {
      return await wpFetchUrl(url, username, password, options);
    } catch (err) {
      lastErr = err;
      if (err.status !== 404 || index === urls.length - 1) throw err;
    }
  }
  throw lastErr;
}

async function wpFetchUrl(url, username, password, options = {}) {
  const headers = {
    Authorization: basicAuth(username, password),
    Accept: "application/json",
    ...(options.headers || {}),
  };
  const started = Date.now();
  const method = options.method || "GET";
  const requestType = headers["Content-Type"] || headers["content-type"] || "";
  let requestBody = options.body;
  if (typeof requestBody === "string") {
    try {
      requestBody = JSON.parse(requestBody);
    } catch {
      /* keep string */
    }
  }
  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    await logHttp({
      direction: "outbound",
      target: "wordpress",
      method,
      url,
      status: res.status,
      ms: Date.now() - started,
      requestHeaders: headers,
      requestBody,
      requestType,
      responseHeaders: Object.fromEntries(res.headers.entries()),
      responseBody: data,
      responseType: res.headers.get("content-type") || "",
      error: res.ok ? undefined : data?.message || data?.error || `${res.status} ${res.statusText}`,
    });
    if (!res.ok) {
      const msg = data?.message || data?.error || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.status) throw err;
    await logHttp({
      direction: "outbound",
      target: "wordpress",
      method,
      url,
      ms: Date.now() - started,
      requestHeaders: headers,
      requestBody,
      requestType,
      error: err.message,
    });
    throw err;
  }
}

export async function checkBridge(creds) {
  try {
    return await wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wtg/v1/status");
  } catch {
    return null;
  }
}

export async function wpPing(creds) {
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wp/v2/users/me");
}

export async function listWpNamespaces(creds) {
  const data = await wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/");
  return Array.isArray(data?.namespaces) ? data.namespaces.map((item) => String(item)) : [];
}

export async function installTheme(creds, zipPath) {
  const buf = await fs.readFile(zipPath);
  const blob = new Blob([buf], { type: "application/zip" });
  const form = new FormData();
  form.append("file", blob, path.basename(zipPath));
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wtg/v1/theme", {
    method: "POST",
    body: form,
  });
}

export async function ensureCf7(creds) {
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wtg/v1/ensure-cf7", {
    method: "POST",
  });
}

export async function createCf7Form(creds, spec) {
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wtg/v1/cf7", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
}

export async function uploadMedia(creds, filePath, filename, options = {}) {
  const opts = typeof options === "string" ? { mime: options } : options || {};
  const mime = opts.mime || "image/webp";
  const buf = await fs.readFile(filePath);
  const media = await wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wp/v2/media", {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: buf,
    signal: opts.signal || AbortSignal.timeout(30000),
  });
  const title = opts.title;
  const alt = opts.alt || opts.title;
  if (media?.id && (title || alt)) {
    try {
      await wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, `/wp-json/wp/v2/media/${media.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || alt,
          alt_text: alt || title,
        }),
      });
    } catch {
      /* keep the uploaded file even if title/alt update fails */
    }
  }
  return media;
}

export async function upsertPage(creds, { title, slug, content, parent = 0 }) {
  const existing = await wpFetch(
    creds.wpSiteUrl,
    creds.wpUsername,
    creds.wpAppPassword,
    `/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`
  );
  const payload = {
    title,
    slug,
    content,
    status: "publish",
    parent,
  };
  if (Array.isArray(existing) && existing[0]) {
    return wpFetch(
      creds.wpSiteUrl,
      creds.wpUsername,
      creds.wpAppPassword,
      `/wp-json/wp/v2/pages/${existing[0].id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  }
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wp/v2/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function setFrontPage(creds, pageId) {
  return wpFetch(creds.wpSiteUrl, creds.wpUsername, creds.wpAppPassword, "/wp-json/wp/v2/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ show_on_front: "page", page_on_front: pageId }),
  });
}

export async function zipBridgePlugin() {
  const { default: AdmZip } = await import("adm-zip");
  const zipPath = path.join(config.storageDir, "wtg-bridge.zip");
  await fs.mkdir(config.storageDir, { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(config.pluginDir, "wtg-bridge");
  zip.writeZip(zipPath);
  return zipPath;
}
