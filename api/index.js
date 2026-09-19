import app, { ready } from "../server/src/index.js";

await ready;

export const maxDuration = 60;
export default app;
