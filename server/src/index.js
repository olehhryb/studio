import { v4 as uuid } from "uuid";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { config } from "./config.js";
import { ensureAdminUser } from "./users.js";
import { loginHandler, meHandler, requireAuth } from "./auth.js";
import { normalizeBrief, parseConfigText, PAGE_DEFS, publicBrief, requestedPages, validateBrief, formatAllowed, clampLogoSize } from "./configParser.js";
import { createJob, getJob, serializeJob } from "./jobs.js";
import { runInstallPipeline, runThemePipeline, runPagesPipeline } from "./pipeline.js";
import { generateLogoFile, logoPromptFor, writeLogoFile } from "./ai/openai.js";
import { zipBridgePlugin } from "./wp/client.js";
import { detectBuildersForSite } from "./wp/builders.js";
import {
  createSite,
  createTheme,
  ensureConfigDirs,
  getSite,
  getTheme,
  listSites,
  listThemes,
  mergeSiteAndTheme,
  mergeSiteThemeForPages,
  readThemeLogoPath,
  readThemeLogoVariantPath,
  registerThemeLogo,
  themeConfText,
  themeLogoPath,
  themeLogoVariantPath,
  updateSite,
  updateTheme,
} from "./store/configs.js";
import {
  getDebugStatus,
  httpLogger,
  loadDebugState,
  logFilePath,
  setDebugEnabled,
} from "./debugLog.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000 },
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8_000_000 },
  fileFilter(_req, file, cb) {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      cb(null, true);
      return;
    }
    const err = new Error("Logo must be a PNG, JPEG, WebP, or GIF image");
    err.status = 400;
    cb(err);
  },
});

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function startPagesJob(req, res, site, theme = null) {
  if (!site.installed) {
    return res.status(400).json({ error: "Install base WordPress before generating pages" });
  }
  const pagesInput = req.body?.brief?.pages || req.body?.pages || site.brief.pages;
  await updateSite(site.id, { brief: { pages: pagesInput } });
  const freshSite = await getSite(site.id);
  const brief = mergeSiteThemeForPages(freshSite, pagesInput, theme);
  const pageKey = String(req.body?.pageKey || "").trim();
  if (pageKey && !PAGE_DEFS.some((def) => def.key === pageKey)) {
    return res.status(400).json({ error: "Unknown page" });
  }
  const pages = requestedPages(brief.pages, pageKey || undefined);
  if (!pages.length) {
    return res.status(400).json({ error: pageKey ? "Enter a prompt for this page" : "Enter a prompt for at least one page" });
  }
  const builders = await detectBuildersForSite(freshSite);
  const blocked = pages.find((page) => !formatAllowed(page.format, builders));
  if (blocked) {
    const label = blocked.format === "elementor-free" ? "Elementor" : blocked.format === "wpbakery" ? "WPBakery" : blocked.format;
    return res.status(400).json({ error: `${label} is not installed on this WordPress site` });
  }
  const job = createJob(req.user.username, brief);
  job.kind = "pages";
  job.pageKey = pageKey || pages[0]?.key || null;
  job.siteId = site.id;
  job.themeId = theme?.id || null;
  res.status(202).json({ jobId: job.id, pageKey: job.pageKey });
  runPagesPipeline(job).catch((err) => {
    console.error(`Pages job ${job.id} failed:`, err);
  });
}

const app = express();
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(httpLogger);

app.get("/api/health", async (_req, res) => {
  const debug = await getDebugStatus();
  res.json({
    ok: true,
    mockAi: !config.openaiApiKey,
    mockWp: config.mockWp,
    debugLogs: debug.enabled,
    sshConfigured: Boolean(config.ssh?.configured),
    sshHost: config.ssh?.configured ? config.ssh.host : null,
  });
});

app.post("/api/auth/login", loginHandler);
app.get("/api/auth/me", requireAuth, meHandler);

app.get("/api/debug", requireAuth, async (_req, res) => {
  res.json(await getDebugStatus());
});

