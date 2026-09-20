import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

function enoent(target) {
  const err = new Error(`ENOENT: no such file or directory, '${target}'`);
  err.code = "ENOENT";
  return err;
}

export async function mkdir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeFile(absPath, data, options = {}) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, data, options.encoding ? { encoding: options.encoding } : undefined);
}

export async function syncIfNeeded() {
  /* local files are already on disk */
}

export async function readBuffer(absPath) {
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
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function copyFile(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

export async function rename(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

export async function unlink(absPath) {
  await fs.unlink(absPath).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });
}

export async function readdir(absPath) {
  try {
    return await fs.readdir(absPath);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function materialize(absPath) {
  return (await exists(absPath)) ? absPath : "";
}

export async function writeBlob(key, data) {
  const abs = path.join(config.storageDir, key);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, typeof data === "string" ? data : data);
}

export async function readBlob(key, encoding = "utf8") {
  try {
    return await fs.readFile(path.join(config.storageDir, key), encoding);
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}
