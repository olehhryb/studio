export const FEATURES = [
  { id: "fullWidth", label: "Full width" },
  { id: "topbar", label: "With top bar" },
  { id: "contentContainer", label: "Content in container" },
  { id: "stickyHeader", label: "Sticky header" },
];

const ALIASES = {
  PRIMARY_COLOR: "primaryColor",
  PRIMARY: "primaryColor",
  SECONDARY_COLOR: "secondaryColor",
  SECONDARY: "secondaryColor",
  COMPANY_NAME: "companyName",
  COMPANY: "companyName",
  AREA_OF_BUSINESS: "areaOfBusiness",
  BUSINESS: "areaOfBusiness",
  INDUSTRY: "areaOfBusiness",
  CITY: "city",
  PHONE: "phone",
  PHONE_NUMBER: "phone",
  EMAIL: "email",
  THEME_FEATURES: "themeFeatures",
  FEATURES: "themeFeatures",
  THEME_REQUIREMENTS: "themeRequirements",
  ADDITIONAL_REQUIREMENTS: "themeRequirements",
  EXTRA_REQUIREMENTS: "themeRequirements",
  REQUIREMENTS: "themeRequirements",
  PAGE_STYLE_REQUIREMENTS: "pageStyleRequirements",
  PAGE_STYLES: "pageStyleRequirements",
  PAGE_STYLE: "pageStyleRequirements",
  LOGO_PROMPT: "logoPrompt",
  LOGO: "logoPrompt",
  LOGO_WIDTH: "logoWidth",
  LOGO_HEIGHT: "logoHeight",
  LOGO_FILE: "logoFile",
  LOGO_UPDATED_AT: "logoUpdatedAt",
  LOGO_ID: "logoId",
  ACTIVE_LOGO: "logoId",
  LOGOS_JSON: "logosJson",
  LOGOS: "logosJson",
  TITLE_FONT: "titleFont",
  HEADING_FONT: "titleFont",
  HEADINGS_FONT: "titleFont",
  TEXT_FONT: "textFont",
  BODY_FONT: "textFont",
  WP_SITE_URL: "wpSiteUrl",
  WP_URL: "wpSiteUrl",
  SITE_URL: "wpSiteUrl",
  WP_SITE_ADDRESS: "wpSiteUrl",
  DOMAIN: "wpSiteUrl",
  SITE_DOMAIN: "wpSiteUrl",
  WP_REMOTE_PATH: "wpRemotePath",
  REMOTE_PATH: "wpRemotePath",
  SSH_PATH: "wpRemotePath",
  WP_PATH: "wpRemotePath",
  WP_FOLDER: "wpRemotePath",
  FOLDER: "wpRemotePath",
  WP_USERNAME: "wpUsername",
  WP_USER: "wpUsername",
  USERNAME: "wpUsername",
  WP_APP_PASSWORD: "wpAppPassword",
  APP_PASSWORD: "wpAppPassword",
  SITE_NAME: "siteName",
  SITE_TITLE: "siteName",
  WP_TITLE: "siteName",
  WP_DB_NAME: "wpDbName",
  DB_NAME: "wpDbName",
  DATABASE: "wpDbName",
  DATABASE_NAME: "wpDbName",
  WP_DB_USER: "wpDbUser",
  DB_USER: "wpDbUser",
  DATABASE_USER: "wpDbUser",
  WP_DB_PASSWORD: "wpDbPassword",
  DB_PASSWORD: "wpDbPassword",
  DATABASE_PASSWORD: "wpDbPassword",
  WP_ADMIN_EMAIL: "wpAdminEmail",
  ADMIN_EMAIL: "wpAdminEmail",
  WP_ADMIN_PASSWORD: "wpAdminPassword",
  WP_EDITOR_EMAIL: "wpEditorEmail",
  EDITOR_EMAIL: "wpEditorEmail",
  PAGES_JSON: "pagesJson",
  PAGES: "pagesJson",
};