app.post("/api/debug", requireAuth, async (req, res) => {
  res.json(await setDebugEnabled(Boolean(req.body?.enabled)));
});

app.get("/api/debug/download", requireAuth, async (_req, res) => {
  const file = logFilePath();
  try {
    await fs.access(file);
  } catch {
    return res.status(404).json({ error: "No log file yet. Enable logging and make a request first." });
  }
  res.download(file, path.basename(file));
});

app.get("/api/bridge.zip", requireAuth, async (_req, res) => {
  const zipPath = await zipBridgePlugin();
  res.download(zipPath, "wtg-bridge.zip");
});

app.get("/api/sites", requireAuth, asyncRoute(async (_req, res) => {
  res.json({ sites: await listSites() });
}));

app.post("/api/sites", requireAuth, asyncRoute(async (req, res) => {
  const site = await createSite(req.body || {});
  res.status(201).json({ site });
}));

app.get("/api/sites/:siteId", requireAuth, asyncRoute(async (req, res) => {
  res.json({ site: await getSite(req.params.siteId) });
}));

app.get("/api/sites/:siteId/builders", requireAuth, asyncRoute(async (req, res) => {
  const site = await getSite(req.params.siteId);
  const builders = await detectBuildersForSite(site);
  res.json({ builders });
}));

app.put("/api/sites/:siteId/pages", requireAuth, asyncRoute(async (req, res) => {
  const current = await getSite(req.params.siteId);
  if (!current.installed) {
    return res.status(400).json({ error: "Install base WordPress before saving pages" });
  }
  const site = await updateSite(req.params.siteId, { brief: { pages: req.body?.pages || {} } });
  res.json({ site });
}));

app.put("/api/sites/:siteId", requireAuth, asyncRoute(async (req, res) => {
  const current = await getSite(req.params.siteId);
  if (current.installed) {
    return res.status(409).json({ error: "Site settings are locked after WordPress is installed" });
  }
  const site = await updateSite(req.params.siteId, { brief: req.body || {} });
  res.json({ site });
}));

app.post("/api/sites/:siteId/install", requireAuth, asyncRoute(async (req, res) => {
  const current = await getSite(req.params.siteId);
  if (current.installed) {
    return res.status(409).json({ error: "WordPress is already installed for this site" });
  }
  const site = await updateSite(req.params.siteId, { brief: req.body || {} });
  const brief = { ...current.brief, ...site.brief };
  const errors = validateBrief(brief, { ssh: Boolean(config.ssh?.configured) });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(". ") });
  }
  const job = createJob(req.user.username, brief);
  job.siteId = site.id;
  res.status(202).json({ jobId: job.id, site });
  runInstallPipeline(job).catch((err) => {
    console.error(`Install job ${job.id} failed:`, err);
  });
}));

app.get("/api/sites/:siteId/themes", requireAuth, asyncRoute(async (req, res) => {
  res.json({ themes: await listThemes(req.params.siteId) });
}));

app.post("/api/sites/:siteId/themes", requireAuth, asyncRoute(async (req, res) => {
  const theme = await createTheme(req.params.siteId, req.body || {});
  res.status(201).json({ theme });
}));

app.get("/api/sites/:siteId/themes/:themeId", requireAuth, asyncRoute(async (req, res) => {
  res.json({ theme: await getTheme(req.params.siteId, req.params.themeId) });
}));

app.put("/api/sites/:siteId/themes/:themeId", requireAuth, asyncRoute(async (req, res) => {
  const theme = await updateTheme(req.params.siteId, req.params.themeId, {
    themeName: req.body?.themeName,
    brief: req.body?.brief || req.body || {},
  });
  res.json({ theme });
}));

app.get("/api/sites/:siteId/themes/:themeId/logo", requireAuth, asyncRoute(async (req, res) => {
  const file = await readThemeLogoPath(req.params.siteId, req.params.themeId);
  if (!file) {
    return res.status(404).json({ error: "No logo yet" });
  }
  res.setHeader("Cache-Control", "no-store");
  res.type("image/webp");
  res.sendFile(file);
}));

