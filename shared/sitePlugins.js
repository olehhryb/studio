export const SITE_PLUGINS = [
  { id: "cf7", slug: "contact-form-7", label: "CF7" },
  { id: "yoast", slug: "wordpress-seo", label: "Yoast SEO" },
];

export function sitePluginById(id) {
  return SITE_PLUGINS.find((plugin) => plugin.id === id) || null;
}

export function sitePluginActive(builders, plugin) {
  if (!builders || !plugin) return false;
  if (plugin.id === "cf7") return Boolean(builders.cf7);
  if (plugin.id === "yoast") return Boolean(builders.yoast);
  const names = Array.isArray(builders.plugins) ? builders.plugins : [];
  return names.some((name) => String(name).toLowerCase() === plugin.slug);
}

export function withSitePluginActive(builders, pluginId) {
  const plugin = sitePluginById(pluginId);
  if (!plugin) return builders;
  return {
    html: true,
    gutenberg: true,
    ...(builders || {}),
    ...(plugin.id === "cf7" ? { cf7: true } : {}),
    ...(plugin.id === "yoast" ? { yoast: true } : {}),
  };
}
