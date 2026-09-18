import { useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeJob, withAuthUrl } from "../api.js";
import { FEATURES, PAGE_DEFS, availablePageFormats, baseSiteReady, emptyBrief, featuresToText, mergeLogos, mergePages, parseConfigText } from "../configParse.js";
import {
  DEFAULT_TEXT_FONT,
  DEFAULT_TITLE_FONT,
  FONT_GROUPS,
  GOOGLE_FONTS,
  googleFontsCssUrl,
} from "../../../shared/googleFonts.js";

export default function Studio({ user, siteId, onBack, onLogout }) {
  const [site, setSite] = useState(null);
  const [siteBrief, setSiteBrief] = useState(emptyBrief);
  const [themes, setThemes] = useState([]);
  const [theme, setTheme] = useState(null);
  const [themeName, setThemeName] = useState("");
  const [themeBrief, setThemeBrief] = useState(emptyBrief);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [siteSettingsOpen, setSiteSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [builders, setBuilders] = useState(null);
  const [buildersLoading, setBuildersLoading] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const skipSiteSave = useRef(true);
  const skipThemeSave = useRef(true);
  const skipPageSave = useRef(true);

  useEffect(() => {
    api.health().then((data) => {
      setHealth(data);
      setDebugEnabled(Boolean(data.debugLogs));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    skipSiteSave.current = true;
    skipThemeSave.current = true;
    skipPageSave.current = true;
    setSiteSettingsOpen(false);
    setThemeOpen(false);
    setPagesOpen(false);
    setJob(null);
    setError("");
    setBuilders(null);
    (async () => {
      try {
        const data = await api.getSite(siteId);
        if (cancelled) return;
        setSite(data.site);
        setSiteBrief({ ...emptyBrief(), ...data.site.brief, pages: mergePages(data.site.brief?.pages) });
        const list = await api.listThemes(siteId);
        if (cancelled) return;
        setThemes(list.themes || []);
        setTheme(null);
        setThemeName("");
        setThemeBrief(emptyBrief());
        if (data.site.installed) {
          setBuildersLoading(true);
          try {
            const plugins = await api.getSiteBuilders(siteId);
            if (!cancelled) setBuilders(plugins.builders || null);
          } catch (err) {
            if (!cancelled) {
              setBuilders({
                html: true,
                gutenberg: true,
                wpbakery: false,
                elementor: false,
                error: err.message,
              });
            }
          } finally {
            if (!cancelled) setBuildersLoading(false);
          }
        } else {
          setBuilders({ html: true, gutenberg: true, wpbakery: false, elementor: false });
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  useEffect(() => {
    if (!job?.id || (job.status !== "queued" && job.status !== "running")) return undefined;
    return subscribeJob(job.id, (event) => {
      setJob((current) => applyEvent(current, event));
    });
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (job?.kind === "install" && job.status === "done") {
      api.getSite(siteId).then((data) => {
        setSite(data.site);
        setSiteBrief({ ...emptyBrief(), ...data.site.brief, pages: mergePages(data.site.brief?.pages) });
        skipSiteSave.current = true;
        skipPageSave.current = true;
        setBuildersLoading(true);
        return api.getSiteBuilders(siteId);
      }).then((plugins) => {
        setBuilders(plugins.builders || null);
      }).catch(() => {}).finally(() => setBuildersLoading(false));
    }
  }, [job?.kind, job?.status, siteId]);

  useEffect(() => {
    if (job?.kind !== "theme" || job.status !== "done" || !theme?.id) return undefined;
    let cancelled = false;
    api.getTheme(siteId, theme.id).then((data) => {
      if (cancelled) return;
      skipThemeSave.current = true;
      setTheme(data.theme);
      setThemeName(data.theme.themeName || "");
      setThemeBrief({ ...emptyBrief(), ...data.theme.brief, pages: mergePages(data.theme.brief?.pages), logos: mergeLogos(data.theme.brief?.logos) });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job?.kind, job?.status, siteId, theme?.id]);

  useEffect(() => {
    if (!site?.id || site.installed) return undefined;
    if (skipSiteSave.current) {
      skipSiteSave.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      api.updateSite(site.id, siteBrief).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [site?.id, site?.installed, siteBrief]);

  useEffect(() => {
    if (!site?.id || !site.installed) return undefined;
    if (skipPageSave.current) {
      skipPageSave.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      api.updateSitePages(site.id, mergePages(siteBrief.pages)).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [site?.id, site?.installed, siteBrief.pages]);

  useEffect(() => {
    if (!site?.id || !theme?.id) return undefined;
    if (skipThemeSave.current) {
      skipThemeSave.current = false;
      return undefined;
    }
    const timer = setTimeout(() => {
      api.updateTheme(site.id, theme.id, { themeName, brief: themeBrief }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [site?.id, theme?.id, themeName, themeBrief]);

  useEffect(() => {
    const id = "wtg-google-fonts-preview";
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = googleFontsCssUrl(themeBrief.titleFont || DEFAULT_TITLE_FONT, themeBrief.textFont || DEFAULT_TEXT_FONT);
  }, [themeBrief.titleFont, themeBrief.textFont]);

  function patchSite(field, value) {
    setSiteBrief((current) => ({ ...current, [field]: value }));
  }

  function patchTheme(field, value) {
    setThemeBrief((current) => ({ ...current, [field]: value }));
  }

  function patchPage(key, field, value) {
    setSiteBrief((current) => {
      const pages = mergePages(current.pages);
      return {
        ...current,
        pages: {
          ...pages,
          [key]: { ...pages[key], [field]: value },
        },
      };
    });
  }

  function toggleFeature(id) {
    setThemeBrief((current) => {
      const features = { ...current.features, [id]: !current.features[id] };
      return { ...current, features, themeFeatures: featuresToText(features) };
    });
  }

  async function onSiteFile(file) {
    if (!file) return;
    const parsed = parseConfigText(await file.text());
    setSiteBrief((current) => ({ ...current, ...parsed }));
  }

  async function onThemeFile(file) {
    if (!file || !theme) return;
    const text = await file.text();
    const parsed = parseConfigText(text);
    const nameMatch = text.split(/\r?\n/).find((line) => /^THEME_NAME\s*[:=]/i.test(line.trim()));
    if (nameMatch) setThemeName(nameMatch.replace(/^THEME_NAME\s*[:=]\s*/i, "").trim());
    setThemeBrief((current) => ({ ...current, ...parsed, pages: mergePages(parsed.pages) }));
  }

  async function toggleDebug() {
    try {
      const status = await api.setDebug(!debugEnabled);
      setDebugEnabled(status.enabled);
    } catch (err) {
      setError(err.message);
    }
  }

  async function selectTheme(themeId) {
    if (!themeId) {
      setTheme(null);
      setThemeName("");
      setThemeBrief(emptyBrief());
      return;
    }
    skipThemeSave.current = true;
    const data = await api.getTheme(siteId, themeId);
    setTheme(data.theme);
    setThemeName(data.theme.themeName || "");
    setThemeBrief({ ...emptyBrief(), ...data.theme.brief, pages: mergePages(data.theme.brief?.pages), logos: mergeLogos(data.theme.brief?.logos) });
  }

  async function addTheme() {
    setBusy(true);
    setError("");
    try {
      const data = await api.createTheme(siteId, {});
      const list = await api.listThemes(siteId);
      setThemes(list.themes || []);
      skipThemeSave.current = true;
      setTheme(data.theme);
      setThemeName(data.theme.themeName || "");
      setThemeBrief({ ...emptyBrief(), ...data.theme.brief, pages: mergePages(data.theme.brief?.pages), logos: mergeLogos(data.theme.brief?.logos) });
      setThemeOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const installed = Boolean(site?.installed);
  const canInstall = baseSiteReady(siteBrief) && Boolean(health?.sshConfigured) && !busy;
  const jobRunning = job?.status === "queued" || job?.status === "running";
  const themeReady = installed && Boolean(theme?.id);
  const logos = mergeLogos(themeBrief.logos);
  const pageSettings = mergePages(siteBrief.pages);
  const formatOptions = useMemo(() => availablePageFormats(builders), [builders]);

  function pageFormat(key) {
    const current = pageSettings[key]?.format || "html";
    return formatOptions.some((item) => item.id === current) ? current : "html";
  }

  function pagesPayload() {
    return Object.fromEntries(
      PAGE_DEFS.map((def) => [
        def.key,
        { ...pageSettings[def.key], format: pageFormat(def.key) },
      ])
    );
  }

  function pageHasPrompt(key) {
    return Boolean(String(pageSettings[key]?.prompt || "").trim());
  }

  async function installBaseWp(e) {
    e.preventDefault();
    if (installed || !canInstall) return;
    setBusy(true);
    setError("");
    try {
      const payload = await api.installSite(siteId, siteBrief);
      setJob({
        id: payload.jobId,
        kind: "install",
        status: "running",
        steps: [],
        results: [],
        logs: [],
        error: null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateTheme(e) {
    e.preventDefault();
    if (!themeReady) return;
    setBusy(true);
    setError("");
    try {
      const payload = await api.generateTheme(siteId, theme.id, {
        themeName,
        brief: {
          ...themeBrief,
          themeFeatures: featuresToText(themeBrief.features) || themeBrief.themeFeatures,
          pages: pageSettings,
        },
      });
      setJob({
        id: payload.jobId,
        kind: "theme",
        status: "running",
        steps: [],
        results: [],
        logs: [],
        error: null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyThemeRecord(record) {
    skipThemeSave.current = true;
    setTheme(record);
    setThemeName(record.themeName || "");
    setThemeBrief({ ...emptyBrief(), ...record.brief, pages: mergePages(record.brief?.pages), logos: mergeLogos(record.brief?.logos) });
  }

  async function onLogoFile(file, input) {
    if (!file || !theme?.id) return;
    setLogoBusy(true);
    setError("");
    try {
      const data = await api.uploadThemeLogo(siteId, theme.id, file, {
        width: themeBrief.logoWidth,
        height: themeBrief.logoHeight,
        prompt: themeBrief.logoPrompt,
      });
      applyThemeRecord(data.theme);
    } catch (err) {
      setError(err.message);
    } finally {
      if (input) input.value = "";
      setLogoBusy(false);
    }
  }

  async function generateLogo() {
    if (!themeReady || !String(themeBrief.logoPrompt || "").trim()) return;
    setLogoBusy(true);
    setError("");
    try {
      const data = await api.generateThemeLogo(siteId, theme.id, {
        themeName,
        brief: {
          ...themeBrief,
          themeFeatures: featuresToText(themeBrief.features) || themeBrief.themeFeatures,
        },
      });
      applyThemeRecord(data.theme);
    } catch (err) {
      setError(err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function activateLogo(logoId) {
    if (!themeReady || !logoId || logoId === themeBrief.logoId || logoBusy) return;
    setLogoBusy(true);
    setError("");
    try {
      const data = await api.activateThemeLogo(siteId, theme.id, logoId);
      applyThemeRecord(data.theme);
    } catch (err) {
      setError(err.message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function generateAndPublishPage(pageKey) {
    if (!installed || !pageHasPrompt(pageKey)) return;
    setBusy(true);
    setError("");
    try {
      const payload = await api.generatePages(siteId, {
        themeId: theme?.id || "",
        pageKey,
        brief: {
          pages: pagesPayload(),
        },
      });
      setJob({
        id: payload.jobId,
        kind: "pages",
        pageKey,
        status: "running",
        steps: [],
        results: [],
        logs: [],
        error: null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pages = useMemo(() => uniqueBy(job?.results?.filter((r) => r.kind === "page") || [], "url"), [job]);
  const images = useMemo(() => uniqueBy(job?.results?.filter((r) => r.kind === "image") || [], "url"), [job]);
  const extras = useMemo(
    () => job?.results?.filter((r) => r.kind !== "page" && r.kind !== "image") || [],
    [job]
  );

  return (
    <div className="studio">
      <header className="top">
        <div>
          <p className="eyebrow">WP Theme Studio</p>
          <h1>{siteBrief.siteName || "New site"}</h1>
        </div>
        <div className="top-meta">
          <span>{user.username}</span>
          {health?.mockAi ? <span className="pill">Mock AI</span> : <span className="pill on">Live AI</span>}
          {health?.sshConfigured ? <span className="pill on">SSH key</span> : <span className="pill">SSH missing</span>}
          {installed ? <span className="pill on">WP installed</span> : <span className="pill">WP pending</span>}
          <label className="check debug-toggle">
            <input type="checkbox" checked={debugEnabled} onChange={toggleDebug} />
            Debug logs
          </label>
          {debugEnabled ? (
            <a className="pill on" href={withAuthUrl("/api/debug/download")}>
              Download log
            </a>
          ) : null}
          <button type="button" className="ghost" onClick={onBack}>
            All sites
          </button>
          <button type="button" className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <div className="layout">
        <div className="layout-left">
        <form className="panel" onSubmit={installBaseWp}>
          {!site ? (
            <section className="site-summary">
              <h2>Site</h2>
              <p className="hint">Loading site…</p>
            </section>
          ) : installed ? (
            <section className="site-summary">
              <div className="site-summary-head">
                <div>
                  <h2>Site</h2>
                  <p className="site-summary-name">{siteBrief.siteName || "Untitled site"}</p>
                  {siteBrief.wpSiteUrl ? (
                    <a className="site-summary-domain" href={siteBrief.wpSiteUrl} target="_blank" rel="noreferrer">
                      {siteBrief.wpSiteUrl}
                    </a>
                  ) : (
                    <p className="hint">No site domain</p>
                  )}
                </div>
                <button
                  type="button"
                  className="ghost site-summary-toggle"
                  onClick={() => setSiteSettingsOpen((open) => !open)}
                >
                  {siteSettingsOpen ? "Hide settings" : "Show settings"}
                </button>
              </div>
              {siteSettingsOpen ? (
                <fieldset className="locked-fields" disabled>
                  <SiteSettingsFields brief={siteBrief} includeCredentials />
                </fieldset>
              ) : null}
            </section>
          ) : (
            <section>
              <h2>Create base site</h2>
              <p className="hint">
                {health?.sshConfigured
                  ? `The studio connects over SSH with the private key (${health.sshHost}) and installs WordPress in the folder you specify.`
                  : "SSH is not configured. Add SSH_PRIVATE_KEY to .env, then reload."}
              </p>
              <fieldset className="locked-fields">
                <label className="drop">
                  <input type="file" accept=".txt,.conf,.wtg,.env" onChange={(e) => onSiteFile(e.target.files?.[0])} />
                  <span>Import site config</span>
                </label>
                <SiteSettingsFields brief={siteBrief} onChange={patchSite} />
                <button
                  type="submit"
                  className={busy || jobRunning ? "working" : ""}
                  disabled={!canInstall || jobRunning}
                >
                  {busy && !jobRunning
                    ? "Saving…"
                    : jobRunning && job?.kind === "install"
                      ? "Installing…"
                      : "Install Base WP"}
                </button>
              </fieldset>
            </section>
          )}
        </form>

        <div className="panel">
          <section className="site-summary">
            <div className="site-summary-head">
              <div>
                <h2>Theme</h2>
                <p className="site-summary-name">{themeName || theme?.themeName || "No theme selected"}</p>
                <p className="hint">
                  {installed
                    ? themeOpen
                      ? "Choose an existing theme for this site, or add a new one."
                      : "Generate a theme and activate it on WordPress."
                    : "Theme settings stay locked until base WordPress is installed."}
                </p>
              </div>
              <button
                type="button"
                className="ghost site-summary-toggle"
                aria-expanded={themeOpen}
                onClick={() => setThemeOpen((open) => !open)}
              >
                {themeOpen ? "Hide" : "Show"}
              </button>
            </div>
            {themeOpen ? (
            <>
            <div className="row">
              <label>
                Saved themes
                <select
                  value={theme?.id || ""}
                  disabled={!installed || busy}
                  onChange={(e) => selectTheme(e.target.value)}
                >
                  <option value="">Select a theme</option>
                  {themes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.themeName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="stack">
                <button type="button" className="ghost" disabled={!installed || busy} onClick={addTheme}>
                  Add new theme
                </button>
                {themeReady ? (
                  <a className="ghost button-link" href={withAuthUrl(`/api/sites/${siteId}/themes/${theme.id}/download`)}>
                    Download theme settings
                  </a>
                ) : null}
              </div>
            </div>
            <fieldset className="locked-fields" disabled={!themeReady}>
            <section>
              <h2>Brand</h2>
              <label className="drop">
                <input type="file" accept=".txt,.conf,.wtg,.env" onChange={(e) => onThemeFile(e.target.files?.[0])} />
                <span>Import theme config</span>
              </label>
              <label>
                Theme name
                <input value={themeName} onChange={(e) => setThemeName(e.target.value)} />
              </label>
              <div className="row">
                <label>
                  Primary color
                  <input
                    type="color"
                    value={safeColor(themeBrief.primaryColor)}
                    onChange={(e) => patchTheme("primaryColor", e.target.value)}
                  />
                </label>
                <label>
                  Secondary color
                  <input
                    type="color"
                    value={safeColor(themeBrief.secondaryColor)}
                    onChange={(e) => patchTheme("secondaryColor", e.target.value)}
                  />
                </label>
              </div>
              <label>
                Company name
                <input value={themeBrief.companyName} onChange={(e) => patchTheme("companyName", e.target.value)} />
              </label>
              <label>
                Area of business
                <input value={themeBrief.areaOfBusiness} onChange={(e) => patchTheme("areaOfBusiness", e.target.value)} />
              </label>
              <label>
                City
                <input value={themeBrief.city} onChange={(e) => patchTheme("city", e.target.value)} />
              </label>
              <div className="row">
                <label>
                  Phone number
                  <input value={themeBrief.phone} onChange={(e) => patchTheme("phone", e.target.value)} />
                </label>
                <label>
                  Public email
                  <input type="email" value={themeBrief.email} onChange={(e) => patchTheme("email", e.target.value)} />
                </label>
              </div>
            </section>

            <section>
              <h2>Logo</h2>
              <p className="hint">Upload a company logo or generate one from a prompt. Generation uses the theme colors, fonts, and style. Click a thumbnail to make it the active header logo.</p>
              <label className="drop">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  disabled={logoBusy || busy}
                  onChange={(e) => onLogoFile(e.target.files?.[0], e.target)}
                />
                <span>{logoBusy ? "Working…" : "Upload logo"}</span>
              </label>
              <div className="row">
                <label>
                  Width (px)
                  <input
                    type="number"
                    min="40"
                    max="800"
                    value={themeBrief.logoWidth ?? 240}
                    onChange={(e) => patchTheme("logoWidth", Number(e.target.value) || 240)}
                  />
                </label>
                <label>
                  Height (px)
                  <input
                    type="number"
                    min="24"
                    max="400"
                    value={themeBrief.logoHeight ?? 80}
                    onChange={(e) => patchTheme("logoHeight", Number(e.target.value) || 80)}
                  />
                </label>
              </div>
              <label>
                Logo prompt
                <textarea
                  className="short"
                  rows={3}
                  value={themeBrief.logoPrompt || ""}
                  onChange={(e) => patchTheme("logoPrompt", e.target.value)}
                  placeholder="Minimal geometric mark for a local bakery, deep green and cream, transparent background"
                />
              </label>
              <button
                type="button"
                className="ghost"
                onClick={generateLogo}
                disabled={!themeReady || logoBusy || busy || jobRunning || !String(themeBrief.logoPrompt || "").trim()}
              >
                {logoBusy ? "Working…" : "Generate logo"}
              </button>
              {logos.length ? (
                <div className="logo-grid">
                  {logos.map((logo) => (
                    <button
                      type="button"
                      key={logo.id}
                      className={`logo-thumb${logo.id === themeBrief.logoId ? " active" : ""}`}
                      disabled={!themeReady || logoBusy || busy}
                      title={logo.prompt || (logo.source === "uploaded" ? "Uploaded logo" : "Generated logo")}
                      onClick={() => activateLogo(logo.id)}
                    >
                      <img
                        src={withAuthUrl(`/api/sites/${siteId}/themes/${theme.id}/logos/${logo.id}?v=${encodeURIComponent(logo.createdAt || themeBrief.logoUpdatedAt || "")}`)}
                        alt=""
                      />
                      {logo.id === themeBrief.logoId ? <span className="logo-thumb-label">Active</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="logo-preview">
                  <span>No logos yet</span>
                </div>
              )}
            </section>

            <section>
              <h2>Fonts</h2>
              <p className="hint">Google Fonts used for titles and body text in the theme and generated pages.</p>
              <div className="row">
                <label>
                  Title font
                  <FontSelect
                    value={themeBrief.titleFont || DEFAULT_TITLE_FONT}
                    onChange={(value) => patchTheme("titleFont", value)}
                  />
                </label>
                <label>
                  Text font
                  <FontSelect
                    value={themeBrief.textFont || DEFAULT_TEXT_FONT}
                    onChange={(value) => patchTheme("textFont", value)}
                  />
                </label>
              </div>
              <div className="font-preview">
                <p
                  className="font-preview-title"
                  style={{ fontFamily: `"${themeBrief.titleFont || DEFAULT_TITLE_FONT}", Georgia, serif` }}
                >
                  {themeBrief.companyName || "Title preview"}
                </p>
                <p
                  className="font-preview-text"
                  style={{ fontFamily: `"${themeBrief.textFont || DEFAULT_TEXT_FONT}", system-ui, sans-serif` }}
                >
                  Body text uses this font across the theme, menus, and page copy.
                </p>
              </div>
            </section>

            <section>
              <h2>Theme features</h2>
              <div className="checks">
                {FEATURES.map((feature) => (
                  <label key={feature.id} className="check">
                    <input
                      type="checkbox"
                      checked={Boolean(themeBrief.features[feature.id])}
                      onChange={() => toggleFeature(feature.id)}
                    />
                    {feature.label}
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h2>Page style</h2>
              <p className="hint">These rules are applied to every generated page so they look consistent.</p>
              <label>
                Page style requirements
                <textarea
                  rows={5}
                  value={themeBrief.pageStyleRequirements || ""}
                  onChange={(e) => patchTheme("pageStyleRequirements", e.target.value)}
                  placeholder="Typography, spacing, cards, buttons, and section look that every page should follow."
                />
              </label>
            </section>

            <section>
              <h2>Additional requirements</h2>
              <label>
                Extra theme requirements
                <textarea
                  rows={6}
                  value={themeBrief.themeRequirements || ""}
                  onChange={(e) => patchTheme("themeRequirements", e.target.value)}
                  placeholder="Describe extra layout, tone, sections, or content the theme should include."
                />
              </label>
            </section>

            <button type="button" onClick={generateTheme} disabled={!themeReady || jobRunning || busy || logoBusy}>
              {jobRunning && job?.kind === "theme" ? "Generating and activating…" : "Generate theme and activate on WP"}
            </button>
            </fieldset>
            </>
            ) : null}
          </section>
        </div>

        <div className="panel">
          <section className="site-summary">
            <div className="site-summary-head">
              <div>
                <h2>Pages</h2>
                <p className="hint">
                  {!installed
                    ? "Page generation unlocks after WordPress is installed."
                    : buildersLoading
                      ? "Connecting to WordPress to see which page builders are installed…"
                      : pagesOpen
                        ? `Describe the page, then generate and publish it. Available formats: ${formatOptions.map((item) => item.label).join(", ")}.`
                        : "Generate and publish Home, About, Contact Us, or a custom page."}
                </p>
                {pagesOpen && builders?.error ? <p className="hint">Could not read plugins: {builders.error}</p> : null}
              </div>
              <button
                type="button"
                className="ghost site-summary-toggle"
                aria-expanded={pagesOpen}
                onClick={() => setPagesOpen((open) => !open)}
              >
                {pagesOpen ? "Hide" : "Show"}
              </button>
            </div>
          </section>
          {pagesOpen ? (
          <fieldset className="locked-fields" disabled={!installed}>
            {PAGE_DEFS.map((def) => (
              <section className="page-card" key={def.key}>
                <h3>{def.title}</h3>
                {def.custom ? (
                  <label>
                    Page title
                    <input
                      value={pageSettings[def.key]?.title || ""}
                      onChange={(e) => patchPage(def.key, "title", e.target.value)}
                      placeholder="Services"
                    />
                  </label>
                ) : null}
                <label>
                  Page prompt
                  <textarea
                    rows={4}
                    value={pageSettings[def.key]?.prompt || ""}
                    onChange={(e) => patchPage(def.key, "prompt", e.target.value)}
                    placeholder={`What should the ${def.title} page include?`}
                  />
                </label>
                <label>
                  Format
                  <select
                    value={pageFormat(def.key)}
                    onChange={(e) => patchPage(def.key, "format", e.target.value)}
                    disabled={buildersLoading}
                  >
                    {formatOptions.map((format) => (
                      <option key={format.id} value={format.id}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={jobRunning && job?.kind === "pages" && job?.pageKey === def.key ? "working" : ""}
                  onClick={() => generateAndPublishPage(def.key)}
                  disabled={!installed || !pageHasPrompt(def.key) || jobRunning || busy}
                >
                  {jobRunning && job?.kind === "pages" && job?.pageKey === def.key
                    ? "Generating and publishing…"
                    : "Generate and publish"}
                </button>
              </section>
            ))}
          </fieldset>
          ) : null}
        </div>

          {error ? <p className="error">{error}</p> : null}
        </div>

        <aside className="feed panel">
          <h2>Console</h2>
          {!job ? (
            <p className="hint">Install WordPress, generate and activate a theme, then generate and publish a page. Live output appears here, newest first.</p>
          ) : (
            <div className="console" role="log" aria-live="polite">
              {images.length || pages.length ? (
                <div className="console-outcome">
                  {images.length ? (
                    <div className="previews">
                      {images.map((image) => (
                        <figure key={image.url || image.title}>
                          <img src={withAuthUrl(image.previewUrl || image.url)} alt={image.alt || image.title} />
                          <figcaption>{image.title}</figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                  {pages.map((page) => (
                    <div className="console-page-link" key={page.url || page.title}>
                      <span>Page</span>
                      <a href={withAuthUrl(page.url)} target="_blank" rel="noreferrer">
                        {page.url}
                      </a>
                    </div>
                  ))}
                </div>
              ) : null}
              {(job.logs || []).map((entry, index) => (
                <div key={`${entry.at}-${index}`} className={`console-line ${entry.level || ""}`}>
                  <time dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time>
                  <div className="console-body">
                    <span>{entry.message}</span>
                    {entry.kind === "page" && entry.url ? (
                      <a href={withAuthUrl(entry.url)} target="_blank" rel="noreferrer">
                        {entry.url}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {job ? (
            <>
              <ol className="steps">
                {job.steps.map((step, index) => (
                  <li key={`${step.id}-${index}`} className={step.status}>
                    <strong>{labelStatus(step.status)}</strong>
                    <span>{step.message}</span>
                  </li>
                ))}
              </ol>
              {job.error ? <p className="error">{job.error}</p> : null}

              {extras.length ? (
                <div className="block">
                  <h3>Other</h3>
                  {extras.map((item, index) => (
                    <p key={`${item.title}-${index}`}>
                      {item.title}
                      {item.url ? (
                        <>
                          :{" "}
                          <a href={withAuthUrl(item.url)} target="_blank" rel="noreferrer">
                            {item.url}
                          </a>
                        </>
                      ) : null}
                      {item.detail ? <span className="hint"> — {item.detail}</span> : null}
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function SiteSettingsFields({ brief, onChange, includeCredentials = false }) {
  function patch(field, value) {
    onChange?.(field, value);
  }
  return (
    <>
      <label>
        WordPress folder
        <input
          placeholder="/home/deploy/public_html/site1"
          value={brief.wpRemotePath}
          onChange={(e) => patch("wpRemotePath", e.target.value)}
        />
      </label>
      <label>
        Site domain
        <input
          placeholder="http://localhost:8080/site1"
          value={brief.wpSiteUrl}
          onChange={(e) => patch("wpSiteUrl", e.target.value)}
        />
      </label>
      <label>
        Database host
        <input
          placeholder="db"
          value={brief.wpDbHost}
          onChange={(e) => patch("wpDbHost", e.target.value)}
        />
      </label>
      <label>
        Database name
        <input
          placeholder="site1"
          value={brief.wpDbName}
          onChange={(e) => patch("wpDbName", e.target.value)}
        />
      </label>
      <div className="row">
        <label>
          Database user
          <input
            placeholder="site1"
            value={brief.wpDbUser}
            onChange={(e) => patch("wpDbUser", e.target.value)}
          />
        </label>
        <label>
          Database password
          <input
            type="password"
            placeholder="site1pass"
            value={brief.wpDbPassword}
            onChange={(e) => patch("wpDbPassword", e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Admin email
          <input
            type="email"
            placeholder="admin@localhost.local"
            value={brief.wpAdminEmail}
            onChange={(e) => patch("wpAdminEmail", e.target.value)}
          />
        </label>
        <label>
          Admin password
          <input
            type="password"
            placeholder="adminpass"
            value={brief.wpAdminPassword || ""}
            onChange={(e) => patch("wpAdminPassword", e.target.value)}
            readOnly={includeCredentials}
          />
        </label>
      </div>
      <label>
        Editor email
        <input
          type="email"
          placeholder="editor@localhost.local"
          value={brief.wpEditorEmail}
          onChange={(e) => patch("wpEditorEmail", e.target.value)}
        />
      </label>
      <label>
        Site name
        <input
          placeholder="Oak & Iron Plumbing"
          value={brief.siteName}
          onChange={(e) => patch("siteName", e.target.value)}
        />
      </label>
      {includeCredentials ? (
        <div className="row">
          <label>
            WordPress username
            <input value={brief.wpUsername || ""} readOnly />
          </label>
          <label>
            Application password
            <input type="password" value={brief.wpAppPassword || ""} readOnly />
          </label>
        </div>
      ) : null}
    </>
  );
}

function applyEvent(current, event) {
  if (!current) return current;
  if (event.type === "snapshot") return { ...current, ...event.job, kind: event.job?.kind || current.kind, pageKey: event.job?.pageKey || current.pageKey };
  if (event.type === "status") {
    return { ...current, status: event.status, error: event.error || current.error };
  }
  if (event.type === "log") {
    const logs = current.logs || [];
    return { ...current, logs: [event, ...logs] };
  }
  if (event.type === "step") {
    const steps = [...current.steps];
    const existing = steps.findIndex((s) => s.id === event.id && s.status === "running");
    if (existing >= 0) steps[existing] = { ...steps[existing], ...event };
    else steps.push(event);
    return { ...current, steps };
  }
  if (event.type === "result") {
    return { ...current, results: [...current.results, event] };
  }
  return current;
}

function FontSelect({ value, onChange }) {
  const current = value || "";
  const known = GOOGLE_FONTS.some((font) => font.name === current);
  return (
    <select value={current} onChange={(e) => onChange(e.target.value)}>
      {!known && current ? <option value={current}>{current}</option> : null}
      {FONT_GROUPS.map((group) => (
        <optgroup key={group} label={group}>
          {GOOGLE_FONTS.filter((font) => font.category === group).map((font) => (
            <option key={font.name} value={font.name}>
              {font.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function uniqueBy(items, key) {
  const map = new Map();
  for (const item of items) map.set(item[key] || item.title || String(map.size), item);
  return [...map.values()];
}

function safeColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#1F4D3A";
}

function labelStatus(status) {
  if (status === "done") return "Done";
  if (status === "error") return "Failed";
  return "Running";
}

function formatTime(at) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
