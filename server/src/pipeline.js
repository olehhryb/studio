import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { config } from "./config.js";
import {
  addLog,
  addResult,
  addStep,
  failStep,
  finishStep,
  jobDir,
  emitJob,
} from "./jobs.js";
import {
  generateThemeSpec,
  generatePage,
  generateCf7,
  generateImageFile,
  generateLogoFile,
  logoPromptFor,
  uniqueImagePlaceholders,
  writeLogoFile,
} from "./ai/openai.js";
import { googleFontsPageCss } from "../../shared/googleFonts.js";
import { requestedPages } from "./configParser.js";
import { buildThemeZip } from "./theme/buildTheme.js";
import { embedPageAssets } from "./ai/pageChrome.js";
import {
  createCf7Form,
  setFrontPage,
  uploadMedia,
  upsertPage,
  wpPing,
  zipBridgePlugin,
} from "./wp/client.js";
import {
  applyElementorPageOverSsh,
  ensureCf7PluginOverSsh,
  installPluginZipOverSsh,
  ensurePrimaryMenuOverSsh,
  installThemeOverSsh,
  provisionWordPress,
  setThemeLogoOverSsh,
} from "./wp/provision.js";
import { markSiteInstalled, readThemeLogoPath, registerThemeLogo, themeLogoPath, themeLogoVariantPath } from "./store/configs.js";
import { withSsh } from "./ssh/client.js";

function replaceAll(value, token, replacement) {
  return String(value || "").split(token).join(replacement);
}

