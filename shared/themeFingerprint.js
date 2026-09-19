export function themeInputFingerprint(themeName, brief = {}) {
  const flags = brief.features && typeof brief.features === "object" ? brief.features : {};
  const features = ["fullWidth", "topbar", "contentContainer", "stickyHeader"]
    .filter((id) => flags[id])
    .join(",") || String(brief.themeFeatures || "").trim();
  return JSON.stringify({
    n: String(themeName || "").trim(),
    p: String(brief.primaryColor || "").trim(),
    s: String(brief.secondaryColor || "").trim(),
    c: String(brief.companyName || "").trim(),
    b: String(brief.areaOfBusiness || "").trim(),
    city: String(brief.city || "").trim(),
    phone: String(brief.phone || "").trim(),
    email: String(brief.email || "").trim(),
    f: features,
    req: String(brief.themeRequirements || "").trim(),
    style: String(brief.pageStyleRequirements || "").trim(),
    logo: String(brief.logoId || "").trim(),
    lw: Number(brief.logoWidth) || 240,
    lh: Number(brief.logoHeight) || 80,
    lu: String(brief.logoUpdatedAt || "").trim(),
    tf: String(brief.titleFont || "").trim(),
    xf: String(brief.textFont || "").trim(),
  });
}
