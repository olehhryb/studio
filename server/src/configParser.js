import { DEFAULT_TEXT_FONT, DEFAULT_TITLE_FONT, sanitizeGoogleFont } from "../../shared/googleFonts.js";

const ALIASES = {
  PRIMARY_COLOR: ["PRIMARY_COLOR"],
  SECONDARY_COLOR: ["SECONDARY_COLOR"],
  COMPANY_NAME: ["COMPANY_NAME"],
  AREA_OF_BUSINESS: ["AREA_OF_BUSINESS"],
  CITY: ["CITY"],
  PHONE: ["PHONE"],
  EMAIL: ["EMAIL"],
  THEME_FEATURES: ["THEME_FEATURES"],
  THEME_REQUIREMENTS: ["THEME_REQUIREMENTS"],
  PAGE_STYLE_REQUIREMENTS: ["PAGE_STYLE_REQUIREMENTS"],
  LOGO_PROMPT: ["LOGO_PROMPT"],
  LOGO_WIDTH: ["LOGO_WIDTH"],
  LOGO_HEIGHT: ["LOGO_HEIGHT"],
  LOGO_FILE: ["LOGO_FILE"],
  LOGO_UPDATED_AT: ["LOGO_UPDATED_AT"],
  LOGO_ID: ["LOGO_ID"],
  LOGOS_JSON: ["LOGOS_JSON"],
  TITLE_FONT: ["TITLE_FONT"],
  TEXT_FONT: ["TEXT_FONT"],
  WP_SITE_URL: ["WP_SITE_URL"],
  WP_REMOTE_PATH: ["WP_REMOTE_PATH"],
  WP_USERNAME: ["WP_USERNAME"],
  WP_APP_PASSWORD: ["WP_APP_PASSWORD"],
  SITE_NAME: ["SITE_NAME"],
  WP_DB_NAME: ["WP_DB_NAME"],
  WP_DB_USER: ["WP_DB_USER"],
  WP_DB_PASSWORD: ["WP_DB_PASSWORD"],
  WP_ADMIN_EMAIL: ["WP_ADMIN_EMAIL"],
  WP_ADMIN_PASSWORD: ["WP_ADMIN_PASSWORD"],
  WP_EDITOR_EMAIL: ["WP_EDITOR_EMAIL"],
  PAGES_JSON: ["PAGES_JSON"],
};

const CANONICAL = Object.fromEntries(
  Object.entries(ALIASES).flatMap(([canon, keys]) => keys.map((k) => [k, canon]))
);

export function clampLogoSize(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export const FEATURE_FLAGS = [
  { id: "fullWidth", label: "Full width", match: /full\s*width/i },
  { id: "topbar", label: "Top bar", match: /top\s*bar|topbar/i },
  { id: "contentContainer", label: "Content in container", match: /container|boxed|content in container/i },
  { id: "stickyHeader", label: "Sticky header", match: /sticky\s*header|sticky nav/i },
];

export function parseFeatureList(raw) {
  const text = String(raw || "");
  const flags = {};
  for (const feature of FEATURE_FLAGS) {
    flags[feature.id] = feature.match.test(text);
  }
  if (!Object.values(flags).some(Boolean) && text.trim()) {
    flags.fullWidth = true;
    flags.contentContainer = true;
  }
  return flags;
}

export function featuresToText(flags) {
  return FEATURE_FLAGS.filter((f) => flags[f.id]).map((f) => f.label).join(", ");
}

export function parseConfigText(text) {
  const values = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_ ]+)\s*[:=]\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].trim().toUpperCase().replace(/\s+/g, "_");
    const canon = CANONICAL[key];
    if (!canon) continue;
    values[canon] = match[2].trim().replace(/\\n/g, "\n");
  }
  return normalizeBrief(values);
}

