import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

const usersFile = path.join(config.dataDir, "users.json");

async function readUsers() {
  try {
    return JSON.parse(await fs.readFile(usersFile, "utf8"));
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2));
}

export async function ensureAdminUser() {
  const users = await readUsers();
  const existing = users.find((u) => u.username === config.adminUsername);
  const passwordHash = await bcrypt.hash(config.adminPassword, 10);
  if (existing) {
    existing.passwordHash = passwordHash;
  } else {
    users.push({
      id: "admin",
      username: config.adminUsername,
      passwordHash,
      role: "customer",
    });
  }
  await writeUsers(users);
}

export async function findUserByUsername(username) {
  const users = await readUsers();
  return users.find((u) => u.username === username) || null;
}

export async function verifyUser(username, password) {
  const user = await findUserByUsername(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, username: user.username, role: user.role };
}
