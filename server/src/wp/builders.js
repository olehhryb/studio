import { config } from "../config.js";
import { withSsh } from "../ssh/client.js";
import { listWpNamespaces } from "./client.js";
import { detectActiveBuilders } from "./provision.js";

export function emptyBuilders(extra = {}) {
  return {
    html: true,
    gutenberg: true,
    wpbakery: false,
    elementor: false,
    cf7: false,
    yoast: false,
    checked: false,
    error: null,
    plugins: [],
    ...extra,
  };
}

export async function detectBuildersForSite(site) {
  const result = emptyBuilders();
  if (!site?.installed) return result;
  const brief = site.brief || {};

  if (config.ssh?.configured && brief.wpRemotePath) {
    try {
      const viaSsh = await withSsh((ssh) => detectActiveBuilders(ssh, brief.wpRemotePath));
      Object.assign(result, viaSsh, { checked: true, error: null });
    } catch (err) {
      result.error = err.message;
    }
  }

  if (brief.wpSiteUrl && brief.wpUsername && brief.wpAppPassword) {
    try {
      const namespaces = await listWpNamespaces(brief);
      const ns = namespaces.map((item) => String(item).toLowerCase());
      if (ns.some((name) => name.startsWith("elementor"))) result.elementor = true;
      if (ns.some((name) => name.includes("contact-form-7"))) result.cf7 = true;
      if (ns.some((name) => name.includes("yoast") || name.includes("wordpress-seo"))) result.yoast = true;
      result.checked = true;
      if (result.error && (result.elementor || result.wpbakery || result.cf7 || result.yoast)) result.error = null;
    } catch (err) {
      if (!result.checked) result.error = err.message;
    }
  }

  return result;
}
