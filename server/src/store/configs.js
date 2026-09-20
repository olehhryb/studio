import path from "node:path";
import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { featuresToText, parseConfigText, emptyPages, normalizePages, normalizeLogos } from "../configParser.js";
import * as persist from "./persist.js";

const ID_RE = /^[a-z0-9-]{8,80}$/i;
const FILE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/i;

function assertId(id, label = "id") {
  if (!ID_RE.test(String(id || ""))) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return String(id);
}

function assertFileSlug(slug) {
  if (!FILE_SLUG_RE.test(String(slug || ""))) {
    const err = new Error("Invalid site config filename");
    err.status = 400;
    throw err;
  }
  return String(slug);
}

export function homepageFileSlug(url) {
  const slug = String(url || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase()
    .slice(0, 80);
  return slug || "site";
}

function sitePath(fileSlug) {
  return path.join(config.siteConfigsDir, `${assertFileSlug(fileSlug)}.conf`);
}

function themeDir(siteId) {
  return path.join(config.themesDir, assertId(siteId, "site id"));
}

function themePath(siteId, themeId) {
  return path.join(themeDir(siteId), `${assertId(themeId, "theme id")}.conf`);
}

export function themeZipPath(siteId, themeId) {
  return path.join(themeDir(siteId), assertId(themeId, "theme id"), "theme.zip");
}

export function themeLogoPath(siteId, themeId) {
  return path.join(themeDir(siteId), assertId(themeId, "theme id"), "logo.webp");
}

export function themeLogosDir(siteId, themeId) {
  return path.join(themeDir(siteId), assertId(themeId, "theme id"), "logos");
}

export function themeLogoVariantPath(siteId, themeId, logoId) {
  return path.join(themeLogosDir(siteId, themeId), `${assertId(logoId, "logo id")}.webp`);
}

export function themeLogosIndexPath(siteId, themeId) {
  return path.join(themeDir(siteId), assertId(themeId, "theme id"), "logos.json");
}

export async function readThemeLogoPath(siteId, themeId) {
  return persist.materialize(themeLogoPath(siteId, themeId));
}

export async function readThemeLogoVariantPath(siteId, themeId, logoId) {
  return persist.materialize(themeLogoVariantPath(siteId, themeId, logoId));
}

export async function readLogosIndex(siteId, themeId) {
  try {
    const raw = JSON.parse(await persist.readFile(themeLogosIndexPath(siteId, themeId), "utf8"));
    return normalizeLogos(raw);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return [];
  }
}

export async function writeLogosIndex(siteId, themeId, logos) {
  const file = themeLogosIndexPath(siteId, themeId);
  const list = normalizeLogos(logos);
  await persist.writeFile(file, `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

export async function registerThemeLogo(siteId, themeId, { id, source = "generated", prompt = "", activate = true }) {
  const entry = {
    id: assertId(id, "logo id"),
    file: `logos/${assertId(id, "logo id")}.webp`,
    source,
    prompt: String(prompt || "").trim(),
    createdAt: new Date().toISOString(),
  };
  const current = (await readLogosIndex(siteId, themeId)) || [];
  const logos = [entry, ...current.filter((item) => item.id !== entry.id)];
  await writeLogosIndex(siteId, themeId, logos);
  const patch = activate
    ? { logoId: entry.id, logoFile: "logo.webp", logoUpdatedAt: String(Date.now()) }
    : {};
  return updateTheme(siteId, themeId, { brief: patch });
}

async function migrateLegacyLogo(siteId, theme) {
  const active = await readThemeLogoPath(siteId, theme.id);
  if (!active) return { ...theme, brief: { ...theme.brief, logos: [] } };
  const id = uuid();
  await persist.mkdir(themeLogosDir(siteId, theme.id));
  await persist.copyFile(active, themeLogoVariantPath(siteId, theme.id, id));
  const logos = [
    {
      id,
      file: `logos/${id}.webp`,
      source: "saved",
      prompt: String(theme.brief.logoPrompt || "").trim(),
      createdAt: new Date().toISOString(),
    },
  ];
  await writeLogosIndex(siteId, theme.id, logos);
  const next = {
    ...theme,
    brief: {
      ...theme.brief,
      logos,
      logoId: id,
      logoFile: "logo.webp",
    },
  };
  await persist.writeFile(themePath(siteId, theme.id), themeToConf(next));
  return next;
}

async function withThemeLogos(theme) {
  const indexed = await readLogosIndex(theme.siteId, theme.id);
  if (indexed) {
    return {
      ...theme,
      brief: {
        ...theme.brief,
        logos: indexed,
        logoId: theme.brief.logoId || indexed[0]?.id || "",
      },
    };
  }
  return migrateLegacyLogo(theme.siteId, theme);
}

function parseConf(text) {
  const meta = {
    id: "",
    siteId: "",
    fileSlug: "",
    themeName: "",
    installed: false,
    installedAt: "",
    createdAt: "",
    updatedAt: "",
  };
  const briefLines = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_ ]+)\s*[:=]\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].trim().toUpperCase().replace(/\s+/g, "_");
    const value = match[2].trim();
    if (key === "ID") meta.id = value;
    else if (key === "SITE_ID") meta.siteId = value;
    else if (key === "FILE_SLUG") meta.fileSlug = value;
    else if (key === "THEME_NAME") meta.themeName = value;
    else if (key === "GENERATED_FINGERPRINT") meta.generatedFingerprint = value;
    else if (key === "GENERATED_AT") meta.generatedAt = value;
    else if (key === "GENERATED_SLUG") meta.generatedSlug = value;
    else if (key === "WP_INSTALLED_FINGERPRINT") meta.wpInstalledFingerprint = value;
    else if (key === "WP_INSTALLED_AT") meta.wpInstalledAt = value;
    else if (key === "INSTALLED") meta.installed = /^(1|true|yes|on)$/i.test(value);
    else if (key === "INSTALLED_AT") meta.installedAt = value;
    else if (key === "CREATED_AT") meta.createdAt = value;
    else if (key === "UPDATED_AT") meta.updatedAt = value;
    else briefLines.push(raw);
  }
  return { meta, brief: parseConfigText(briefLines.join("\n")) };
}

function line(key, value) {
  if (value === undefined || value === null || value === "") return null;
  return `${key}: ${String(value).replace(/\r?\n/g, "\\n")}`;
}

function siteToConf(site) {
  const brief = site.brief || {};
  return [
    line("ID", site.id),
    line("FILE_SLUG", site.fileSlug),
    line("SITE_NAME", brief.siteName),
    line("WP_SITE_URL", brief.wpSiteUrl),
    line("WP_REMOTE_PATH", brief.wpRemotePath),
    line("WP_DB_NAME", brief.wpDbName),
    line("WP_DB_USER", brief.wpDbUser),
    line("WP_DB_PASSWORD", brief.wpDbPassword),
    line("WP_ADMIN_EMAIL", brief.wpAdminEmail),
    line("WP_ADMIN_PASSWORD", brief.wpAdminPassword),
    line("WP_EDITOR_EMAIL", brief.wpEditorEmail),
    line("WP_USERNAME", brief.wpUsername),
    line("WP_APP_PASSWORD", brief.wpAppPassword),
    line("PAGES_JSON", JSON.stringify(brief.pages || {})),
    site.installed ? "# WordPress installed" : "# WordPress not installed yet",
    line("INSTALLED", site.installed ? "true" : "false"),
    line("INSTALLED_AT", site.installedAt),
    line("CREATED_AT", site.createdAt),
    line("UPDATED_AT", site.updatedAt),
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");
}

function themeToConf(theme) {
  const brief = theme.brief || {};
  return [
    line("ID", theme.id),
    line("SITE_ID", theme.siteId),
    line("THEME_NAME", theme.themeName),
    line("GENERATED_FINGERPRINT", theme.generatedFingerprint),
    line("GENERATED_AT", theme.generatedAt),
    line("GENERATED_SLUG", theme.generatedSlug),
    line("WP_INSTALLED_FINGERPRINT", theme.wpInstalledFingerprint),
    line("WP_INSTALLED_AT", theme.wpInstalledAt),
    line("PRIMARY_COLOR", brief.primaryColor),
    line("SECONDARY_COLOR", brief.secondaryColor),
    line("COMPANY_NAME", brief.companyName),
    line("AREA_OF_BUSINESS", brief.areaOfBusiness),
    line("CITY", brief.city),
    line("PHONE", brief.phone),
    line("EMAIL", brief.email),
    line("THEME_FEATURES", brief.themeFeatures || featuresToText(brief.features || {})),
    line("THEME_REQUIREMENTS", brief.themeRequirements),
    line("PAGE_STYLE_REQUIREMENTS", brief.pageStyleRequirements),
    line("LOGO_PROMPT", brief.logoPrompt),
    line("LOGO_WIDTH", brief.logoWidth),
    line("LOGO_HEIGHT", brief.logoHeight),
    line("LOGO_FILE", brief.logoFile),
    line("LOGO_UPDATED_AT", brief.logoUpdatedAt),
    line("LOGO_ID", brief.logoId),
    line("LOGOS_JSON", JSON.stringify(brief.logos || [])),
    line("TITLE_FONT", brief.titleFont),
    line("TEXT_FONT", brief.textFont),
    line("PAGES_JSON", JSON.stringify(brief.pages || {})),
    line("CREATED_AT", theme.createdAt),
    line("UPDATED_AT", theme.updatedAt),
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");
}

const SITE_BRIEF_KEYS = [
  "siteName",
  "wpSiteUrl",
  "wpRemotePath",
  "wpDbName",
  "wpDbUser",
  "wpDbPassword",
  "wpAdminEmail",
  "wpAdminPassword",
  "wpEditorEmail",
  "wpUsername",
  "wpAppPassword",
  "pages",
];

const THEME_BRIEF_KEYS = [
  "primaryColor",
  "secondaryColor",
  "companyName",
  "areaOfBusiness",
  "city",
  "phone",
  "email",
  "themeFeatures",
  "themeRequirements",
  "pageStyleRequirements",
  "logoPrompt",
  "logoWidth",
  "logoHeight",
  "logoFile",
  "logoUpdatedAt",
  "logoId",
  "titleFont",
  "textFont",
  "pages",
  "features",
];

function pickBrief(input = {}, keys) {
  const out = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

function emptySiteBrief() {
  return parseConfigText("");
}

function emptyThemeBrief() {
  const brief = parseConfigText("");
  brief.themeFeatures = featuresToText({
    fullWidth: true,
    topbar: true,
    contentContainer: true,
    stickyHeader: true,
  });
  brief.features = {
    fullWidth: true,
    topbar: true,
    contentContainer: true,
    stickyHeader: true,
  };
  brief.themeRequirements = "";
  brief.pageStyleRequirements = "";
  brief.logoPrompt = "";
  brief.logoWidth = 240;
  brief.logoHeight = 80;
  brief.logoFile = "";
  brief.logoUpdatedAt = "";
  brief.logoId = "";
  brief.logos = [];
  brief.titleFont = "Playfair Display";
  brief.textFont = "Source Sans 3";
  brief.pages = emptyPages();
  return brief;
}

export async function ensureConfigDirs() {
  await persist.mkdir(config.siteConfigsDir);
  await persist.mkdir(config.themesDir);
}

function siteRecord(parsed, fileSlug) {
  return {
    id: parsed.meta.id || fileSlug,
    fileSlug,
    installed: parsed.meta.installed,
    installedAt: parsed.meta.installedAt || "",
    createdAt: parsed.meta.createdAt,
    updatedAt: parsed.meta.updatedAt,
    brief: parsed.brief,
  };
}

async function readSiteFromFilename(filename) {
  try {
    const fileSlug = filename.replace(/\.conf$/i, "");
    const parsed = parseConf(await persist.readFile(path.join(config.siteConfigsDir, filename), "utf8"));
    return siteRecord(parsed, fileSlug);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function loadAllSites() {
  await ensureConfigDirs();
  const names = await persist.readdir(config.siteConfigsDir);
  const sites = [];
  for (const name of names) {
    if (!name.endsWith(".conf")) continue;
    const site = await readSiteFromFilename(name);
    if (site) sites.push(site);
  }
  return sites;
}

async function writeSiteFile(site) {
  await ensureConfigDirs();
  const fileSlug = assertFileSlug(site.fileSlug || site.id);
  const next = { ...site, fileSlug };
  await persist.writeFile(sitePath(fileSlug), siteToConf(next));
  return next;
}

async function uniqueHomepageSlug(desired, siteId) {
  const sites = await loadAllSites();
  const taken = new Set(
    sites.filter((site) => site.id !== siteId).map((site) => site.fileSlug)
  );
  let candidate = desired;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${desired}${n}`.slice(0, 80);
    n += 1;
  }
  return candidate;
}

export async function renameInstalledSiteConfig(site) {
  if (!site?.installed) return site;
  const desired = homepageFileSlug(site.brief?.wpSiteUrl);
  const nextSlug = await uniqueHomepageSlug(desired, site.id);
  if (nextSlug === site.fileSlug) return site;
  const from = sitePath(site.fileSlug);
  const to = sitePath(nextSlug);
  try {
    await persist.rename(from, to);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return writeSiteFile({ ...site, fileSlug: nextSlug, updatedAt: new Date().toISOString() });
}

export async function listSites() {
  const sites = [];
  for (const site of await loadAllSites()) {
    const current = site.installed ? await renameInstalledSiteConfig(site) : site;
    sites.push({
      id: current.id,
      fileSlug: current.fileSlug,
      siteName: current.brief.siteName || "Untitled site",
      wpSiteUrl: current.brief.wpSiteUrl || "",
      installed: Boolean(current.installed),
      updatedAt: current.updatedAt || current.createdAt || "",
    });
  }
  sites.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return sites;
}

export async function getSite(id) {
  const sites = await loadAllSites();
  const found = sites.find((site) => site.id === id || site.fileSlug === id);
  if (!found) {
    const err = new Error("Site not found");
    err.status = 404;
    throw err;
  }
  if (found.installed) return renameInstalledSiteConfig(found);
  return found;
}

export async function createSite(input = {}) {
  const now = new Date().toISOString();
  const source = input.brief || input;
  const brief = { ...emptySiteBrief(), ...pickBrief(source, SITE_BRIEF_KEYS) };
  const id = uuid();
  const site = {
    id,
    fileSlug: id,
    installed: false,
    createdAt: now,
    updatedAt: now,
    brief,
  };
  await writeSiteFile(site);
  await persist.mkdir(themeDir(site.id));
  return site;
}

export async function updateSite(id, patch = {}) {
  const current = await getSite(id);
  const nextBrief = { ...current.brief, ...(patch.brief || {}) };
  nextBrief.pages = normalizePages(patch.brief?.pages !== undefined ? patch.brief.pages : current.brief.pages);
  const next = {
    ...current,
    installed: patch.installed !== undefined ? Boolean(patch.installed) : current.installed,
    installedAt: patch.installedAt || current.installedAt || "",
    updatedAt: new Date().toISOString(),
    brief: nextBrief,
  };
  const saved = await writeSiteFile(next);
  if (saved.installed) return renameInstalledSiteConfig(saved);
  return saved;
}

export async function markSiteInstalled(id, credentials = {}) {
  const now = new Date().toISOString();
  const brief = {
    wpUsername: credentials.wpUsername || "",
    wpAppPassword: credentials.wpAppPassword || "",
  };
  if (credentials.wpAdminPassword) brief.wpAdminPassword = credentials.wpAdminPassword;
  return updateSite(id, {
    installed: true,
    installedAt: now,
    brief,
  });
}

async function readThemeFile(siteId, themeId) {
  try {
    const parsed = parseConf(await persist.readFile(themePath(siteId, themeId), "utf8"));
    return {
      id: parsed.meta.id || themeId,
      siteId,
      themeName: parsed.meta.themeName || "Untitled theme",
      generatedFingerprint: parsed.meta.generatedFingerprint || "",
      generatedAt: parsed.meta.generatedAt || "",
      generatedSlug: parsed.meta.generatedSlug || "",
      wpInstalledFingerprint: parsed.meta.wpInstalledFingerprint || "",
      wpInstalledAt: parsed.meta.wpInstalledAt || "",
      createdAt: parsed.meta.createdAt,
      updatedAt: parsed.meta.updatedAt,
      brief: parsed.brief,
    };
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function listThemes(siteId) {
  const site = await getSite(siteId);
  await persist.mkdir(themeDir(site.id));
  const names = await persist.readdir(themeDir(site.id));
  const themes = [];
  for (const name of names) {
    if (!name.endsWith(".conf")) continue;
    const theme = await readThemeFile(site.id, name.replace(/\.conf$/i, ""));
    if (theme) {
      themes.push({
        id: theme.id,
        siteId: site.id,
        themeName: theme.themeName,
        updatedAt: theme.updatedAt || theme.createdAt || "",
      });
    }
  }
  themes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return themes;
}

export async function getTheme(siteId, themeId) {
  const site = await getSite(siteId);
  const theme = await readThemeFile(site.id, themeId);
  if (!theme) {
    const err = new Error("Theme not found");
    err.status = 404;
    throw err;
  }
  const withLogos = await withThemeLogos(theme);
  return {
    ...withLogos,
    hasZip: await persist.exists(themeZipPath(site.id, theme.id)),
  };
}

export async function createTheme(siteId, input = {}) {
  const site = await getSite(siteId);
  const now = new Date().toISOString();
  const existing = await listThemes(site.id);
  const theme = {
    id: uuid(),
    siteId: site.id,
    themeName: String(input.themeName || `Theme ${existing.length + 1}`).trim() || `Theme ${existing.length + 1}`,
    createdAt: now,
    updatedAt: now,
    brief: { ...emptyThemeBrief(), ...pickBrief(input.brief || {}, THEME_BRIEF_KEYS) },
  };
  await persist.mkdir(themeDir(site.id));
  await persist.writeFile(themePath(site.id, theme.id), themeToConf(theme));
  return theme;
}

export async function updateTheme(siteId, themeId, patch = {}) {
  const site = await getSite(siteId);
  const current = await readThemeFile(site.id, themeId);
  if (!current) {
    const err = new Error("Theme not found");
    err.status = 404;
    throw err;
  }
  const briefPatch = { ...(patch.brief || {}) };
  delete briefPatch.logos;
  const next = {
    ...current,
    themeName: patch.themeName !== undefined ? String(patch.themeName).trim() || current.themeName : current.themeName,
    generatedFingerprint: patch.generatedFingerprint !== undefined ? patch.generatedFingerprint : current.generatedFingerprint || "",
    generatedAt: patch.generatedAt !== undefined ? patch.generatedAt : current.generatedAt || "",
    generatedSlug: patch.generatedSlug !== undefined ? patch.generatedSlug : current.generatedSlug || "",
    wpInstalledFingerprint: patch.wpInstalledFingerprint !== undefined ? patch.wpInstalledFingerprint : current.wpInstalledFingerprint || "",
    wpInstalledAt: patch.wpInstalledAt !== undefined ? patch.wpInstalledAt : current.wpInstalledAt || "",
    updatedAt: new Date().toISOString(),
    brief: { ...current.brief, ...briefPatch },
  };
  await persist.writeFile(themePath(site.id, themeId), themeToConf(next));
  return withThemeLogos(next);
}

export function themeDownloadName(theme) {
  const slug = String(theme.themeName || "theme")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "theme";
  return `${slug}.conf`;
}

export async function themeConfText(siteId, themeId) {
  const theme = await getTheme(siteId, themeId);
  return { filename: themeDownloadName(theme), body: themeToConf(theme) };
}

export function mergeSiteAndTheme(site, theme) {
  return mergeSiteThemeForPages(site, theme?.brief?.pages || site.brief.pages, theme);
}

export function mergeSiteThemeForPages(site, pages, theme = null) {
  const themeBrief = theme?.brief || {};
  return {
    ...themeBrief,
    siteName: site.brief.siteName,
    wpSiteUrl: site.brief.wpSiteUrl,
    wpRemotePath: site.brief.wpRemotePath,
    wpDbName: site.brief.wpDbName,
    wpDbUser: site.brief.wpDbUser,
    wpDbPassword: site.brief.wpDbPassword,
    wpAdminEmail: site.brief.wpAdminEmail,
    wpAdminPassword: site.brief.wpAdminPassword,
    wpEditorEmail: site.brief.wpEditorEmail,
    wpUsername: site.brief.wpUsername,
    wpAppPassword: site.brief.wpAppPassword,
    companyName: themeBrief.companyName || site.brief.siteName,
    email: themeBrief.email || site.brief.wpEditorEmail || site.brief.wpAdminEmail,
    themeName: theme?.themeName || "",
    pages: normalizePages(pages || site.brief.pages),
  };
}
