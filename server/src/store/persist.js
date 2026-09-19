import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const ACCESS = "private";

function blobAccess(extra = {}) {
  return { access: ACCESS, ...extra };
}

export function isBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function persistKey(absPath) {
  const parts = path.resolve(String(absPath || "")).split(path.sep);
  const markers = ["site_configs", "themes"];
  const idx = parts.findIndex((part) => markers.includes(part));
  if (idx === -1) return "";
  return parts.slice(idx).join("/");
}

function enoent(target) {
  const err = new Error(`ENOENT: no such file or directory, '${target}'`);
  err.code = "ENOENT";
  return err;
}

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (typeof stream.arrayBuffer === "function") {
    return Buffer.from(await stream.arrayBuffer());
  }
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function blobGet(key) {
  const { get } = await import("@vercel/blob");
  return get(key, blobAccess({ useCache: false }));
}

async function blobPut(key, body, contentType) {
  const { put } = await import("@vercel/blob");
  return put(key, body, blobAccess({
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentType || contentTypeFor(key),
  }));
}

async function blobDel(key) {
  const { del } = await import("@vercel/blob");
  await del(key, blobAccess());
}

async function blobList(prefix) {
  const { list } = await import("@vercel/blob");
  const names = [];
  let cursor;
  do {
    const page = await list(blobAccess({ prefix, cursor, limit: 1000 }));
    names.push(...(page.blobs || []));
    cursor = page.hasMore ? page.cursor : "";
  } while (cursor);
  return names;
}

function contentTypeFor(key) {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain; charset=utf-8";
}

export async function mkdir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function seedLocalIntoBlob() {
  if (!isBlobStore()) return;
  for (const folder of ["site_configs", "themes"]) {
    await walkAndSeed(path.join(config.root, folder), folder);
  }
}

async function walkAndSeed(absDir, keyPrefix) {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === ".gitkeep") continue;
    const abs = path.join(absDir, entry.name);
    const key = `${keyPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkAndSeed(abs, key);
      continue;
    }
    try {
      const existing = await blobGet(key);
      if (existing?.stream) continue;
    } catch {
      /* not in Blob yet */
    }
    await blobPut(key, await fs.readFile(abs));
  }
}

export async function writeFile(absPath, data, options = {}) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, data, options.encoding ? { encoding: options.encoding } : undefined);
  const key = persistKey(absPath);
  if (isBlobStore() && key) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data), options.encoding || "utf8");
    await blobPut(key, body, options.contentType);
  }
}

export async function syncIfNeeded(absPath) {
  const key = persistKey(absPath);
  if (!isBlobStore() || !key) return;
  const body = await fs.readFile(absPath);
  await blobPut(key, body);
}

export async function readBuffer(absPath) {
  const key = persistKey(absPath);
  if (isBlobStore() && key) {
    const result = await blobGet(key);
    if (!result?.stream) throw enoent(absPath);
    const body = await streamToBuffer(result.stream);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, body);
    return body;
  }
  try {
    return await fs.readFile(absPath);
  } catch (err) {
    if (err.code === "ENOENT") throw enoent(absPath);
    throw err;
  }
}

export async function readFile(absPath, encoding = "utf8") {
  const body = await readBuffer(absPath);
  return encoding ? body.toString(encoding) : body;
}

export async function exists(absPath) {
  try {
    await readBuffer(absPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

export async function copyFile(from, to) {
  const body = await readBuffer(from);
  await writeFile(to, body);
}

export async function rename(from, to) {
  await copyFile(from, to);
  await unlink(from);
}

export async function unlink(absPath) {
  await fs.unlink(absPath).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
  const key = persistKey(absPath);
  if (isBlobStore() && key) {
    try {
      await blobDel(key);
    } catch {
      /* already gone */
    }
  }
}

export async function readdir(absPath) {
  const key = persistKey(absPath);
  if (isBlobStore() && key) {
    const prefix = key.replace(/\/?$/, "/");
    const blobs = await blobList(prefix);
    const names = new Set();
    for (const blob of blobs) {
      const rest = String(blob.pathname || "").slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      names.add(rest);
    }
    return [...names];
  }
  try {
    return await fs.readdir(absPath);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function materialize(absPath) {
  try {
    await readBuffer(absPath);
    return absPath;
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

export async function writeBlob(key, data, contentType) {
  if (!isBlobStore()) {
    const abs = path.join(config.storageDir, key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, typeof data === "string" ? data : data);
    return;
  }
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  await blobPut(key, body, contentType);
}

export async function readBlob(key, encoding = "utf8") {
  if (!isBlobStore()) {
    try {
      return await fs.readFile(path.join(config.storageDir, key), encoding);
    } catch (err) {
      if (err.code === "ENOENT") return "";
      throw err;
    }
  }
  const result = await blobGet(key);
  if (!result?.stream) return "";
  const body = await streamToBuffer(result.stream);
  return encoding ? body.toString(encoding) : body;
}
