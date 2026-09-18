import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { verifyUser } from "./users.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: "12h" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.token;
  if (!token) {
    return res.status(401).json({ error: "Sign in required" });
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired" });
  }
}

export async function loginHandler(req, res) {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    const user = await verifyUser(username, password);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = signToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ error: "Could not sign in. Try again." });
  }
}

export function meHandler(req, res) {
  res.json({
    user: {
      id: req.user.sub,
      username: req.user.username,
      role: req.user.role,
    },
  });
}