app.get("/api/sites/:siteId/themes/:themeId/logos/:logoId", requireAuth, asyncRoute(async (req, res) => {
  const file = await readThemeLogoVariantPath(req.params.siteId, req.params.themeId, req.params.logoId);
  if (!file) {
    return res.status(404).json({ error: "Logo not found" });
  }
  res.setHeader("Cache-Control", "no-store");
  res.type("image/webp");
  res.sendFile(file);
}));

app.post("/api/sites/:siteId/themes/:themeId/logos/:logoId/activate", requireAuth, asyncRoute(async (req, res) => {
  const theme = await getTheme(req.params.siteId, req.params.themeId);
  const source = await readThemeLogoVariantPath(req.params.siteId, req.params.themeId, req.params.logoId);
  if (!source) {
    return res.status(404).json({ error: "Logo not found" });
  }
  const dest = themeLogoPath(req.params.siteId, req.params.themeId);
  await writeLogoFile(dest, source, theme.brief.logoWidth, theme.brief.logoHeight);
  const updated = await updateTheme(req.params.siteId, req.params.themeId, {
    brief: {
      logoId: req.params.logoId,
      logoFile: "logo.webp",
      logoUpdatedAt: String(Date.now()),
    },
  });
  res.json({ theme: updated });
}));

app.post(
  "/api/sites/:siteId/themes/:themeId/logo",
  requireAuth,
  (req, res, next) => {
    logoUpload.single("logo")(req, res, (err) => {
      if (!err) return next();
      err.status = err.status || 400;
      if (err.code === "LIMIT_FILE_SIZE") err.message = "Logo must be 8 MB or smaller";
      next(err);
    });
  },
  asyncRoute(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Choose a logo image" });
    }
    const theme = await getTheme(req.params.siteId, req.params.themeId);
    const width = clampLogoSize(req.body?.width || theme.brief.logoWidth, 240, 40, 800);
    const height = clampLogoSize(req.body?.height || theme.brief.logoHeight, 80, 24, 400);
    const id = uuid();
    const variant = themeLogoVariantPath(req.params.siteId, req.params.themeId, id);
    await writeLogoFile(variant, req.file.buffer, width, height);
    await fs.copyFile(variant, themeLogoPath(req.params.siteId, req.params.themeId));
    await updateTheme(req.params.siteId, req.params.themeId, {
      brief: {
        logoPrompt: req.body?.prompt !== undefined ? String(req.body.prompt) : theme.brief.logoPrompt,
        logoWidth: width,
        logoHeight: height,
      },
    });
    const updated = await registerThemeLogo(req.params.siteId, req.params.themeId, {
      id,
      source: "uploaded",
      prompt: req.body?.prompt !== undefined ? String(req.body.prompt) : theme.brief.logoPrompt,
      activate: true,
    });
    res.json({ theme: updated });
  })
);

app.post("/api/sites/:siteId/themes/:themeId/logo/generate", requireAuth, asyncRoute(async (req, res) => {
  const site = await getSite(req.params.siteId);
  const theme = await updateTheme(req.params.siteId, req.params.themeId, {
    themeName: req.body?.themeName,
    brief: req.body?.brief || req.body || {},
  });
  const prompt = String(theme.brief.logoPrompt || req.body?.prompt || "").trim();
  if (!prompt) {
    return res.status(400).json({ error: "Enter a logo prompt" });
  }
  const brief = mergeSiteAndTheme(site, theme);
  const id = uuid();
  const dest = themeLogoVariantPath(req.params.siteId, req.params.themeId, id);
  await generateLogoFile(
    dest,
    {
      id: "logo",
      prompt: logoPromptFor(brief, prompt),
      width: theme.brief.logoWidth,
      height: theme.brief.logoHeight,
    },
    brief
  );
  await fs.copyFile(dest, themeLogoPath(req.params.siteId, req.params.themeId));
  const updated = await registerThemeLogo(req.params.siteId, req.params.themeId, {
    id,
    source: "generated",
    prompt,
    activate: true,
  });
  res.json({ theme: updated });
}));

