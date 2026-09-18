const SLIDER_CSS = `.wtg-slider{position:relative;overflow:hidden;width:100%}
.wtg-slider .wtg-slides{display:flex;width:100%;margin:0;padding:0;transition:transform .4s ease}
.wtg-slider .wtg-slide{min-width:100%;flex:0 0 100%;box-sizing:border-box}
.wtg-slider .wtg-prev,.wtg-slider .wtg-next{position:absolute;top:50%;z-index:2;transform:translateY(-50%);background:rgba(255,255,255,.9);border:0;cursor:pointer;font-size:1.6rem;line-height:1;padding:.2rem .55rem}
.wtg-slider .wtg-prev{left:0}
.wtg-slider .wtg-next{right:0}`;

const SLIDER_JS = `(function(){
  function bind(root){
    if(!root||root.getAttribute("data-wtg-bound"))return;
    var track=root.querySelector(".wtg-slides");
    var slides=root.querySelectorAll(".wtg-slide");
    if(!track||!slides.length)return;
    root.setAttribute("data-wtg-bound","1");
    var i=0;
    function go(n){i=(n+slides.length)%slides.length;track.style.transform="translateX("+(-i*100)+"%)";}
    var prev=root.querySelector(".wtg-prev");
    var next=root.querySelector(".wtg-next");
    if(prev)prev.addEventListener("click",function(e){e.preventDefault();go(i-1);});
    if(next)next.addEventListener("click",function(e){e.preventDefault();go(i+1);});
  }
  function init(){document.querySelectorAll(".wtg-slider").forEach(bind);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();`;

function needsSlider(content) {
  return /\bwtg-slider\b/.test(String(content || ""));
}

function assetHtml(css, js) {
  let html = "";
  if (css) html += `<style id="wtg-page-css">${css}</style>`;
  if (js) html += `<script id="wtg-slider-runtime">${js}</script>`;
  return html;
}

function prependElementorHtml(content, html) {
  let data;
  try {
    data = JSON.parse(String(content || "[]"));
  } catch {
    return content;
  }
  const nodes = Array.isArray(data) ? data : [data];
  const widget = {
    id: "wtgcss01",
    elType: "widget",
    widgetType: "html",
    settings: { html },
  };
  nodes.unshift({
    id: "wtgcsssec",
    elType: "section",
    settings: {},
    elements: [
      {
        id: "wtgcsscol",
        elType: "column",
        settings: { _column_size: 100 },
        elements: [widget],
      },
    ],
  });
  return JSON.stringify(nodes);
}

function prependAsset(format, content, css, js) {
  const html = assetHtml(css, js);
  if (!html) return content;
  if (format === "gutenberg") {
    return `<!-- wp:html -->\n${html}\n<!-- /wp:html -->\n${content}`;
  }
  if (format === "wpbakery") {
    return `[vc_raw_html]${Buffer.from(html).toString("base64")}[/vc_raw_html]${content}`;
  }
  if (format === "elementor-free") {
    return prependElementorHtml(content, html);
  }
  return `${html}\n${content}`;
}

export function embedPageAssets(format, content, css = "") {
  const next = String(content || "");
  const slider = needsSlider(next);
  const cssParts = [];
  if (String(css || "").trim()) cssParts.push(String(css).trim());
  if (slider) cssParts.push(SLIDER_CSS);
  const pageCss = cssParts.join("\n");
  const injectCss = Boolean(pageCss) && !/id=["']wtg-page-css["']/.test(next);
  const injectJs = slider && !/id=["']wtg-slider-runtime["']/.test(next);
  if (!injectCss && !injectJs) return next;
  return prependAsset(format, next, injectCss ? pageCss : "", injectJs ? SLIDER_JS : "");
}
