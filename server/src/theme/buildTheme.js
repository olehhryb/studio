import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { writeSolidPng } from "../ai/openai.js";
import {
  DEFAULT_TEXT_FONT,
  DEFAULT_TITLE_FONT,
  fontFamilyValue,
  googleFontsCssUrl,
  sanitizeGoogleFont,
} from "../../../shared/googleFonts.js";

function slugify(name) {
  return String(name || "atelier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "atelier";
}

function phpString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function buildThemeZip({ brief, themeSpec, outDir, logoPath = "" }) {
  const slug = `wtg-${slugify(brief.companyName)}`;
  const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
  const themeDir = path.join(outDir, slug);
  await fs.mkdir(path.join(themeDir, "assets", "css"), { recursive: true });
  await fs.mkdir(path.join(themeDir, "assets", "js"), { recursive: true });
  await fs.mkdir(path.join(themeDir, "assets", "images"), { recursive: true });

  const files = themeFiles(brief, themeSpec, slug, version);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(themeDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  await writeSolidPng(path.join(themeDir, "screenshot.png"), 1200, 900, brief.primaryColor);
  if (logoPath) {
    await fs.copyFile(logoPath, path.join(themeDir, "assets", "images", "logo.webp"));
  }

  const zipPath = path.join(outDir, `${slug}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(themeDir, slug);
  zip.writeZip(zipPath);
  return { slug, themeDir, zipPath };
}

function themeFiles(brief, themeSpec, slug, version = "1.0.0") {
  const f = brief.features;
  const logoW = Number(brief.logoWidth) || 240;
  const logoH = Number(brief.logoHeight) || 80;
  const titleFont = sanitizeGoogleFont(brief.titleFont, DEFAULT_TITLE_FONT);
  const textFont = sanitizeGoogleFont(brief.textFont, DEFAULT_TEXT_FONT);
  const fontsUrl = googleFontsCssUrl(titleFont, textFont);
  const bodyClasses = [
    f.fullWidth ? "wtg-full-width" : "wtg-boxed",
    f.topbar ? "wtg-has-topbar" : "",
    f.contentContainer ? "wtg-content-container" : "",
    f.stickyHeader ? "wtg-sticky-header" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    "style.css": `/*
Theme Name: ${brief.companyName}
Theme URI: ${brief.wpSiteUrl}
Author: WP Theme Studio
Description: Generated theme for ${brief.companyName} — ${brief.areaOfBusiness} in ${brief.city}.
Version: ${version}
Text Domain: ${slug}
*/
`,
    "functions.php": `<?php
if (!defined('ABSPATH')) { exit; }

function ${phpFn(slug)}_setup() {
  add_theme_support('title-tag');
  add_theme_support('post-thumbnails');
  add_theme_support('html5', array('search-form', 'comment-form', 'gallery', 'caption'));
  add_theme_support('custom-logo', array(
    'height' => ${logoH},
    'width' => ${logoW},
    'flex-height' => true,
    'flex-width' => true,
  ));
  register_nav_menus(array('primary' => __('Primary', '${slug}')));
}
add_action('after_setup_theme', '${phpFn(slug)}_setup');

function ${phpFn(slug)}_assets() {
  wp_enqueue_style('${slug}-fonts', '${phpString(fontsUrl)}', array(), null);
  wp_enqueue_style('${slug}-main', get_template_directory_uri() . '/assets/css/main.css', array('${slug}-fonts'), '${version}');
  wp_enqueue_script('${slug}-main', get_template_directory_uri() . '/assets/js/main.js', array(), '${version}', true);
}
add_action('wp_enqueue_scripts', '${phpFn(slug)}_assets');
`,
    "header.php": `<?php if (!defined('ABSPATH')) { exit; } ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class('${bodyClasses}'); ?>>
<?php wp_body_open(); ?>
${
  f.topbar
    ? `<div class="wtg-topbar">
  <div class="wtg-wrap">
    <span><?php echo esc_html('${phpString(brief.city)}'); ?></span>
    <span><a href="tel:${phpString(brief.phone)}"><?php echo esc_html('${phpString(brief.phone)}'); ?></a></span>
    <span><a href="mailto:${phpString(brief.email)}"><?php echo esc_html('${phpString(brief.email)}'); ?></a></span>
  </div>
</div>`
    : ""
}
<header class="wtg-header">
  <div class="wtg-wrap">
    <div class="wtg-logo">
      <?php
      if (function_exists('the_custom_logo') && has_custom_logo()) {
        the_custom_logo();
      } elseif (file_exists(get_template_directory() . '/assets/images/logo.webp')) {
        echo '<a href="' . esc_url(home_url('/')) . '"><img src="' . esc_url(get_template_directory_uri() . '/assets/images/logo.webp') . '" alt="' . esc_attr(get_bloginfo('name')) . '" width="${logoW}" height="${logoH}"></a>';
      } else {
        echo '<a href="' . esc_url(home_url('/')) . '">' . esc_html(get_bloginfo('name')) . '</a>';
      }
      ?>
    </div>
    <button class="wtg-nav-toggle" type="button" aria-label="Menu">Menu</button>
    <nav class="wtg-nav" aria-label="Primary">
      <?php
      wp_nav_menu(array(
        'theme_location' => 'primary',
        'container' => false,
        'menu_class' => 'menu',
        'fallback_cb' => 'wp_page_menu',
      ));
      ?>
    </nav>
  </div>
</header>
<main class="wtg-main">
  <div class="wtg-wrap">
`,
    "footer.php": `  </div>
</main>
<footer class="wtg-footer">
  <div class="wtg-wrap">
    <p>&copy; <?php echo esc_html(date('Y')); ?> <?php bloginfo('name'); ?> · ${phpString(brief.city)}</p>
    <p>${phpString(brief.phone)} · ${phpString(brief.email)}</p>
  </div>
</footer>
<?php wp_footer(); ?>
</body>
</html>
`,
    "index.php": `<?php get_header(); ?>
<?php if (have_posts()) : while (have_posts()) : the_post(); ?>
  <article <?php post_class(); ?>>
    <h1><?php the_title(); ?></h1>
    <?php the_content(); ?>
  </article>
<?php endwhile; endif; ?>
<?php get_footer(); ?>
`,
    "front-page.php": `<?php get_header(); ?>
<?php if (have_posts()) : while (have_posts()) : the_post(); ?>
  <article class="wtg-page">
    <?php the_content(); ?>
  </article>
<?php endwhile; endif; ?>
<?php get_footer(); ?>
`,
    "page.php": `<?php get_header(); ?>
<?php if (have_posts()) : while (have_posts()) : the_post(); ?>
  <article class="wtg-page">
    <h1 class="wtg-page-title"><?php the_title(); ?></h1>
    <?php the_content(); ?>
  </article>
<?php endwhile; endif; ?>
<?php get_footer(); ?>
`,
    "assets/js/main.js": `document.addEventListener('click', function (e) {
  if (e.target.closest('.wtg-nav-toggle')) {
    document.body.classList.toggle('wtg-nav-open');
  }
});
`,
    "assets/css/main.css": cssFor(brief, themeSpec, { logoW, logoH, titleFont, textFont }),
  };
}

function phpFn(slug) {
  return slug.replace(/-/g, "_");
}

function cssFor(brief, themeSpec, { logoW, logoH, titleFont, textFont }) {
  return `:root {
  --wtg-primary: ${brief.primaryColor};
  --wtg-secondary: ${brief.secondaryColor};
  --wtg-ink: #161513;
  --wtg-paper: #f4f1ea;
  --wtg-max: ${brief.features.contentContainer ? "1120px" : "100%"};
  --wtg-font-title: ${fontFamilyValue(titleFont, DEFAULT_TITLE_FONT)};
  --wtg-font-text: ${fontFamilyValue(textFont, DEFAULT_TEXT_FONT)};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--wtg-font-text);
  color: var(--wtg-ink);
  background: var(--wtg-paper);
  line-height: 1.6;
}
h1, h2, h3, h4, h5, h6, .wtg-page-title, .wtg-logo {
  font-family: var(--wtg-font-title);
  letter-spacing: -.02em;
}
body.wtg-sticky-header .wtg-header {
  position: sticky; top: 0; z-index: 40; background: var(--wtg-paper);
}
.wtg-wrap { width: min(var(--wtg-max), calc(100% - 2.5rem)); margin: 0 auto; }
.wtg-topbar { background: var(--wtg-primary); color: #fff; font-size: .85rem; }
.wtg-topbar .wtg-wrap { display: flex; gap: 1.25rem; padding: .45rem 0; flex-wrap: wrap; }
.wtg-topbar a { color: #fff; text-decoration: none; }
.wtg-header { border-bottom: 1px solid rgba(22,21,19,.12); }
.wtg-header .wtg-wrap { display: flex; align-items: center; justify-content: space-between; padding: 1rem 0; gap: 1rem; }
.wtg-logo { font-size: 1.35rem; letter-spacing: -.02em; display: flex; align-items: center; }
.wtg-logo a { text-decoration: none; color: var(--wtg-ink); display: flex; align-items: center; }
.wtg-logo img, .wtg-logo .custom-logo { display: block; width: auto; height: auto; max-width: min(100%, ${logoW}px); max-height: ${logoH}px; }
.wtg-nav .menu, .wtg-nav > div, .wtg-nav ul { display: flex; gap: 1.25rem; list-style: none; margin: 0; padding: 0; }
.wtg-nav a { color: var(--wtg-ink); text-decoration: none; }
.wtg-nav .current-menu-item > a, .wtg-nav .current_page_item > a { color: var(--wtg-primary); }
.wtg-nav-toggle { display: none; }
.wtg-main { padding: 2.5rem 0 4rem; }
.wtg-footer { background: var(--wtg-primary); color: #fff; padding: 2rem 0; }
.wtg-page-title { font-size: clamp(2rem, 4vw, 3.2rem); line-height: 1.15; }
.wtg-page img { max-width: 100%; height: auto; }
@media (max-width: 720px) {
  .wtg-nav-toggle { display: block; background: none; border: 1px solid var(--wtg-ink); padding: .35rem .7rem; }
  .wtg-nav { display: none; }
  body.wtg-nav-open .wtg-nav { display: block; position: absolute; right: 1.25rem; top: 4.5rem; background: #fff; padding: 1rem; }
  body.wtg-nav-open .wtg-nav ul { flex-direction: column; }
}
${themeSpec.css || ""}
`;
}

export async function zipFolder(folder, zipPath, rootName) {
  const zip = new AdmZip();
  zip.addLocalFolder(folder, rootName);
  zip.writeZip(zipPath);
  return zipPath;
}
