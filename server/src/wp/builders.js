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
      if (namespaces.some((ns) => String(ns).toLowerCase().startsWith("elementor"))) {
        result.elementor = true;
      }
      result.checked = true;
      if (result.error && (result.elementor || result.wpbakery)) result.error = null;
    } catch (err) {
      if (!result.checked) result.error = err.message;
    }
  }

  return result;
}
