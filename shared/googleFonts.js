export const DEFAULT_TEXT_FONT = "Source Sans 3";
export const DEFAULT_TITLE_FONT = "Playfair Display";

export const GOOGLE_FONTS = [
  { name: "Inter", category: "Sans" },
  { name: "Source Sans 3", category: "Sans" },
  { name: "Open Sans", category: "Sans" },
  { name: "Roboto", category: "Sans" },
  { name: "Lato", category: "Sans" },
  { name: "Montserrat", category: "Sans" },
  { name: "Poppins", category: "Sans" },
  { name: "Nunito", category: "Sans" },
  { name: "Nunito Sans", category: "Sans" },
  { name: "Work Sans", category: "Sans" },
  { name: "DM Sans", category: "Sans" },
  { name: "Plus Jakarta Sans", category: "Sans" },
  { name: "Outfit", category: "Sans" },
  { name: "Manrope", category: "Sans" },
  { name: "Figtree", category: "Sans" },
  { name: "Karla", category: "Sans" },
  { name: "Rubik", category: "Sans" },
  { name: "Raleway", category: "Sans" },
  { name: "Barlow", category: "Sans" },
  { name: "IBM Plex Sans", category: "Sans" },
  { name: "Libre Franklin", category: "Sans" },
  { name: "PT Sans", category: "Sans" },
  { name: "Noto Sans", category: "Sans" },
  { name: "Jost", category: "Sans" },
  { name: "Urbanist", category: "Sans" },
  { name: "Sora", category: "Sans" },
  { name: "Playfair Display", category: "Serif" },
  { name: "Fraunces", category: "Serif" },
  { name: "Cormorant Garamond", category: "Serif" },
  { name: "Libre Baskerville", category: "Serif" },
  { name: "Merriweather", category: "Serif" },
  { name: "Lora", category: "Serif" },
  { name: "Source Serif 4", category: "Serif" },
  { name: "EB Garamond", category: "Serif" },
  { name: "Spectral", category: "Serif" },
  { name: "Crimson Pro", category: "Serif" },
  { name: "Newsreader", category: "Serif" },
  { name: "DM Serif Display", category: "Serif" },
  { name: "Bitter", category: "Serif" },
  { name: "PT Serif", category: "Serif" },
  { name: "Roboto Slab", category: "Serif" },
  { name: "Zilla Slab", category: "Serif" },
  { name: "Alegreya", category: "Serif" },
  { name: "Instrument Serif", category: "Serif" },
  { name: "Oswald", category: "Display" },
  { name: "Bebas Neue", category: "Display" },
  { name: "Anton", category: "Display" },
  { name: "Archivo Black", category: "Display" },
  { name: "Cinzel", category: "Display" },
];

const FALLBACKS = {
  Sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Display: 'Georgia, serif',
};

export const FONT_GROUPS = [...new Set(GOOGLE_FONTS.map((font) => font.category))];

function knownFont(name) {
  const needle = String(name || "").trim().toLowerCase();
  return GOOGLE_FONTS.find((font) => font.name.toLowerCase() === needle) || null;
}

export function sanitizeGoogleFont(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 60) return fallback;
  return knownFont(cleaned)?.name || cleaned;
}

export function fontFallbackStack(name) {
  return FALLBACKS[knownFont(name)?.category] || FALLBACKS.Sans;
}

export function fontFamilyValue(name, fallback) {
  const font = sanitizeGoogleFont(name, fallback);
  return `"${font}", ${fontFallbackStack(font)}`;
}

function familyParam(name) {
  return `family=${encodeURIComponent(name).replace(/%20/g, "+")}:ital,wght@0,400;0,500;0,600;0,700`;
}

export function googleFontsCssUrl(titleFont, textFont) {
  const title = sanitizeGoogleFont(titleFont, DEFAULT_TITLE_FONT);
  const text = sanitizeGoogleFont(textFont, DEFAULT_TEXT_FONT);
  const families = title.toLowerCase() === text.toLowerCase() ? [title] : [title, text];
  return `https://fonts.googleapis.com/css2?${families.map(familyParam).join("&")}&display=swap`;
}

export function googleFontsPageCss(titleFont, textFont) {
  const title = sanitizeGoogleFont(titleFont, DEFAULT_TITLE_FONT);
  const text = sanitizeGoogleFont(textFont, DEFAULT_TEXT_FONT);
  return `@import url("${googleFontsCssUrl(title, text)}");
:root {
  --wtg-font-title: ${fontFamilyValue(title, DEFAULT_TITLE_FONT)};
  --wtg-font-text: ${fontFamilyValue(text, DEFAULT_TEXT_FONT)};
}
body, .wtg-page { font-family: var(--wtg-font-text); }
h1, h2, h3, h4, h5, h6, .wtg-page-title, .wtg-logo { font-family: var(--wtg-font-title); }`;
}
