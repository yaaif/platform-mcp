function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
const LOGO_SVG = `<svg class="ycb-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="YAA\\F">
  <defs>
    <linearGradient id="ycb-bg" x1="132" y1="96" x2="904" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B4E66"/>
      <stop offset=".52" stop-color="#0C7795"/>
      <stop offset="1" stop-color="#0B2F5B"/>
    </linearGradient>
    <linearGradient id="ycb-glyph" x1="286" y1="272" x2="738" y2="742" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F8FEFF"/>
      <stop offset="1" stop-color="#C5FAFF"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="220" fill="url(#ycb-bg)"/>
  <circle cx="512" cy="512" r="286" fill="none" stroke="#B9F7FF" stroke-opacity=".22" stroke-width="36"/>
  <g fill="none" stroke="url(#ycb-glyph)" stroke-width="108" stroke-linecap="round" stroke-linejoin="round">
    <path d="M332 320L512 496L692 320"/>
    <path d="M512 496V704"/>
  </g>
  <circle cx="332" cy="320" r="34" fill="#FFB14A"/>
  <circle cx="692" cy="320" r="34" fill="#FFC96D"/>
  <circle cx="512" cy="704" r="34" fill="#9CF8FF"/>
</svg>`;
export function renderLoginCallbackPage(opts) {
    const heading = escapeHtml(opts.heading);
    const message = escapeHtml(opts.message);
    const title = opts.ok ? "YAA\\F · Signed in" : "YAA\\F · Sign-in failed";
    const badge = opts.ok ? "Signed in" : "Sign-in failed";
    const icon = opts.ok
        ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.2 12.4 2.5 2.5 5.1-5.3"/></svg>`
        : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>`;
    const detail = opts.detail
        ? `<p class="ycb-detail">Signed in to <code>${escapeHtml(opts.detail)}</code></p>`
        : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0C7795">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --ycb-fg: hsl(201 50% 17%);
  --ycb-muted: hsl(200 25% 38%);
  --ycb-card: hsl(0 0% 100% / 0.94);
  --ycb-border: hsl(197 35% 82%);
  --ycb-primary: hsl(198 82% 36%);
  --ycb-primary-fg: hsl(180 100% 98%);
  --ycb-ok: #0d8a5b;
  --ycb-ok-bg: hsl(160 50% 94%);
  --ycb-err: #b42318;
  --ycb-err-bg: hsl(4 80% 96%);
  --ycb-page-top: hsl(48 100% 99%);
  --ycb-page-bottom: hsl(198 55% 97%);
  --ycb-grid: rgba(64, 122, 148, 0.045);
  --ycb-glow: hsl(198 82% 36% / 0.12);
  --ycb-shadow: 0 28px 70px -40px rgba(10, 24, 36, 0.5);
  --ycb-code-bg: hsl(198 40% 96%);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ycb-fg: hsl(210 40% 96%);
    --ycb-muted: hsl(210 16% 70%);
    --ycb-card: hsl(214 28% 12% / 0.94);
    --ycb-border: hsl(214 18% 28%);
    --ycb-primary: hsl(193 92% 55%);
    --ycb-primary-fg: hsl(212 30% 10%);
    --ycb-ok: #3dd68c;
    --ycb-ok-bg: hsl(160 35% 16%);
    --ycb-err: #f97066;
    --ycb-err-bg: hsl(4 40% 16%);
    --ycb-page-top: hsl(212 30% 8%);
    --ycb-page-bottom: hsl(214 28% 10%);
    --ycb-grid: rgba(124, 184, 208, 0.075);
    --ycb-glow: hsl(193 92% 55% / 0.16);
    --ycb-shadow: 0 28px 70px -36px rgba(2, 11, 15, 0.75);
    --ycb-code-bg: hsl(214 22% 16%);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1.25rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  font-family: "Space Grotesk", system-ui, sans-serif;
  color: var(--ycb-fg);
  background:
    repeating-linear-gradient(0deg, var(--ycb-grid) 0 1px, transparent 1px 36px),
    repeating-linear-gradient(90deg, var(--ycb-grid) 0 1px, transparent 1px 36px),
    radial-gradient(circle at 50% 0%, var(--ycb-glow), transparent 42%),
    linear-gradient(180deg, var(--ycb-page-top), var(--ycb-page-bottom));
}
.ycb-card {
  width: min(100%, 26rem);
  background: var(--ycb-card);
  border: 1px solid var(--ycb-border);
  border-radius: 1.1rem;
  box-shadow: var(--ycb-shadow);
  padding: 1.85rem 1.7rem 1.5rem;
  text-align: center;
  animation: ycb-in .35s ease;
}
@keyframes ycb-in {
  from { opacity: 0; transform: translateY(8px) scale(.98); }
  to { opacity: 1; transform: none; }
}
.ycb-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  margin-bottom: 1.35rem;
}
.ycb-brand-mark { display: flex; align-items: center; gap: .65rem; }
.ycb-logo {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: .7rem;
  display: block;
}
.ycb-wordmark {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
  letter-spacing: -.02em;
}
.ycb-badge {
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  margin: 0 0 .85rem;
  padding: .32rem .75rem;
  border-radius: 999px;
  font-size: .78rem;
  font-weight: 600;
}
.ycb-ok .ycb-badge { background: var(--ycb-ok-bg); color: var(--ycb-ok); }
.ycb-err .ycb-badge { background: var(--ycb-err-bg); color: var(--ycb-err); }
h1 {
  margin: 0 0 .45rem;
  font-size: 1.5rem;
  letter-spacing: -.03em;
  line-height: 1.2;
}
.ycb-copy, .ycb-detail, .ycb-return {
  margin: 0 0 .65rem;
  color: var(--ycb-muted);
  line-height: 1.5;
  font-size: .95rem;
}
.ycb-return { margin-bottom: 0; }
code {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .76rem;
  background: var(--ycb-code-bg);
  border: 1px solid var(--ycb-border);
  border-radius: .4rem;
  padding: .12rem .38rem;
  color: var(--ycb-fg);
  word-break: break-all;
}
.ycb-close {
  margin-top: 1.2rem;
  width: 100%;
  appearance: none;
  border: 0;
  border-radius: .75rem;
  padding: .78rem 1.1rem;
  background: var(--ycb-primary);
  color: var(--ycb-primary-fg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.ycb-close:hover { filter: brightness(.96); }
.ycb-fallback {
  display: none;
  margin-top: 1.2rem;
  color: var(--ycb-muted);
  line-height: 1.5;
  font-size: .95rem;
}
.ycb-fallback.is-visible { display: block; }
.ycb-close.is-hidden { display: none; }
</style>
</head>
<body class="${opts.ok ? "ycb-ok" : "ycb-err"}">
  <main class="ycb-card">
    <div class="ycb-brand">
      <div class="ycb-brand-mark">${LOGO_SVG}<p class="ycb-wordmark">YAA\\F</p></div>
    </div>
    <div class="ycb-badge">${icon}${escapeHtml(badge)}</div>
    <h1>${heading}</h1>
    <p class="ycb-copy">${message}</p>
    ${detail}
    <p class="ycb-return">You can close this window and continue.</p>
    <button class="ycb-close" id="ycb-close" type="button">Close window</button>
    <p class="ycb-fallback" id="ycb-fallback" hidden>Your browser will not close this tab. Close it to continue.</p>
  </main>
  <script>
(function () {
  var closeBtn = document.getElementById("ycb-close");
  var fallback = document.getElementById("ycb-fallback");
  function showFallback() {
    if (closeBtn) {
      closeBtn.classList.add("is-hidden");
      closeBtn.setAttribute("hidden", "");
    }
    if (fallback) {
      fallback.removeAttribute("hidden");
      fallback.classList.add("is-visible");
    }
  }
  function tryClose() {
    try { window.close(); } catch (e) {}
    window.setTimeout(function () {
      if (!document.hidden) showFallback();
    }, 250);
  }
  if (closeBtn) closeBtn.addEventListener("click", tryClose);
  ${opts.ok ? "tryClose();" : ""}
})();
  </script>
</body>
</html>`;
}
