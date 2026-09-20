export function themeSystemPrompt() {
  return `You are a senior WordPress theme designer. Return STRICT JSON only.
Generate CSS (no PHP) that customizes an existing theme skeleton. The skeleton already provides header, footer, topbar, navigation, and content wrappers.
Use CSS variables --wtg-primary, --wtg-secondary, --wtg-font-title, and --wtg-font-text. Do not include markdown.
Do not load extra fonts or override the chosen Google Fonts.`;
}

function extraRequirements(brief) {
  return String(brief.themeRequirements || "").trim() || "None";
}

function pageStyleRequirements(brief) {
  return String(brief.pageStyleRequirements || "").trim() || "None";
}

export function themeUserPrompt(brief) {
  return `Company: ${brief.companyName}
Business: ${brief.areaOfBusiness}
City: ${brief.city}
Primary: ${brief.primaryColor}
Secondary: ${brief.secondaryColor}
Title font: ${brief.titleFont || "Playfair Display"}
Text font: ${brief.textFont || "Source Sans 3"}
Features: ${brief.themeFeatures}
Additional requirements: ${extraRequirements(brief)}
Follow the additional requirements closely in CSS and layout personality.
Do not invent a custom navigation HTML list. The theme uses the native WordPress menu.

Return JSON:
{
  "tagline": "short tagline",
  "css": "additional CSS for personality, hero, sections, buttons, typography"
}`;
}

export function pagesSystemPrompt() {
  return `You write conversion-focused website HTML for WordPress page content (inner content only, no <html> or <body>).
Use semantic sections and inline-safe class names prefixed with wtg-.
If the page needs images, EVERY image MUST use this exact placeholder (never a real URL, never a finished <img src>):
[IMG id="unique_slug" w="1600" h="900" prompt="detailed photographic prompt including business, city, lighting, composition"]
Each placeholder is generated as WebP from the prompt, uploaded to WordPress, and replaced with the image URL. Do not set alt or title.
Include images only when they help the page (0-4).
Contact page must include the token {{CF7_FORM}} where the form belongs.
Return STRICT JSON only.`;
}

export function pagesUserPrompt(brief) {
  return `Company: ${brief.companyName}
Business: ${brief.areaOfBusiness}
City: ${brief.city}
Phone: ${brief.phone}
Email: ${brief.email}
Primary color: ${brief.primaryColor}
Secondary color: ${brief.secondaryColor}
Title font: ${brief.titleFont || "Playfair Display"}
Text font: ${brief.textFont || "Source Sans 3"}
Features: ${brief.themeFeatures}
Additional requirements: ${extraRequirements(brief)}
Shared page style: ${pageStyleRequirements(brief)}
Honour the additional requirements and shared page style in page structure, copy, and sections.

Return JSON:
{
  "home": { "title": "Home", "html": "..." },
  "about": { "title": "About Us", "html": "..." },
  "contact": { "title": "Contact Us", "html": "..." }
}`;
}

export function cf7SystemPrompt() {
  return `You create Contact Form 7 form markup and an HTML email notification.
Return STRICT JSON only. CF7 tags only in "form". HTML email in "mailBodyHtml".`;
}

export function cf7UserPrompt(brief) {
  return `Company: ${brief.companyName}
Business: ${brief.areaOfBusiness}
City: ${brief.city}
Notify email: ${brief.email}

Return JSON:
{
  "title": "Contact ${brief.companyName}",
  "form": "CF7 markup with your-name, your-email, your-phone, your-message, submit",
  "mailSubject": "New enquiry from ${brief.companyName} website",
  "mailRecipient": "${brief.email}",
  "mailBodyHtml": "<html>...use [_site_title], [your-name], [your-email], [your-phone], [your-message]...</html>"
}`;
}