function escapeAttr(value) {
  return String(value || "").replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileSlug(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

function mediaSrc(img, uploadedById, jobId) {
  const uploaded = uploadedById[img.uid];
  if (typeof uploaded === "string") return uploaded;
  if (uploaded?.url) return uploaded.url;
  return localUrl(jobId, `images/${img.filename}`);
}

function imgTag(img, src) {
  const label = escapeAttr(img.caption || img.alt);
  return `<img class="wtg-img" src="${src}" alt="${label}" title="${label}" width="${img.width}" height="${img.height}" />`;
}

function tokenIsQuoted(text, index, token) {
  const before = text[index - 1];
  const after = text[index + token.length];
  return (before === '"' || before === "'") && after === before;
}

function applyToken(text, token, img, src, asTag) {
  let out = "";
  let rest = text;
  while (true) {
    const i = rest.indexOf(token);
    if (i < 0) break;
    const quoted = tokenIsQuoted(rest, i, token);
    const replacement = quoted || !asTag ? src : imgTag(img, src);
    out += rest.slice(0, i) + replacement;
    rest = rest.slice(i + token.length);
  }
  return out + rest;
}

function setHtmlAttr(attrs, name, value) {
  const re = new RegExp(`\\s${name}\\s*=\\s*(["'])[\\s\\S]*?\\1`, "i");
  const assignment = ` ${name}="${escapeAttr(value)}"`;
  if (re.test(attrs)) return attrs.replace(re, assignment);
  return `${attrs}${assignment}`;
}

function patchHtmlImgMeta(html, images, uploadedById, jobId) {
  let next = html;
  for (const img of images) {
    const src = mediaSrc(img, uploadedById, jobId);
    const caption = img.caption || img.alt;
    const re = new RegExp(`<img\\b([^>]*?)src=(["'])${escapeRegExp(src)}\\2([^>]*)>`, "gi");
    next = next.replace(re, (_full, pre, _q, post) => {
      let attrs = `${pre} src="${src}"${post}`;
      attrs = attrs.replace(/\/\s*$/, "").replace(/\s+/g, " ");
      attrs = setHtmlAttr(attrs, "alt", caption);
      attrs = setHtmlAttr(attrs, "title", caption);
      return `<img${attrs} />`;
    });
  }
  return next;
}

function walkElementor(nodes, visit) {
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const node of list) {
    if (!node || typeof node !== "object") continue;
    visit(node);
    if (Array.isArray(node.elements)) walkElementor(node.elements, visit);
  }
}

function enrichElementorImages(content, images, uploadedById, jobId) {
  let data;
  try {
    data = JSON.parse(stringifyContent(content));
  } catch {
    return stringifyContent(content);
  }
  const byUrl = new Map();
  for (const img of images) {
    byUrl.set(mediaSrc(img, uploadedById, jobId), img);
  }
  walkElementor(data, (node) => {
    const image = node.settings?.image;
    if (!image || typeof image !== "object") return;
    const img = byUrl.get(image.url);
    if (!img) return;
    const uploaded = uploadedById[img.uid];
    image.alt = img.caption;
    image.title = img.caption;
    if (uploaded?.id) image.id = uploaded.id;
  });
  return JSON.stringify(data);
}

function localUrl(jobId, filename) {
  const rel = String(filename)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/api/files/${jobId}/${rel}`;
}

function stringifyContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

function unescapeMarkup(value) {
  return stringifyContent(value).replace(/\\"/g, '"');
}

function applyImages(value, generatedImages, uploadedById, jobId, asTag = true) {
  let next = stringifyContent(value);
  for (const img of generatedImages) {
    const src = mediaSrc(img, uploadedById, jobId);
    const tokens = img.tokens?.length ? img.tokens : [img.token];
    for (const token of tokens) {
      next = applyToken(next, token, img, src, asTag);
    }
  }
  return asTag
    ? patchHtmlImgMeta(next, generatedImages, uploadedById, jobId)
    : enrichElementorImages(next, generatedImages, uploadedById, jobId);
}

export async function runInstallPipeline(job) {
  const brief = job.brief;

  try {
    job.status = "running";
    emitJob(job, { type: "status", status: "running" });

    if (!config.ssh?.configured) {
      throw new Error("SSH is not configured. Set SSH_PRIVATE_KEY in .env");
    }
    if (!brief.wpRemotePath || !brief.wpSiteUrl) {
      throw new Error("WordPress folder and site domain are required");
    }

    addStep(job, "ssh", `Installing base WordPress at ${brief.wpRemotePath}`);
    addLog(job, `Connecting over SSH as ${config.ssh.username}@${config.ssh.host}:${config.ssh.port} with the private key`);
    try {
      await withSsh(async (ssh) => {
        addLog(job, "SSH connection established");
        const provisioned = await provisionWordPress(ssh, brief, {
          onLog: (message) => addLog(job, message),
        });
        brief.wpUsername = provisioned.wpUsername;
        brief.wpAppPassword = provisioned.wpAppPassword;
        if (provisioned.adminPassword) brief.wpAdminPassword = provisioned.adminPassword;
        addResult(job, {
          kind: "info",
          title: provisioned.folderCreated ? "Remote folder created" : "Remote folder exists",
          detail: brief.wpRemotePath,
        });
        addResult(job, {
          kind: "info",
          title: "Editor user ready",
          detail: `${provisioned.wpUsername} (application password created)`,
        });
        addResult(job, {
          kind: "info",
          title: "Site URL",
          url: brief.wpSiteUrl,
        });
      });
      finishStep(job, "ssh", `WordPress is ready at ${brief.wpSiteUrl}`);
      addLog(job, "Base WordPress installed successfully.");
    } catch (err) {
      failStep(job, "ssh", err.message);
      addLog(job, `Base WordPress install failed: ${err.message}`);
      throw err;
    }

    if (job.siteId) {
      const saved = await markSiteInstalled(job.siteId, {
        wpUsername: brief.wpUsername,
        wpAppPassword: brief.wpAppPassword,
        wpAdminPassword: brief.wpAdminPassword,
      });
      addLog(job, `Site settings saved as ${saved.fileSlug}.conf`);
    }

    job.status = "done";
    emitJob(job, { type: "status", status: "done" });
  } catch (err) {
    job.status = "error";
    job.error = err.message;
    addLog(job, `Job failed: ${err.message}`);
    emitJob(job, { type: "status", status: "error", error: err.message });
    throw err;
  }
}

async function prepareThemeLogo(job, brief) {
  const dest = path.join(await jobDir(job.id), "logo.webp");
  let source = "";
  if (job.siteId && job.themeId) {
    source = await readThemeLogoPath(job.siteId, job.themeId);
  }
  if (source) {
    addLog(job, "Using the saved company logo");
    await writeLogoFile(dest, source, brief.logoWidth, brief.logoHeight);
    addResult(job, {
      kind: "image",
      title: "Logo",
      url: localUrl(job.id, "logo.webp"),
      previewUrl: localUrl(job.id, "logo.webp"),
      alt: brief.companyName || "Logo",
    });
    return dest;
  }
  if (!String(brief.logoPrompt || "").trim()) return "";

  addStep(job, "logo", "Generating the company logo");
  addLog(job, "Generating the company logo");
  const logoId = uuid();
  const stored = job.siteId && job.themeId ? themeLogoVariantPath(job.siteId, job.themeId, logoId) : dest;
  await generateLogoFile(
    stored,
    {
      id: "logo",
      prompt: logoPromptFor(brief),
      width: brief.logoWidth,
      height: brief.logoHeight,
    },
    brief
  );
  if (stored !== dest) await fs.copyFile(stored, dest);
  if (job.siteId && job.themeId) {
    await fs.mkdir(path.dirname(themeLogoPath(job.siteId, job.themeId)), { recursive: true });
    await fs.copyFile(stored, themeLogoPath(job.siteId, job.themeId));
    await registerThemeLogo(job.siteId, job.themeId, {
      id: logoId,
      source: "generated",
      prompt: brief.logoPrompt,
      activate: true,
    });
  }
  finishStep(job, "logo", "Logo generated");
  addResult(job, {
    kind: "image",
    title: "Logo",
    url: localUrl(job.id, "logo.webp"),
    previewUrl: localUrl(job.id, "logo.webp"),
    alt: brief.companyName || "Logo",
  });
  return dest;
}

export async function runThemePipeline(job) {
  const brief = job.brief;
  const dir = await jobDir(job.id);

  try {
    job.status = "running";
    emitJob(job, { type: "status", status: "running" });

    if (!config.ssh?.configured) {
      throw new Error("SSH is not configured. Set SSH_PRIVATE_KEY in .env");
    }
    if (!brief.wpRemotePath) {
      throw new Error("WordPress folder is required to install the theme");
    }

    brief.companyName = brief.companyName || brief.siteName;
    brief.email = brief.email || brief.wpEditorEmail || brief.wpAdminEmail;
    brief.areaOfBusiness = brief.areaOfBusiness || "Business";
    brief.city = brief.city || "Local";

    if (!brief.wpAppPassword) {
      addLog(job, "Refreshing WordPress credentials over SSH");
      await withSsh(async (ssh) => {
        const provisioned = await provisionWordPress(ssh, brief, {
          onLog: (message) => addLog(job, message),
        });
        brief.wpUsername = provisioned.wpUsername;
        brief.wpAppPassword = provisioned.wpAppPassword;
        if (provisioned.adminPassword) brief.wpAdminPassword = provisioned.adminPassword;
      });
    }

    addStep(job, "theme", "Asking AI to generate the theme");
    addLog(job, "Generating the WordPress theme");
    const themeSpec = await generateThemeSpec(brief);
    const logoFile = await prepareThemeLogo(job, brief);
    const theme = await buildThemeZip({ brief, themeSpec, outDir: dir, logoPath: logoFile });
    finishStep(job, "theme", `Theme packaged: ${theme.slug}.zip`);
    addLog(job, `Theme packaged: ${theme.slug}.zip`);
    addResult(job, {
      kind: "file",
      title: "WordPress theme ZIP",
      url: localUrl(job.id, path.basename(theme.zipPath)),
    });

    addStep(job, "theme-ssh", "Uploading theme over SSH, installing and activating it");
    addLog(job, `Uploading ${path.basename(theme.zipPath)} to the server`);
    try {
      await withSsh(async (ssh) => {
        const installed = await installThemeOverSsh(ssh, brief.wpRemotePath, theme.zipPath, path.basename(theme.zipPath), theme.slug);
        addLog(
          job,
          installed.replaced
            ? `Replaced installed theme ${installed.name || theme.slug} with a new version`
            : `Theme installed and activated: ${installed.name || theme.slug}`
        );
        if (logoFile) {
          try {
            const logo = await setThemeLogoOverSsh(ssh, brief.wpRemotePath, logoFile, brief.companyName || "Logo");
            addLog(job, `WordPress custom logo set (media ${logo.id})`);
          } catch (err) {
            addLog(job, `Theme includes the logo file; could not set the WordPress custom logo: ${err.message}`);
          }
        }
        try {
          const menu = await ensurePrimaryMenuOverSsh(ssh, brief.wpRemotePath);
          addLog(
            job,
            menu.items
              ? `Native WordPress menu "${menu.name}" assigned to Primary (${menu.items} pages)`
              : "Primary menu location registered; pages will be added when they are published"
          );
        } catch (err) {
          addLog(job, `Could not assign the WordPress menu: ${err.message}`);
        }
        const bridgeZip = await zipBridgePlugin();
        await installPluginZipOverSsh(ssh, brief.wpRemotePath, bridgeZip, "wtg-bridge.zip");
      });
      finishStep(job, "theme-ssh", `Theme activated: ${theme.slug}`);
      addResult(job, {
        kind: "info",
        title: "Theme installed and activated",
        detail: theme.slug,
      });
    } catch (err) {
      failStep(job, "theme-ssh", err.message);
      addLog(job, `Theme install failed: ${err.message}`);
      throw err;
    }

    job.status = "done";
    addLog(job, "Theme generated and activated on WordPress.");
    emitJob(job, { type: "status", status: "done" });
  } catch (err) {
    job.status = "error";
    job.error = err.message;
    addLog(job, `Job failed: ${err.message}`);
    emitJob(job, { type: "status", status: "error", error: err.message });
    throw err;
  }
}

export async function runPagesPipeline(job) {
  const brief = job.brief;
  const dir = await jobDir(job.id);
  const imagesDir = path.join(dir, "images");
  await fs.mkdir(imagesDir, { recursive: true });

  try {
    job.status = "running";
    emitJob(job, { type: "status", status: "running" });

    brief.companyName = brief.companyName || brief.siteName;
    brief.email = brief.email || brief.wpEditorEmail || brief.wpAdminEmail;
    brief.areaOfBusiness = brief.areaOfBusiness || "Business";
    brief.city = brief.city || "Local";

    const pages = requestedPages(brief.pages, job.pageKey || undefined);
    if (!pages.length) {
      throw new Error(job.pageKey ? "Enter a prompt for this page before generating" : "Enter a prompt for at least one page before generating");
    }

    if (!config.ssh?.configured) {
      throw new Error("SSH is not configured. Set SSH_PRIVATE_KEY in .env");
    }
    if (!brief.wpRemotePath) {
      throw new Error("WordPress folder is required to publish pages");
    }

    if (!brief.wpAppPassword) {
      addLog(job, "Refreshing WordPress credentials over SSH");
      await withSsh(async (ssh) => {
        const provisioned = await provisionWordPress(ssh, brief, {
          onLog: (message) => addLog(job, message),
        });
        brief.wpUsername = provisioned.wpUsername;
        brief.wpAppPassword = provisioned.wpAppPassword;
        if (provisioned.adminPassword) brief.wpAdminPassword = provisioned.adminPassword;
      });
    }

    const generated = [];
    for (const page of pages) {
      addStep(job, `page-${page.key}`, `Generating ${page.title} (${page.format})`);
      addLog(job, `Generating ${page.title} as ${page.format}`);
      const spec = await generatePage(brief, page);
      const pageCss = [googleFontsPageCss(brief.titleFont, brief.textFont), spec.css].filter(Boolean).join("\n");
      const html = embedPageAssets("html", unescapeMarkup(spec.html || spec.content || ""), pageCss);
      const content = embedPageAssets(page.format, unescapeMarkup(spec.content || spec.html || ""), pageCss);
      generated.push({
        ...page,
        title: spec.title || page.title,
        html,
        content,
      });
      finishStep(job, `page-${page.key}`, `${page.title} drafted`);
    }

    addStep(job, "scan", "Scanning generated pages for image requests");
    const generatedImages = [];
    for (const page of generated) {
      const items = uniqueImagePlaceholders(`${page.html}\n${page.content}`);
      page.images = items.map((item, i) => {
        const index = i + 1;
        const caption = `${page.title} ${index}`;
        return {
          ...item,
          uid: `${page.key}-${index}`,
          pageKey: page.key,
          pageTitle: page.title,
          index,
          caption,
          alt: caption,
          title: caption,
          filename: `${fileSlug(page.title)}-${index}.webp`,
        };
      });
      generatedImages.push(...page.images);
    }
    finishStep(
      job,
      "scan",
      generatedImages.length
        ? `Found ${generatedImages.length} image request${generatedImages.length === 1 ? "" : "s"}`
        : "No image requests on these pages"
    );

    if (generatedImages.length) {
      addStep(job, "images", "Generating WebP images from page prompts");
      for (const img of generatedImages) {
        const filePath = path.join(imagesDir, img.filename);
        const gen = await generateImageFile(filePath, img, brief);
        img.filePath = filePath;
        img.mock = gen.mock;
        addLog(job, `Generated WebP: ${img.caption}`);
      }
      finishStep(job, "images", `Generated ${generatedImages.length} WebP image${generatedImages.length === 1 ? "" : "s"}`);
    }

    let useMockWp = config.mockWp;
    let cf7Shortcode = "[contact-form-7]";
    const uploadedById = {};

    if (!useMockWp) {
      addStep(job, "wp", "Connecting to WordPress");
      try {
        await wpPing(brief);
        finishStep(job, "wp", `Authenticated to ${brief.wpSiteUrl}`);
      } catch (err) {
        addLog(job, `WordPress login failed (${err.message}). Refreshing credentials over SSH`);
        try {
          await withSsh(async (ssh) => {
            const provisioned = await provisionWordPress(ssh, brief, {
              onLog: (message) => addLog(job, message),
            });
            brief.wpUsername = provisioned.wpUsername;
            brief.wpAppPassword = provisioned.wpAppPassword;
            if (provisioned.adminPassword) brief.wpAdminPassword = provisioned.adminPassword;
          });
          if (job.siteId) {
            await markSiteInstalled(job.siteId, {
              wpUsername: brief.wpUsername,
              wpAppPassword: brief.wpAppPassword,
              wpAdminPassword: brief.wpAdminPassword,
            });
          }
          await wpPing(brief);
          finishStep(job, "wp", `Authenticated to ${brief.wpSiteUrl}`);
        } catch (retryErr) {
          failStep(job, "wp", `WordPress login failed: ${retryErr.message}`);
          useMockWp = true;
        }
      }
    }

    const needsContact = generated.some((page) => page.key === "contact");
    if (!useMockWp && needsContact) {
      addStep(job, "cf7", "Creating the Contact Form 7 form");
      try {
        await withSsh(async (ssh) => {
          await ensureCf7PluginOverSsh(ssh, brief.wpRemotePath);
        });
        const cf7 = await generateCf7(brief);
        const created = await createCf7Form(brief, cf7);
        cf7Shortcode = created.shortcode || cf7Shortcode;
        finishStep(job, "cf7", `Form created (${cf7Shortcode})`);
        addResult(job, { kind: "form", title: cf7.title, detail: cf7Shortcode });
      } catch (err) {
        failStep(job, "cf7", err.message);
        addLog(job, `CF7 setup failed: ${err.message}`);
      }
    }

    if (!useMockWp && generatedImages.length) {
      addStep(job, "media", "Uploading WebP images to the WordPress media library");
      try {
        for (const img of generatedImages) {
          const media = await uploadMedia(brief, img.filePath, img.filename, {
            mime: "image/webp",
            title: img.caption,
            alt: img.caption,
          });
          uploadedById[img.uid] = {
            url: media.source_url || media.guid?.rendered,
            id: media.id,
          };
        }
        finishStep(job, "media", "Images uploaded");
      } catch (err) {
        failStep(job, "media", `Media upload failed: ${err.message}`);
      }
    }

    for (const img of generatedImages) {
      const src = uploadedById[img.uid]?.url || localUrl(job.id, `images/${img.filename}`);
      addResult(job, {
        kind: "image",
        title: img.caption,
        alt: img.caption,
        previewUrl: src,
        url: src,
        pageKey: img.pageKey,
        mock: img.mock && !uploadedById[img.uid],
      });
      addLog(job, `Uploaded image: ${img.caption}`, {
        kind: "image",
        previewUrl: src,
        url: src,
        alt: img.caption,
      });
    }

    addStep(job, "rewrite", "Replacing image requests with uploaded URLs");
    for (const page of generated) {
      let html = replaceAll(page.html, "{{CF7_FORM}}", cf7Shortcode);
      let content = replaceAll(page.content, "{{CF7_FORM}}", cf7Shortcode);
      const pageImages = page.images || [];
      html = applyImages(html, pageImages, uploadedById, job.id, true);
      content = applyImages(content, pageImages, uploadedById, job.id, page.format !== "elementor-free");
      page.html = html;
      page.content = content;
      await fs.writeFile(path.join(dir, `${page.key}.html`), html);
      await fs.writeFile(path.join(dir, `${page.key}.content.txt`), content);
    }
    finishStep(job, "rewrite", "Page bodies are ready");

    addStep(job, "publish", "Publishing pages to WordPress");
    if (useMockWp) {
      for (const page of generated) {
        const url = localUrl(job.id, `${page.key}.html`);
        addResult(job, {
          kind: "page",
          title: page.title,
          url,
          pageKey: page.key,
          mock: true,
        });
        addLog(job, `Page: ${page.title}`, { kind: "page", url, title: page.title });
      }
      finishStep(job, "publish", "Local page HTML is ready to preview");
    } else {
      const createdPages = {};
      for (const page of generated) {
        const published = await upsertPage(brief, {
          title: page.title,
          slug: page.slug,
          content: page.format === "elementor-free" ? page.html : page.content,
        });
        createdPages[page.key] = published;
        if (page.format === "elementor-free") {
          addLog(job, `Applying Elementor Free layout to ${page.title}`);
          await withSsh(async (ssh) => {
            await applyElementorPageOverSsh(ssh, brief.wpRemotePath, published.id, page.content);
          });
        }
        const url = published.link;
        const title = published.title?.rendered || page.title;
        addResult(job, {
          kind: "page",
          title,
          url,
          detail: page.format,
          pageKey: page.key,
        });
        addLog(job, `Page: ${title}`, { kind: "page", url, title });
      }
      if (createdPages.home?.id) {
        try {
          await setFrontPage(brief, createdPages.home.id);
        } catch {
          addResult(job, {
            kind: "info",
            title: "Set homepage manually",
            detail: "The Home page was created; Settings → Reading could not be updated with this user.",
          });
        }
      }
      try {
        await withSsh(async (ssh) => {
          const menu = await ensurePrimaryMenuOverSsh(ssh, brief.wpRemotePath);
          if (menu.items) addLog(job, `Updated native WordPress menu "${menu.name}"`);
        });
      } catch (err) {
        addLog(job, `Could not update the WordPress menu: ${err.message}`);
      }
      finishStep(job, "publish", "Pages published on WordPress");
    }

    job.status = "done";
    addLog(job, pages.length === 1 ? `${pages[0].title} generated and published.` : "Pages generated.");
    emitJob(job, { type: "status", status: "done" });
  } catch (err) {
    job.status = "error";
    job.error = err.message;
    addLog(job, `Job failed: ${err.message}`);
    emitJob(job, { type: "status", status: "error", error: err.message });
    throw err;
  }
}