app.get("/api/sites/:siteId/themes/:themeId/download", requireAuth, asyncRoute(async (req, res) => {
  const file = await themeConfText(req.params.siteId, req.params.themeId);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(file.body);
}));

app.post("/api/sites/:siteId/themes/:themeId/generate", requireAuth, asyncRoute(async (req, res) => {
  const site = await getSite(req.params.siteId);
  if (!site.installed) {
    return res.status(400).json({ error: "Install base WordPress before generating a theme" });
  }
  const theme = await updateTheme(req.params.siteId, req.params.themeId, {
    themeName: req.body?.themeName,
    brief: req.body?.brief || req.body || {},
  });
  const freshSite = await getSite(req.params.siteId);
  const brief = mergeSiteAndTheme(freshSite, theme);
  const job = createJob(req.user.username, brief);
  job.siteId = site.id;
  job.themeId = theme.id;
  res.status(202).json({ jobId: job.id, theme });
  runThemePipeline(job).catch((err) => {
    console.error(`Theme job ${job.id} failed:`, err);
  });
}));

app.post("/api/sites/:siteId/pages", requireAuth, asyncRoute(async (req, res) => {
  const site = await getSite(req.params.siteId);
  let theme = null;
  const themeId = String(req.body?.themeId || "").trim();
  if (themeId) {
    try {
      theme = await getTheme(req.params.siteId, themeId);
    } catch {
      theme = null;
    }
  }
  return startPagesJob(req, res, site, theme);
}));

app.post("/api/sites/:siteId/themes/:themeId/pages", requireAuth, asyncRoute(async (req, res) => {
  const site = await getSite(req.params.siteId);
  let theme = null;
  try {
    theme = await getTheme(req.params.siteId, req.params.themeId);
  } catch {
    theme = null;
  }
  return startPagesJob(req, res, site, theme);
}));

app.post(
  "/api/generate",
  requireAuth,
  (req, res, next) => {
    if (req.is("multipart/form-data")) return upload.single("config")(req, res, next);
    next();
  },
  async (req, res) => {
  let brief = normalizeBrief(req.body || {});
  if (req.file) {
    brief = parseConfigText(req.file.buffer.toString("utf8"));
  }
  const errors = validateBrief(brief, { ssh: Boolean(config.ssh?.configured) });
  if (errors.length) {
    return res.status(400).json({ error: errors.join(". ") });
  }

  const job = createJob(req.user.username, brief);
  res.status(202).json({
    jobId: job.id,
    brief: publicBrief(brief),
  });

  runInstallPipeline(job).catch((err) => {
    console.error(`Job ${job.id} failed:`, err);
  });
  }
);

app.get("/api/generate/:id", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(serializeJob(job));
});

app.get("/api/generate/:id/events", requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "snapshot", job: serializeJob(job) });
  const onEvent = (payload) => send(payload);
  job.events.on("event", onEvent);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    job.events.off("event", onEvent);
  });
});

app.use("/api/files/:jobId", requireAuth, (req, res, next) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  express.static(path.join(config.storageDir, job.id))(req, res, next);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const status = err.status || err.statusCode || (err instanceof SyntaxError ? 400 : 500);
  res.status(status).json({ error: err.message || "Server error" });
});

await fs.mkdir(config.storageDir, { recursive: true });
await ensureConfigDirs();
await ensureAdminUser();
await loadDebugState();

const server = app.listen(config.port, () => {
  console.log(`WP Theme Studio API on http://localhost:${config.port}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Stop the extra npm run dev and use http://localhost:5173`);
    return;
  }
  console.error(err);
  process.exit(1);
});