const SLIDER_MARKUP = `<div class="wtg-slider">
  <div class="wtg-slides">
    <div class="wtg-slide">review 1</div>
    <div class="wtg-slide">review 2</div>
    <div class="wtg-slide">review 3</div>
    <div class="wtg-slide">review 4</div>
  </div>
  <button type="button" class="wtg-prev" aria-label="Previous">Prev</button>
  <button type="button" class="wtg-next" aria-label="Next">Next</button>
</div>`;

function sliderInstructions(format) {
  const wrap =
    format === "gutenberg"
      ? "Put this markup inside one <!-- wp:html --> block."
      : format === "wpbakery"
        ? "Put this markup inside [vc_raw_html]."
        : format === "elementor-free"
          ? "Put this markup in an Elementor html widget."
          : "Put this markup in the page HTML.";
  return `If the request includes a slider, carousel, or testimonials slider, you MUST use these exact class names (no plugins, no CDN, no custom slider JS):
${SLIDER_MARKUP}
${wrap}
Show one slide at a time. Slider CSS/JS are attached automatically; still style the reviews in page CSS.`;
}

function formatInstructions(format) {
  if (format === "gutenberg") {
    return `Write WordPress Gutenberg block markup only.
Allowed blocks: <!-- wp:heading -->, <!-- wp:paragraph -->, <!-- wp:columns -->, <!-- wp:column -->, <!-- wp:image -->, <!-- wp:buttons -->, <!-- wp:button -->, <!-- wp:group -->, <!-- wp:quote -->, <!-- wp:html -->, <!-- wp:separator -->.
For a 3-column services row use wp:columns with three wp:column blocks. Each column: image, then title, then short text.
${sliderInstructions("gutenberg")}
Put ALL page-specific CSS in "css" and also in an opening <!-- wp:html --> <style> block. Do not rely on editing theme CSS files.
For images, put the [IMG ...] token as src="[IMG ...]" on an <img> (inside wp:html or wp:image). Never invent a real URL.
"content" is the block markup. "html" is a simple HTML fallback of the same page.`;
  }
  if (format === "wpbakery") {
    return `Write WPBakery / Visual Composer shortcodes only ([vc_row][vc_column][vc_column_text]...[/vc_column_text][/vc_column][/vc_row], plus vc_custom_heading, vc_btn, vc_single_image, vc_raw_html).
${sliderInstructions("wpbakery")}
Put ALL page-specific CSS in "css". "content" is the shortcode markup. "html" is a simple HTML fallback of the same page.`;
  }
  if (format === "elementor-free") {
    return `Write Elementor Free JSON only. "content" must be a JSON array of Elementor elements using free widgets only (heading, text-editor, image, button, divider, spacer, icon-box, html, shortcode).
Use this shape: [{"id":"hex8","elType":"section","settings":{},"elements":[{"id":"hex8","elType":"column","settings":{"_column_size":100},"elements":[{"id":"hex8","elType":"widget","widgetType":"heading","settings":{"title":"..."}}]}]}].
${sliderInstructions("elementor-free")}
Put ALL page-specific CSS in "css". "html" is a simple HTML fallback of the same page.`;
  }
  return `Write semantic inner HTML only (no <html> or <body>), class names prefixed with wtg-.
${sliderInstructions("html")}
Put ALL page-specific CSS in "css" and in a <style> tag at the top of the HTML. Do not rely on editing theme CSS files.
"content" and "html" should both be that HTML.`;
}

export function pageSystemPrompt(format) {
  return `You write one WordPress page in the requested builder format. Return STRICT JSON only.
${formatInstructions(format)}
If the page needs images, EVERY image MUST use this exact placeholder (never a real URL):
[IMG id="unique_slug" w="1600" h="900" prompt="detailed photographic prompt including business, city, lighting, composition"]
Put the token where the image belongs (HTML: standalone or src="[IMG ...]"; Elementor: settings.image.url).
Each placeholder is generated as WebP from the prompt, uploaded to WordPress, and replaced with the image URL. Do not set alt or title.
Include images only when they help the user's request (0-4).
If this is a contact page, include the token {{CF7_FORM}} where the form belongs.
Page CSS must live on the page (style block + "css" field), using the brand colors. Never ask the user to change theme CSS files.`;
}