export function normalizeBrief(input = {}) {
  const featuresRaw = input.THEME_FEATURES || input.themeFeatures || "";
  const flags =
    typeof input.features === "object" && input.features
      ? {
          fullWidth: Boolean(input.features.fullWidth),
          topbar: Boolean(input.features.topbar),
          contentContainer: Boolean(input.features.contentContainer),
          stickyHeader: Boolean(input.features.stickyHeader),
        }
      : parseFeatureList(featuresRaw);

  const brief = {
    primaryColor: String(input.PRIMARY_COLOR || input.primaryColor || "#1F4D3A").trim(),
    secondaryColor: String(input.SECONDARY_COLOR || input.secondaryColor || "#C45C26").trim(),
    companyName: String(input.COMPANY_NAME || input.companyName || "").trim(),
    areaOfBusiness: String(input.AREA_OF_BUSINESS || input.areaOfBusiness || "").trim(),
    city: String(input.CITY || input.city || "").trim(),
    phone: String(input.PHONE || input.phone || "").trim(),
    email: String(input.EMAIL || input.email || "").trim(),
    themeFeatures: featuresToText(flags) || String(featuresRaw).trim(),
    themeRequirements: String(input.THEME_REQUIREMENTS || input.themeRequirements || "").trim(),
    pageStyleRequirements: String(input.PAGE_STYLE_REQUIREMENTS || input.pageStyleRequirements || "").trim(),
    logoPrompt: String(input.LOGO_PROMPT || input.logoPrompt || "").trim(),
    logoWidth: clampLogoSize(input.LOGO_WIDTH || input.logoWidth, 240, 40, 800),
    logoHeight: clampLogoSize(input.LOGO_HEIGHT || input.logoHeight, 80, 24, 400),
    logoFile: String(input.LOGO_FILE || input.logoFile || "").trim(),
    logoUpdatedAt: String(input.LOGO_UPDATED_AT || input.logoUpdatedAt || "").trim(),
    logoId: String(input.LOGO_ID || input.logoId || "").trim(),
    logos: normalizeLogos(input.logos || input.LOGOS_JSON || input.logosJson),
    titleFont: sanitizeGoogleFont(input.TITLE_FONT || input.titleFont, DEFAULT_TITLE_FONT),
    textFont: sanitizeGoogleFont(input.TEXT_FONT || input.textFont, DEFAULT_TEXT_FONT),
    features: flags,
    wpSiteUrl: String(input.WP_SITE_URL || input.wpSiteUrl || "").trim().replace(/\/+$/, ""),
    wpRemotePath: String(input.WP_REMOTE_PATH || input.wpRemotePath || "").trim().replace(/\\/g, "/").replace(/\/+$/, ""),
    wpUsername: String(input.WP_USERNAME || input.wpUsername || "").trim(),
    wpAppPassword: String(input.WP_APP_PASSWORD || input.wpAppPassword || "").trim(),
    siteName: String(input.SITE_NAME || input.siteName || input.COMPANY_NAME || input.companyName || "").trim(),
    wpDbName: String(input.WP_DB_NAME || input.wpDbName || "").trim(),
    wpDbUser: String(input.WP_DB_USER || input.wpDbUser || "").trim(),
    wpDbPassword: String(input.WP_DB_PASSWORD || input.wpDbPassword || "").trim(),
    wpAdminEmail: String(input.WP_ADMIN_EMAIL || input.wpAdminEmail || "").trim(),
    wpAdminPassword: String(input.WP_ADMIN_PASSWORD || input.wpAdminPassword || "").trim(),
    wpEditorEmail: String(input.WP_EDITOR_EMAIL || input.wpEditorEmail || input.EMAIL || input.email || "").trim(),
    pages: normalizePages(input.pages || parsePagesJson(input.PAGES_JSON || input.pagesJson)),
  };
  if (!brief.companyName && brief.siteName) brief.companyName = brief.siteName;
  return brief;
}

