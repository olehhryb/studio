import fs from "node:fs/promises";
import path from "node:path";

const from = path.resolve("client/dist");
const to = path.resolve("public");
await fs.access(from);
await fs.rm(to, { recursive: true, force: true });
await fs.cp(from, to, { recursive: true });