export function emptyBrief() {
  return {
    primaryColor: "#1F4D3A",
    secondaryColor: "#C45C26",
    companyName: "",
    areaOfBusiness: "",
    city: "",
    phone: "",
    email: "",
    themeFeatures: "full width, with topbar, content in container, sticky header",
    themeRequirements: "",
    pageStyleRequirements: "",
    logoPrompt: "",
    logoWidth: 240,
    logoHeight: 80,
    logoFile: "",
    logoUpdatedAt: "",
    logoId: "",
    logos: [],
    titleFont: "Playfair Display",
    textFont: "Source Sans 3",
    features: {
      fullWidth: true,
      topbar: true,
      contentContainer: true,
      stickyHeader: true,
    },
    wpSiteUrl: "",
    wpRemotePath: "",
    wpUsername: "",
    wpAppPassword: "",
    siteName: "",
    wpDbName: "",
    wpDbUser: "",
    wpDbPassword: "",
    wpAdminEmail: "",
    wpAdminPassword: "",
    wpEditorEmail: "",
    pages: emptyPages(),
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

export const PAGE_DEFS = [
  { key: "home", title: "Home", slug: "home" },
  { key: "about", title: "About", slug: "about-us" },
  { key: "contact", title: "Contact Us", slug: "contact-us" },
  { key: "custom", title: "Custom", custom: true },
];

const PAGE_FORMAT_IDS = new Set(PAGE_FORMATS.map((item) => item.id));

export function emptyPages() {
  return Object.fromEntries(
    PAGE_DEFS.map((def) => [
      def.key,
      { prompt: "", format: "html", title: def.title },
    ])
  );
}

export function mergePages(saved) {
  const pages = emptyPages();
  const source = saved && typeof saved === "object" ? saved : {};
  for (const def of PAGE_DEFS) {
    const current = source[def.key] && typeof source[def.key] === "object" ? source[def.key] : {};
    const format = String(current.format || "html").trim().toLowerCase();
    pages[def.key] = {
      prompt: String(current.prompt || ""),
      format: PAGE_FORMAT_IDS.has(format) ? format : "html",
      title: String(current.title || def.title),
    };
  }
  return pages;
}

export function parseConfigText(text) {
  const next = emptyBrief();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_ ]+)\s*[:=]\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].trim().toUpperCase().replace(/\s+/g, "_");
    const field = ALIASES[key];
    if (!field) continue;
    next[field] = match[2].trim().replace(/\\n/g, "\n");
  }
  if (!next.siteName && next.companyName) next.siteName = next.companyName;
  if (!next.companyName && next.siteName) next.companyName = next.siteName;
  if (!next.wpEditorEmail && next.email) next.wpEditorEmail = next.email;
  next.logoWidth = Math.min(800, Math.max(40, Number(next.logoWidth) || 240));
  next.logoHeight = Math.min(400, Math.max(24, Number(next.logoHeight) || 80));
  if (next.themeFeatures) {
    next.features = {
      fullWidth: /full\s*width/i.test(next.themeFeatures),
      topbar: /top\s*bar|topbar/i.test(next.themeFeatures),
      contentContainer: /container|boxed/i.test(next.themeFeatures),
      stickyHeader: /sticky/i.test(next.themeFeatures),
    };
  }
  if (next.pagesJson) {
    try {
      next.pages = mergePages(JSON.parse(next.pagesJson));
    } catch {
      next.pages = emptyPages();
    }
    delete next.pagesJson;
  } else {
    next.pages = mergePages(next.pages);
  }
  if (next.logosJson) {
    try {
      next.logos = mergeLogos(JSON.parse(next.logosJson));
    } catch {
      next.logos = [];
    }
    delete next.logosJson;
  } else {
    next.logos = mergeLogos(next.logos);
  }
  return next;
}

export function mergeLogos(saved) {
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  const logos = [];
  for (const item of saved) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    logos.push({
      id,
      file: String(item?.file || "").trim(),
      source: String(item?.source || "generated"),
      prompt: String(item?.prompt || ""),
      createdAt: String(item?.createdAt || ""),
    });
  }
  return logos;
}

export function featuresToText(features) {
  return FEATURES.filter((f) => features[f.id]).map((f) => f.label.toLowerCase()).join(", ");
}

export function baseSiteReady(brief) {
  return [
    brief.wpRemotePath,
    brief.wpSiteUrl,
    brief.wpDbName,
    brief.wpDbUser,
    brief.wpDbPassword,
    brief.wpAdminEmail,
    brief.wpEditorEmail,
    brief.siteName,
  ].every((value) => String(value || "").trim().length > 0);
}