export function validateBrief(brief, options = {}) {
  const errors = [];
  if (!brief.siteName && !brief.companyName) errors.push("Site name is required");
  if (!brief.wpSiteUrl) errors.push("Site domain is required");
  if (brief.wpSiteUrl && !/^https?:\/\//i.test(brief.wpSiteUrl)) {
    errors.push("Site domain must start with http:// or https://");
  }
  if (!brief.wpRemotePath) errors.push("WordPress folder is required");
  if (!brief.wpDbName) errors.push("Database name is required");
  if (!brief.wpDbUser) errors.push("Database user is required");
  if (!brief.wpDbPassword) errors.push("Database password is required");
  if (!brief.wpAdminEmail) errors.push("Admin email is required");
  if (!brief.wpEditorEmail) errors.push("Editor email is required");
  const ssh = Boolean(options.ssh);
  if (!ssh) errors.push("SSH private key is not configured on the server");
  return errors;
}

export function publicBrief(brief) {
  const { wpAppPassword, wpDbPassword, wpAdminPassword, ...rest } = brief;
  return {
    ...rest,
    wpAppPassword: wpAppPassword ? "provided" : "",
    wpDbPassword: wpDbPassword ? "provided" : "",
    wpAdminPassword: wpAdminPassword ? "provided" : "",
  };
}

export const PAGE_FORMATS = [
  { id: "html", label: "HTML" },
  { id: "gutenberg", label: "Gutenberg" },
  { id: "wpbakery", label: "WpBakery" },
  { id: "elementor-free", label: "ElementorFree" },
];

export function availablePageFormats(builders) {
  return PAGE_FORMATS.filter((format) => {
    if (format.id === "wpbakery") return Boolean(builders?.wpbakery);
    if (format.id === "elementor-free") return Boolean(builders?.elementor);
    return true;
  });
}

export function formatAllowed(format, builders) {
  const id = String(format || "html").trim().toLowerCase() || "html";
  return availablePageFormats(builders).some((item) => item.id === id);
}

export const PAGE_DEFS = [
  { key: "home", title: "Home", slug: "home" },
  { key: "about", title: "About", slug: "about-us" },
  { key: "contact", title: "Contact Us", slug: "contact-us" },
  { key: "custom", title: "Custom", slug: "custom", custom: true },
];

const PAGE_FORMAT_IDS = new Set(PAGE_FORMATS.map((item) => item.id));

export function normalizeLogos(input) {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const logos = [];
  for (const item of raw) {
    const id = String(item?.id || "").trim();
    if (!/^[a-z0-9-]{8,80}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    logos.push({
      id,
      file: String(item?.file || `logos/${id}.webp`).trim() || `logos/${id}.webp`,
      source: /^(generated|uploaded|saved)$/i.test(item?.source) ? String(item.source).toLowerCase() : "generated",
      prompt: String(item?.prompt || "").trim(),
      createdAt: String(item?.createdAt || "").trim(),
    });
  }
  return logos;
}

function parsePagesJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export function emptyPage(def) {
  return {
    prompt: "",
    format: "html",
    title: def.title,
  };
}

export function emptyPages() {
  return Object.fromEntries(PAGE_DEFS.map((def) => [def.key, emptyPage(def)]));
}

export function normalizePages(input) {
  const source = input && typeof input === "object" ? input : {};
  const pages = emptyPages();
  for (const def of PAGE_DEFS) {
    const current = source[def.key] && typeof source[def.key] === "object" ? source[def.key] : {};
    const format = String(current.format || "html").trim().toLowerCase();
    pages[def.key] = {
      prompt: String(current.prompt || "").trim(),
      format: PAGE_FORMAT_IDS.has(format) ? format : "html",
      title: String(current.title || def.title).trim() || def.title,
    };
  }
  return pages;
}

export function requestedPages(pages, onlyKey) {
  return PAGE_DEFS.filter((def) => {
    if (onlyKey && def.key !== onlyKey) return false;
    return String(pages?.[def.key]?.prompt || "").trim();
  }).map((def) => ({
    ...def,
    ...pages[def.key],
    slug: def.custom
      ? String(pages[def.key].title || def.slug)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "custom"
      : def.slug,
  }));
}