export function studioSiteSystemPrompt() {
  return `You design one complete marketing website as HTML, then SPLIT that design into a WordPress theme and page bodies.
Think of a single homepage-to-contact site first (header, nav, footer, shared CSS, then each page's main content). Do not return one combined HTML document.
The theme skeleton already has header, footer, topbar, and the native WordPress menu. Theme CSS only adds personality (hero, sections, buttons, cards, typography). Use --wtg-primary, --wtg-secondary, --wtg-font-title, --wtg-font-text. Do not load extra fonts.
Page HTML is inner content only (no <html> or <body>), class names prefixed with wtg-. Put page-specific CSS in each page's "css" and in a <style> tag at the top of that page HTML.
If a page needs images, EVERY image MUST use this exact placeholder (never a real URL):
[IMG id="unique_slug" w="1600" h="900" prompt="detailed photographic prompt including business, city, lighting, composition"]
0-3 images per page. Contact page MUST include {{CF7_FORM}} where the form belongs.
If a slider is needed, use class names wtg-slider, wtg-slides, wtg-slide, wtg-prev, wtg-next.
Return STRICT JSON only.`;
}

export function studioSiteUserPrompt(brief, prompt) {
  return `Existing site context (use when helpful, invent the rest from the customer prompt):
Company: ${brief.companyName || brief.siteName || ""}
Business: ${brief.areaOfBusiness || ""}
City: ${brief.city || ""}
Phone: ${brief.phone || ""}
Email: ${brief.email || brief.wpEditorEmail || brief.wpAdminEmail || ""}
Primary: ${brief.primaryColor || "#1F4D3A"}
Secondary: ${brief.secondaryColor || "#C45C26"}
Title font: ${brief.titleFont || "Playfair Display"}
Text font: ${brief.textFont || "Source Sans 3"}

Customer prompt for the whole website:
${prompt}

Return JSON:
{
  "themeName": "short theme name",
  "companyName": "",
  "areaOfBusiness": "",
  "city": "",
  "phone": "",
  "email": "",
  "primaryColor": "#hex",
  "secondaryColor": "#hex",
  "titleFont": "Google Font name",
  "textFont": "Google Font name",
  "tagline": "short tagline",
  "logoPrompt": "logo generation prompt matching the theme",
  "themeRequirements": "shared chrome / header / footer personality",
  "pageStyleRequirements": "shared rules so every page matches",
  "css": "theme CSS only (no PHP, no @font-face)",
  "pages": {
    "home": { "title": "Home", "prompt": "one-line summary", "html": "inner HTML", "css": "page CSS" },
    "about": { "title": "About Us", "prompt": "one-line summary", "html": "inner HTML", "css": "page CSS" },
    "contact": { "title": "Contact Us", "prompt": "one-line summary", "html": "inner HTML", "css": "page CSS" }
  }
}`;
}

export function pageUserPrompt(brief, page) {
  return `Company: ${brief.companyName}
Business: ${brief.areaOfBusiness}
City: ${brief.city}
Phone: ${brief.phone}
Email: ${brief.email}
Primary color: ${brief.primaryColor}
Secondary color: ${brief.secondaryColor}
Title font: ${brief.titleFont || "Playfair Display"}
Text font: ${brief.textFont || "Source Sans 3"}
Theme extra requirements: ${extraRequirements(brief)}
Shared page style (apply so this page matches other pages): ${pageStyleRequirements(brief)}
Page: ${page.title}
Format: ${page.format}
User request for this page:
${page.prompt}

Return JSON:
{
  "title": "${page.title}",
  "content": "page body in the requested format",
  "html": "simple HTML fallback",
  "css": "page-scoped CSS for layout, type, buttons, cards, slider, using the brand colors and --wtg-font-title / --wtg-font-text"
}`;
}
