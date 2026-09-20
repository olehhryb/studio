import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { PNG } from "pngjs";
import sharp from "sharp";
import { config } from "../config.js";
import { clampLogoSize } from "../configParser.js";
import { logHttp } from "../debugLog.js";
import { syncIfNeeded } from "../store/persist.js";
import { withAiTimeout } from "./timeouts.js";
import {
  themeSystemPrompt,
  themeUserPrompt,
  pagesSystemPrompt,
  pagesUserPrompt,
  pageSystemPrompt,
  pageUserPrompt,
  studioSiteSystemPrompt,
  studioSiteUserPrompt,
  cf7SystemPrompt,
  cf7UserPrompt,
} from "./prompts.js";

function client() {
  if (!config.openaiApiKey) return null;
  return new OpenAI({ apiKey: config.openaiApiKey });
}

function parseJson(text) {
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI did not return JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

async function chatJson(system, user, label = "chat") {
  const openai = client();
  if (!openai) return null;
  const started = Date.now();
  const requestBody = {
    model: config.openaiModel,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  try {
    const completion = await withAiTimeout(
      { kind: "chat", label, model: config.openaiModel },
      (signal) => openai.chat.completions.create(requestBody, { signal })
    );
    const content = completion.choices[0]?.message?.content || "";
    await logHttp({
      direction: "outbound",
      target: "openai",
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      status: 200,
      ms: Date.now() - started,
      requestBody,
      responseBody: {
        id: completion.id,
        model: completion.model,
        usage: completion.usage,
        content,
      },
    });
    return parseJson(content);
  } catch (err) {
    await logHttp({
      direction: "outbound",
      target: "openai",
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      ms: Date.now() - started,
      requestBody,
      error: err.message,
    });
    throw err;
  }
}

function mockTheme(brief) {
  return {
    tagline: `${brief.areaOfBusiness} in ${brief.city}`,
    css: `
.wtg-hero { padding: 4.5rem 0; }
.wtg-hero h1 { font-size: clamp(2.2rem, 5vw, 4rem); line-height: 1.1; max-width: 16ch; }
.wtg-kicker { letter-spacing: .18em; text-transform: uppercase; font-size: .75rem; color: var(--wtg-secondary); }
.wtg-btn { background: var(--wtg-primary); color: #fff; padding: .9rem 1.4rem; display: inline-block; text-decoration: none; }
.wtg-grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.wtg-card { background: #fff; padding: 1.25rem; }
.wtg-media img { width: 100%; height: auto; display: block; }
`,
  };
}

function mockPages(brief) {
  const co = brief.companyName;
  return {
    home: {
      title: "Home",
      html: `<section class="wtg-hero">
<p class="wtg-kicker">${brief.city}</p>
<h1>${co} — ${brief.areaOfBusiness}</h1>
<p>Trusted local service for homes and businesses in ${brief.city}. Call ${brief.phone}.</p>
<p><a class="wtg-btn" href="/contact-us">Request a visit</a></p>
<div class="wtg-media">[IMG id="home_hero" w="1600" h="900" alt="${co} team at work in ${brief.city}" prompt="Photorealistic editorial photo of ${brief.areaOfBusiness} professionals at work in ${brief.city}, natural light, 35mm, no text"]</div>
</section>
<section class="wtg-grid">
<div class="wtg-card"><h2>Local experts</h2><p>Based in ${brief.city}, we know the streets, the buildings, and the standards.</p></div>
<div class="wtg-card"><h2>Clear communication</h2><p>You get a named contact, a written scope, and photos of the finished work.</p></div>
<div class="wtg-card"><h2>Done properly</h2><p>Materials and methods chosen for longevity, not the cheapest day-rate.</p></div>
</section>
<section class="wtg-media">[IMG id="home_project" w="1400" h="900" alt="Recent project" prompt="Finished interior project related to ${brief.areaOfBusiness} in a ${brief.city} building, warm daylight, architectural photography, no text"]</section>`,
    },
    about: {
      title: "About Us",
      html: `<section class="wtg-hero">
<p class="wtg-kicker">About</p>
<h1>The story of ${co}</h1>
<p>${co} is a ${brief.city} ${brief.areaOfBusiness} studio built around craft, reliability, and neighbourhood reputation.</p>
<div class="wtg-media">[IMG id="about_workshop" w="1400" h="900" alt="${co} workshop" prompt="Documentary photo of a ${brief.areaOfBusiness} workshop in ${brief.city}, tools neatly arranged, window light, no text"]</div>
</section>
<section>
<h2>How we work</h2>
<p>Every job starts with a site visit. We photograph existing conditions, agree the brief, then schedule a crew that already knows the property type.</p>
<div class="wtg-media">[IMG id="about_people" w="1200" h="900" alt="The ${co} team" prompt="Portrait of a small professional ${brief.areaOfBusiness} team in ${brief.city}, candid, natural colours, no logos"]</div>
</section>`,
    },
    contact: {
      title: "Contact Us",
      html: `<section class="wtg-hero">
<p class="wtg-kicker">${brief.city}</p>
<h1>Contact ${co}</h1>
<p>${brief.phone}<br>${brief.email}</p>
<div class="wtg-media">[IMG id="contact_mapstyle" w="1600" h="800" alt="${brief.city} neighbourhood" prompt="Atmospheric street photograph of ${brief.city} neighbourhood, overcast British light, no signage text"]</div>
</section>
<section>
<h2>Send a message</h2>
{{CF7_FORM}}
</section>`,
    },
  };
}

function mockCf7(brief) {
  return {
    title: `Contact ${brief.companyName}`,
    form: `<label> Name
    [text* your-name autocomplete:name] </label>

<label> Email
    [email* your-email autocomplete:email] </label>

<label> Phone
    [tel your-phone autocomplete:tel] </label>

<label> Message
    [textarea* your-message] </label>

[submit "Send message"]`,
    mailSubject: `New enquiry from ${brief.companyName} website`,
    mailRecipient: brief.email,
    mailBodyHtml: `<!DOCTYPE html><html><body style="font-family:Georgia,serif;background:#f4f1ea;padding:24px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;padding:24px">
<tr><td>
<p style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#c45c26">New enquiry</p>
<h1 style="font-size:28px">${brief.companyName}</h1>
<p><strong>Name:</strong> [your-name]</p>
<p><strong>Email:</strong> [your-email]</p>
<p><strong>Phone:</strong> [your-phone]</p>
<p><strong>Message:</strong><br>[your-message]</p>
<p style="color:#666;font-size:13px">Sent from the ${_esc(brief.companyName)} website · [_site_title]</p>
</td></tr></table></body></html>`,
  };
}

function _esc(v) {
  return String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export async function generateThemeSpec(brief) {
  const data = await chatJson(themeSystemPrompt(), themeUserPrompt(brief), "theme");
  return data || mockTheme(brief);
}

export async function generatePages(brief) {
  const data = await chatJson(pagesSystemPrompt(), pagesUserPrompt(brief), "pages");
  return data || mockPages(brief);
}

export async function generatePage(brief, page) {
  const data = await chatJson(pageSystemPrompt(page.format), pageUserPrompt(brief, page), page.key || "page");
  return data || mockSinglePage(brief, page);
}

function mockStudioSite(brief, prompt) {
  const theme = mockTheme(brief);
  const pages = mockPages(brief);
  return {
    themeName: brief.companyName || brief.siteName || "Studio theme",
    companyName: brief.companyName || brief.siteName || "Studio",
    areaOfBusiness: brief.areaOfBusiness || String(prompt || "Business").slice(0, 80),
    city: brief.city || "Local",
    phone: brief.phone || "",
    email: brief.email || brief.wpEditorEmail || brief.wpAdminEmail || "",
    primaryColor: brief.primaryColor || "#1F4D3A",
    secondaryColor: brief.secondaryColor || "#C45C26",
    titleFont: brief.titleFont || "Playfair Display",
    textFont: brief.textFont || "Source Sans 3",
    tagline: theme.tagline,
    logoPrompt: `${brief.companyName || "Company"} logo, ${brief.areaOfBusiness || "business"}, clean, no text clutter`,
    themeRequirements: String(prompt || "").trim() || "Cohesive marketing site",
    pageStyleRequirements: "Match the theme colors, fonts, and card/button look on every page.",
    css: theme.css,
    pages: {
      home: { ...pages.home, prompt: "Home from full-site generate", css: "" },
      about: { ...pages.about, prompt: "About from full-site generate", css: "" },
      contact: { ...pages.contact, prompt: "Contact from full-site generate", css: "" },
    },
  };
}

export async function generateStudioSite(brief, prompt) {
  const data = await chatJson(studioSiteSystemPrompt(), studioSiteUserPrompt(brief, prompt), "studio");
  return data || mockStudioSite(brief, prompt);
}

function mockSinglePage(brief, page) {
  const html = `<section class="wtg-hero">
<p class="wtg-kicker">${brief.city}</p>
<h1>${page.title}</h1>
<p>${page.prompt || `${brief.companyName} — ${brief.areaOfBusiness} in ${brief.city}.`}</p>
<div class="wtg-media">[IMG id="${page.key}_hero" w="1600" h="900" alt="${page.title}" prompt="Photorealistic photo for ${brief.areaOfBusiness} in ${brief.city}, natural light, no text"]</div>
${page.key === "contact" ? "<section>{{CF7_FORM}}</section>" : ""}
</section>`;
  if (page.format === "gutenberg") {
    return {
      title: page.title,
      html,
      content: `<!-- wp:heading --><h1>${page.title}</h1><!-- /wp:heading -->
<!-- wp:paragraph --><p>${page.prompt || brief.areaOfBusiness}</p><!-- /wp:paragraph -->
<!-- wp:html -->[IMG id="${page.key}_hero" w="1600" h="900" alt="${page.title}" prompt="Photorealistic photo for ${brief.areaOfBusiness} in ${brief.city}, natural light, no text"]<!-- /wp:html -->
${page.key === "contact" ? "<!-- wp:shortcode -->{{CF7_FORM}}<!-- /wp:shortcode -->" : ""}`,
    };
  }
  if (page.format === "wpbakery") {
    return {
      title: page.title,
      html,
      content: `[vc_row][vc_column][vc_custom_heading text="${page.title}"][vc_column_text]${page.prompt || brief.areaOfBusiness}[/vc_column_text][vc_column_text][IMG id="${page.key}_hero" w="1600" h="900" alt="${page.title}" prompt="Photorealistic photo for ${brief.areaOfBusiness} in ${brief.city}, natural light, no text"][/vc_column_text]${page.key === "contact" ? "[vc_raw_html]{{CF7_FORM}}[/vc_raw_html]" : ""}[/vc_column][/vc_row]`,
    };
  }
  if (page.format === "elementor-free") {
    return {
      title: page.title,
      html,
      content: [
        {
          id: `${page.key}sec1`,
          elType: "section",
          settings: {},
          elements: [
            {
              id: `${page.key}col1`,
              elType: "column",
              settings: { _column_size: 100 },
              elements: [
                {
                  id: `${page.key}h1`,
                  elType: "widget",
                  widgetType: "heading",
                  settings: { title: page.title },
                },
                {
                  id: `${page.key}txt`,
                  elType: "widget",
                  widgetType: "text-editor",
                  settings: { editor: page.prompt || `${brief.companyName} in ${brief.city}` },
                },
                {
                  id: `${page.key}img`,
                  elType: "widget",
                  widgetType: "image",
                  settings: {
                    image: {
                      url: `[IMG id="${page.key}_hero" w="1600" h="900" alt="${page.title}" prompt="Photorealistic photo for ${brief.areaOfBusiness} in ${brief.city}, natural light, no text"]`,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
  }
  return { title: page.title, html, content: html };
}

export async function generateCf7(brief) {
  const data = await chatJson(cf7SystemPrompt(), cf7UserPrompt(brief), "cf7");
  return data || mockCf7(brief);
}

function parseImgAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m;
  while ((m = re.exec(raw || ""))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

export function parseImagePlaceholders(html) {
  const re = /\[IMG\b([^\]]*)\]/gi;
  const found = [];
  let m;
  while ((m = re.exec(String(html || "")))) {
    const attrs = parseImgAttrs(m[1]);
    found.push({
      token: m[0],
      id: String(attrs.id || `img_${found.length + 1}`).trim(),
      width: Number(attrs.w || attrs.width) || 1600,
      height: Number(attrs.h || attrs.height) || 900,
      alt: attrs.alt || "",
      prompt: attrs.prompt || attrs.alt || "photograph, natural light, no text overlay",
    });
  }
  return found;
}

export function uniqueImagePlaceholders(html) {
  const byId = new Map();
  const order = [];
  for (const item of parseImagePlaceholders(html)) {
    const existing = byId.get(item.id);
    if (!existing) {
      const rec = { ...item, tokens: [item.token] };
      byId.set(item.id, rec);
      order.push(rec);
      continue;
    }
    if (!existing.tokens.includes(item.token)) existing.tokens.push(item.token);
  }
  return order;
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  const v = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  return {
    r: parseInt(v.slice(0, 2), 16) || 31,
    g: parseInt(v.slice(2, 4), 16) || 77,
    b: parseInt(v.slice(4, 6), 16) || 58,
  };
}

function solidPngBuffer(width, height, hex) {
  const png = new PNG({ width, height });
  const { r, g, b } = hexToRgb(hex);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const mix = y / height;
      png.data[i] = Math.round(r * (1 - mix * 0.35));
      png.data[i + 1] = Math.round(g * (1 - mix * 0.35));
      png.data[i + 2] = Math.round(b * (1 - mix * 0.25));
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export async function writeSolidPng(filePath, width, height, hex) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, solidPngBuffer(width, height, hex));
}

async function writeWebpFile(filePath, input) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(input).webp({ quality: 82 }).toFile(filePath);
  await syncIfNeeded(filePath);
}

export async function writeLogoFile(filePath, input, width, height) {
  const w = clampLogoSize(width, 240, 40, 800);
  const h = clampLogoSize(height, 80, 24, 400);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(input)
    .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90 })
    .toFile(filePath);
  await syncIfNeeded(filePath);
  return { width: w, height: h };
}

function imageSize(model, width, height) {
  const ratio = (Number(width) || 1600) / (Number(height) || 900);
  if (/gpt-image/i.test(model || "")) {
    if (ratio > 1.3) return "1536x1024";
    if (ratio < 0.75) return "1024x1536";
    return "1024x1024";
  }
  if (ratio > 1.3) return "1792x1024";
  if (ratio < 0.75) return "1024x1792";
  return "1024x1024";
}

async function bufferFromImageResult(result) {
  const item = result.data?.[0] || {};
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to download generated image (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("No image returned");
}

export function logoPromptFor(brief, extra = "") {
  const asked = String(extra || brief.logoPrompt || "").trim();
  const company = brief.companyName || brief.siteName || "the company";
  const industry = brief.areaOfBusiness || "business";
  const city = brief.city || "their city";
  const width = Number(brief.logoWidth) || 240;
  const height = Number(brief.logoHeight) || 80;
  const ratio =
    width >= height * 1.4 ? "a wide horizontal header mark" : width <= height * 0.75 ? "a tall vertical mark" : "a compact square or slightly wide mark";
  const styleNotes = [brief.themeRequirements, brief.pageStyleRequirements].map((item) => String(item || "").trim()).filter(Boolean).join(". ");
  const user = asked || `Minimal professional logo for ${company}, ${industry}, clean geometric mark`;
  return [
    `Create a company logo that belongs to this WordPress theme.`,
    `User logo request (follow this first): ${user}`,
    `Brand: ${company}, ${industry} in ${city}.`,
    `Primary color ${brief.primaryColor || "#1F4D3A"}, secondary color ${brief.secondaryColor || "#C45C26"}.`,
    `Title font personality: ${brief.titleFont || "Playfair Display"}. Body font personality: ${brief.textFont || "Source Sans 3"}.`,
    `Theme features: ${brief.themeFeatures || "standard business site"}.`,
    styleNotes ? `Theme style notes: ${styleNotes}` : "",
    `Use as ${ratio} at about ${width}x${height} px for a website header.`,
    `Keep the mark on-brand with those colors and type feel. Flat vector company logo, transparent background, centered, no mockup, no photograph, no 3D scene, no extra UI, no watermarks.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function generateLogoFile(filePath, placeholder, brief) {
  const tmp = `${filePath}.src.webp`;
  const result = await generateImageFile(
    tmp,
    { ...placeholder, width: 1024, height: 1024 },
    brief
  );
  await writeLogoFile(filePath, tmp, placeholder.width, placeholder.height);
  await fs.unlink(tmp).catch(() => {});
  return result;
}

export async function generateImageFile(filePath, placeholder, brief) {
  const width = Math.min(Math.max(1, placeholder.width || 1600), 1600);
  const height = Math.min(Math.max(1, placeholder.height || 900), 900);
  const openai = client();
  if (!openai) {
    await writeWebpFile(filePath, solidPngBuffer(width, height, brief.primaryColor));
    return { mock: true };
  }
  const started = Date.now();
  const payload = {
    model: config.openaiImageModel,
    prompt: placeholder.prompt,
    size: imageSize(config.openaiImageModel, placeholder.width, placeholder.height),
  };
  try {
    const result = await withAiTimeout(
      { kind: "image", label: placeholder.id || "image", model: config.openaiImageModel },
      (signal) => openai.images.generate(payload, { signal })
    );
    const buf = await bufferFromImageResult(result);
    await logHttp({
      direction: "outbound",
      target: "openai",
      method: "POST",
      url: "https://api.openai.com/v1/images/generations",
      status: 200,
      ms: Date.now() - started,
      requestBody: {
        model: payload.model,
        prompt: payload.prompt,
        size: payload.size,
        id: placeholder.id,
      },
      responseBody: {
        bytes: buf.length,
        note: "image bytes omitted",
      },
    });
    await writeWebpFile(filePath, buf);
    return { mock: false };
  } catch (err) {
    await logHttp({
      direction: "outbound",
      target: "openai",
      method: "POST",
      url: "https://api.openai.com/v1/images/generations",
      ms: Date.now() - started,
      requestBody: {
        model: payload.model,
        prompt: payload.prompt,
        size: payload.size,
        id: placeholder.id,
      },
      error: err.message,
    });
    throw err;
  }
}
