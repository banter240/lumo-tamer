/**
 * Shared HTML shell for /auth and /config.
 * Colors follow Proton's public site: purple CTA, light canvas, tight cards.
 * Theme is stored in localStorage (`lumo-tamer-theme`); first visit follows the OS.
 */

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('lumo-tamer-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

const THEME_SUN = '<svg class="theme-icon-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const THEME_MOON = '<svg class="theme-icon-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 14.3A8.4 8.4 0 1 1 9.7 3 7 7 0 0 0 21 14.3z"/></svg>';
const THEME_BIND = `(function(){var btn=document.getElementById('themeToggle');if(!btn)return;btn.innerHTML='${THEME_SUN}${THEME_MOON}';function paint(){var dark=document.documentElement.getAttribute('data-theme')==='dark';var sun=btn.querySelector('.theme-icon-sun');var moon=btn.querySelector('.theme-icon-moon');if(sun)sun.style.display=dark?'none':'';if(moon)moon.style.display=dark?'':'none';btn.setAttribute('aria-label',dark?'Dark mode':'Light mode');btn.title=dark?'Dark mode':'Light mode';}paint();btn.addEventListener('click',function(){var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('lumo-tamer-theme',next);}catch(e){}paint();});})();`;

const REPO_URL = 'https://github.com/banter240/lumo-tamer';

const ICON_GITHUB = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.54 9.54 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>';
const ICON_ACCOUNT = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 19.5c.8-3.2 3.5-5 7-5s6.2 1.8 7 5"/></svg>';
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

const ICON_RESTART = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>';

function iconBtn(href: string, label: string, svg: string, extra = ''): string {
  return `<a class="icon-btn" href="${href}" aria-label="${label}" title="${label}"${extra}>${svg}</a>`;
}

export const protonUiCss = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
:root {
  color-scheme: light;
  --purple: #6d4aff;
  --purple-hover: #5940d3;
  --purple-soft: #efeaff;
  --purple-soft-hover: #e4dcff;
  --bg: #f5f2ff;
  --card: #ffffff;
  --text: #1b1340;
  --muted: #5c5777;
  --line: #ddd7f2;
  --ok: #0f766e;
  --ok-soft: #d1fae5;
  --err: #c81e4a;
  --warn: #a16207;
  --input: #ffffff;
  --radius: 14px;
  --shadow: 0 18px 50px rgba(27, 19, 64, 0.08);
  --glow: radial-gradient(1200px 500px at 10% -10%, #e4dcff 0%, transparent 55%);
}
[data-theme="dark"] {
  color-scheme: dark;
  --purple: #8b7cff;
  --purple-hover: #a396ff;
  --purple-soft: rgba(139, 124, 255, 0.18);
  --purple-soft-hover: rgba(139, 124, 255, 0.3);
  --bg: #14121b;
  --card: #1d1a26;
  --text: #f2effa;
  --muted: #a39eb8;
  --line: #3b364a;
  --ok: #2dd4bf;
  --ok-soft: rgba(45, 212, 191, 0.16);
  --err: #fb7185;
  --warn: #fbbf24;
  --input: #15131c;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  --glow: radial-gradient(900px 420px at 12% -8%, rgba(109, 74, 255, 0.28) 0%, transparent 55%);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: Inter, system-ui, sans-serif;
  background: var(--glow), var(--bg);
  background-attachment: fixed;
  color: var(--text);
  line-height: 1.45;
}
a { color: var(--purple); text-decoration: none; font-weight: 600; }
a:hover { text-decoration: underline; }
.shell { width: min(74rem, calc(100% - 2rem)); margin: 3rem auto 4rem; }
.wrap { width: min(var(--page-width, 26rem), 100%); margin-inline: auto; }
.brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 1.25rem; }
.brand-home { display: flex; align-items: center; gap: 0.7rem; min-width: 0; color: inherit; font-weight: inherit; text-decoration: none; }
.brand-home:hover { text-decoration: none; color: inherit; }
.mark {
  width: 2.25rem; height: 2.25rem; border-radius: 10px; flex: none;
  background: linear-gradient(145deg, #8b74ff, #6d4aff);
  color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 1rem;
  box-shadow: 0 8px 18px rgba(109, 74, 255, 0.28);
}
.brand h1 { font-size: 1.15rem; margin: 0; letter-spacing: -0.02em; }
.brand p { margin: 0; color: var(--muted); font-size: 0.82rem; font-weight: 500; }
.brand-actions { margin-left: auto; display: flex; gap: 0.4rem; align-items: center; position: relative; }
.theme-btn, a.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 2.25rem; height: 2.25rem; padding: 0; flex: none;
  border-radius: 10px; border: 1px solid var(--line);
  background: var(--card); color: var(--text);
  box-shadow: none; text-decoration: none;
}
.theme-btn:hover, a.icon-btn:hover { background: var(--purple-soft); color: var(--purple); }
a.icon-btn.current { background: var(--purple-soft); color: var(--purple); }
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 1.35rem 1.4rem 1.5rem;
}
.lede { margin: 0 0 1rem; color: var(--muted); font-size: 0.92rem; }
.nav { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85rem; margin: 0 0 1rem; }
label { display: block; margin: 0.85rem 0 0.3rem; font-size: 0.82rem; font-weight: 600; }
input[type=text], input[type=email], input[type=number], input[type=password], textarea, select {
  width: 100%; padding: 0.7rem 0.8rem; border-radius: 10px; border: 1px solid var(--line);
  background: var(--input); color: inherit; font: inherit;
}
input:focus, textarea:focus, select:focus {
  outline: 2px solid var(--purple-soft); border-color: var(--purple);
}
textarea { min-height: 5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
textarea.tall { min-height: 12rem; }
input[type=checkbox] { width: 1.1rem; height: 1.1rem; accent-color: var(--purple); }
button, .btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.7rem 1.1rem; border: 0; border-radius: 999px;
  background: var(--purple); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
button.secondary { background: var(--purple-soft); color: var(--purple); }
button.secondary:hover { background: var(--purple-soft-hover); }
button:hover, .btn:hover { background: var(--purple-hover); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.ok { color: var(--ok); }
.err { color: var(--err); }
.hint, .muted { color: var(--muted); font-size: 0.85rem; line-height: 1.45; }
.hint { margin: 1rem 0 0; }
code { font-size: 0.84em; background: var(--purple-soft); padding: 0.05rem 0.3rem; border-radius: 6px; }
`;

export function htmlPage(options: {
  title: string;
  body: string;
  wide?: boolean;
  extraCss?: string;
  page: 'auth' | 'config';
  version?: string;
}): string {
  const width = options.wide ? '74rem' : '26rem';
  const verTag = options.version ? ` <span class="ver">v${options.version}</span>` : '';
  const verCss = '.ver { color: var(--muted); font-size: 0.72rem; font-weight: 600; opacity: 0.8; }'
  const navBtn = options.page === 'config'
    ? iconBtn('/auth', 'Account', ICON_ACCOUNT)
    : iconBtn('/config', 'Settings', ICON_SETTINGS);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${options.title}</title>
  <script>${THEME_BOOT}</script>
  <style>:root { --page-width: ${width}; }${protonUiCss}${verCss}${options.extraCss ?? ''}</style>
</head>
<body>
  <div class="shell">
    <div class="brand">
      <a class="brand-home" href="/auth">
        <div class="mark">L</div>
        <div>
          <h1>lumo-tamer</h1>
          <p>Unofficial Proton Lumo proxy${verTag}</p>
        </div>
      </a>
      <div class="brand-actions">
        ${iconBtn(REPO_URL, 'GitHub', ICON_GITHUB, ' target="_blank" rel="noopener noreferrer"')}
        <button type="button" class="theme-btn" id="themeToggle" aria-label="Toggle theme"></button>
        ${navBtn}
      </div>
    </div>
    <div class="wrap">
    ${options.body}
    </div>
  </div>
  <script>${THEME_BIND}</script>
</body>
</html>`;
}
