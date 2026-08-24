/**
 * Config web UI
 *
 * GET  /config      - Form (no API key; does not embed secrets)
 * GET  /v1/config   - Field tree; server.apiKey is never returned
 * PUT  /v1/config   - Apply path edits, then restart so values load
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { loadDefaultsYaml, loadConfigYaml, updateConfigYaml, checkConfigFile } from '../../app/config-file.js';
import { parseServerUserConfig } from '../../app/config.js';
import {
  applyConfigEdits,
  applyEditsToDocument,
  walkConfigFields,
  redactSecrets,
  CONFIG_CATEGORIES,
  FIELD_DEPENDENCIES,
  resetAllEdits,
  type ConfigEdits,
} from '../../app/config-editor.js';
import { logger } from '../../app/logger.js';
import { htmlPage } from '../web-ui.js';
import { VERSION } from '../../app/version.js';
import { clientIp, createAttemptGate } from '../attempt-limit.js';
import type { Application } from '../../app/index.js';

const allowSave = createAttemptGate(20);

export interface ConfigRouterHooks {
  onSaved?: () => void;
}

function renderConfigPage(isAuthenticated: boolean): string {
  const extraCss = `
    .row.hidden-field {
      display: none !important;
    }
    .layout {
      display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); gap: 1rem; align-items: start;
      min-height: calc(100vh - 8rem);
    }
    .side {
      position: sticky; top: 1rem; display: flex; flex-direction: column; gap: 0.15rem;
      padding: 0.45rem; background: var(--card); border: 1px solid var(--line);
      border-radius: var(--radius); box-shadow: var(--shadow);
    }
    .side .nav-item {
      width: 100%; justify-content: space-between; gap: 0.5rem;
      border-radius: 10px; background: transparent; color: var(--text);
      font-weight: 500; font-size: 0.84rem; padding: 0.55rem 0.7rem; box-shadow: none;
    }
    .side .nav-item:hover { background: var(--purple-soft); color: var(--purple); }
    .side .nav-item.active { background: var(--purple); color: #fff; }
    .side .nav-item.active:hover { background: var(--purple-hover); color: #fff; }
    .side .nav-item.dim { opacity: 0.4; }
    .side .count { color: inherit; opacity: 0.7; font-size: 0.72rem; font-weight: 600; }
    .pane-head h2 { font-size: 1.05rem; margin: 0 0 0.25rem; letter-spacing: -0.02em; }
    .pane-head .lede { margin: 0 0 1rem; }
    .toolbar {
      display: grid; grid-template-columns: minmax(10rem, 18rem) 1fr auto;
      gap: 0.65rem 0.75rem; align-items: center; margin: 0 0 1rem; padding-bottom: 0.9rem;
      border-bottom: 1px solid var(--line);
    }
    .toolbar-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
    .toolbar .hint { margin: 0; }
    .toolbar-msg { margin: 0; grid-column: 1 / -1; }
    .toolbar-msg:empty { display: none; }
    .row.bool input[type=checkbox] {
      appearance: none; width: 1.2rem; height: 1.2rem; margin: 0; cursor: pointer;
      border: 1.5px solid var(--line); border-radius: 5px; background: var(--input);
      display: inline-grid; place-items: center;
    }
    .row.bool input[type=checkbox]:checked {
      background: var(--purple); border-color: var(--purple);
    }
    .row.bool input[type=checkbox]:checked::after {
      content: ''; width: 0.28rem; height: 0.5rem;
      border: solid #fff; border-width: 0 2px 2px 0;
      transform: rotate(45deg) translate(-1px, -1px);
    }
    .row {
      display: flex; flex-direction: column; gap: 0.35rem;
      padding: 0.95rem 0; border-top: 1px solid var(--line);
    }
    .row.dependent {
      margin-left: 1.5rem; padding-left: 1rem;
      border-left: 3px solid var(--purple-soft);
      border-top-color: var(--line);
    }
    .row.dependent.hidden-field {
      display: none !important;
    }
    .row:first-child { border-top: 0; padding-top: 0.2rem; }
    .title {
      display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap;
      font-size: 0.9rem; font-weight: 600;
    }
    .desc { margin: 0; font-size: 0.8rem; color: var(--muted); line-height: 1.45; }
    .controls {
      display: grid; grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem; align-items: center; margin-top: 0.15rem;
    }
    .control { min-width: 0; }
    .actions {
      display: flex; gap: 0.4rem; justify-self: end; align-self: start; flex-shrink: 0;
      min-width: 5.6rem;
    }
    .btn-default, .btn-undo {
      min-width: 5.6rem; padding: 0.45rem 0.75rem; font-size: 0.75rem; font-weight: 600;
      border-radius: 999px; box-shadow: none;
    }
    .btn-default, .btn-default.is-reset {
      background: var(--ok-soft); color: var(--ok); border: 1px solid var(--ok);
    }
    .btn-default:hover, .btn-default.is-reset:hover {
      background: var(--ok); color: #fff; border-color: var(--ok);
    }
    .btn-default.is-current {
      background: transparent; color: var(--muted); border: 1px solid var(--line); cursor: default;
    }
    .btn-default.is-current:hover {
      background: transparent; color: var(--muted); border-color: var(--line);
    }
    .btn-undo {
      background: var(--purple-soft); color: var(--purple); border: 1px solid transparent;
    }
    .btn-undo:hover { background: var(--purple-soft-hover); color: var(--purple); }
    .btn-undo[hidden] { display: none; }
    .over {
      color: var(--warn); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .meta { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; }
    .meta-line {
      display: flex; align-items: baseline; gap: 0.75rem;
      font-size: 0.75rem; color: var(--muted);
    }
    .meta-line code { font-size: 0.84em; }
    button.more-lbl {
      display: inline; padding: 0; border: 0; border-radius: 0; box-shadow: none;
      background: transparent; color: var(--purple); font-size: 0.75rem; font-weight: 600;
    }
    button.more-lbl:hover { background: transparent; color: var(--purple-hover); }
    button.more-lbl::after { content: ' ▾'; font-weight: 500; }
    button.more-lbl[aria-expanded="true"]::after { content: ' ▴'; }
    .more-panel { width: 100%; margin: 0.15rem 0 0.85rem; }
    .more-copy { margin: 0; font-size: 0.78rem; color: var(--muted); white-space: pre-wrap; line-height: 1.45; }
    .example-block { margin: 0.5rem 0 0; }
    .example-block figcaption {
      display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem;
      margin: 0 0 0.25rem; font-size: 0.72rem; font-weight: 600; color: var(--muted);
    }
    button.copy-ex {
      flex: none; min-width: 4.2rem; padding: 0.2rem 0.55rem; font-size: 0.7rem;
      border-radius: 999px; border: 1px solid transparent; box-shadow: none;
      background: var(--purple-soft); color: var(--purple);
    }
    button.copy-ex:hover { background: var(--purple-soft-hover); color: var(--purple); }
    .example-block pre, .example {
      margin: 0; padding: 0.7rem 0.85rem;
      border: 1px solid var(--line); border-radius: 8px;
      background: var(--purple-soft); color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem;
      white-space: pre-wrap; overflow-x: auto; user-select: all;
    }
    .group { margin: 0 0 1.25rem; }
    .group h2 { font-size: 0.95rem; margin: 0 0 0.35rem; }
    .long { display: none; }
    .row.expanded .long { display: block; }
    .row.expanded .preview { display: none; }
    .preview {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; color: var(--muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
      border: 1px solid var(--line); border-radius: 10px; padding: 0.55rem 0.7rem; cursor: pointer;
      background: var(--input);
    }
    @media (max-width: 840px) {
      .layout { grid-template-columns: 1fr; }
      .side {
        position: sticky; top: 0; z-index: 3; flex-direction: row; overflow-x: auto;
        gap: 0.3rem; padding: 0.4rem;
      }
      .side .nav-item { width: auto; white-space: nowrap; }
      .toolbar { grid-template-columns: 1fr; }
    }
  `;
  const body = `
  <div class="auth-banner" id="authBanner" style="display: ${isAuthenticated ? 'none' : 'block'}; padding: 0.75rem 1rem; margin-bottom: 1rem; background: var(--purple-soft); border-left: 4px solid var(--err); border-radius: 6px; font-size: 0.85rem;">
    <strong>⚠️ Not logged in:</strong> Lumo-Tamer is waiting for authentication. Open <a href="/auth" style="color: var(--text); text-decoration: underline;">/auth</a> in your browser and sign in.
  </div>
  <div class="server-down-banner" id="serverDownBanner" style="display: none; padding: 0.75rem 1rem; margin-bottom: 1rem; background: #ff6b6b; color: #fff; border-left: 4px solid #c92a2a; border-radius: 6px; font-size: 0.85rem;">
    <strong>⚠️ Server is down</strong> — connection lost.
  </div>
  <script>
    // Auto-refresh auth status every 5 seconds
    (async () => {
      const banner = document.getElementById('authBanner');
      const serverDownBanner = document.getElementById('serverDownBanner');
      if (!banner || !serverDownBanner) return;
      setInterval(async () => {
        try {
          const res = await fetch('/health', { cache: 'no-store' });
          if (!res.ok) {
            banner.style.display = 'none';
            serverDownBanner.style.display = 'block';
            return;
          }
          const data = await res.json();
          if (data.auth && data.auth.valid) {
            banner.style.display = 'none';
            serverDownBanner.style.display = 'none';
          } else {
            banner.style.display = 'block';
            serverDownBanner.style.display = 'none';
          }
        } catch (_) {
          banner.style.display = 'none';
          serverDownBanner.style.display = 'block';
        }
      }, 5000);
    })();
  </script>
  <div class="layout">
    <nav class="side" id="nav" aria-label="Setting categories"></nav>
    <div>
      <div class="card">
        <div class="toolbar">
          <input id="filter" type="text" placeholder="Search settings">
          <span id="status" class="hint">Loading…</span>
          <div class="toolbar-actions">
            <button id="resetAll" type="button" class="secondary" disabled>Reset to defaults</button>
            <button id="saveRestart" type="button">Save</button>
            <button id="restartBtn" type="button" class="secondary">Restart</button>
          </div>
          <span id="msg" class="muted toolbar-msg"></span>
        </div>
        <div class="pane-head" id="paneHead"></div>
        <div id="form"></div>
      </div>
    </div>
  </div>
  <script>
    const CATEGORIES = ${JSON.stringify(CONFIG_CATEGORIES)};
    const DEPS = ${JSON.stringify(FIELD_DEPENDENCIES)};
    const statusEl = document.getElementById('status');
    const formEl = document.getElementById('form');
    const paneHead = document.getElementById('paneHead');
    const navEl = document.getElementById('nav');
    const saveRestartBtn = document.getElementById('saveRestart');
    const restartBtn = document.getElementById('restartBtn');
    const resetAllBtn = document.getElementById('resetAll');

    function updateButtons() {
      const hasChanges = dirty.size > 0 || resets.size > 0;
      saveRestartBtn.disabled = !hasChanges;
    }
    const msgEl = document.getElementById('msg');
    const filterEl = document.getElementById('filter');
    const dirty = new Map();
    const resets = new Set();
    let fields = [];
    let active = localStorage.getItem('lumo-tamer-config-cat') || 'api';

    function escText(s) {
      return String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    }
    function escAttr(s) {
      return escText(s).replace(/"/g, '&quot;');
    }

    function query() {
      return filterEl.value.trim().toLowerCase();
    }

    function visible(field) {
      const q = query();
      if (!q) return true;
      const samples = (field.examples || []).map((s) => s.label + ' ' + s.value).join(' ');
      return [field.path, field.label, field.hint, field.more, samples, field.category]
        .join(' ').toLowerCase().includes(q);
    }

    function formatList(path, value) {
      const items = Array.isArray(value) ? value : [];
      return path.indexOf('.executors.') >= 0 ? items.join(' ') : items.join(', ');
    }

    function valueFor(field) {
      if (dirty.has(field.path)) return dirty.get(field.path);
      if (resets.has(field.path)) return field.defaultValue;
      return field.value;
    }

    function inputFor(field) {
      const value = valueFor(field);
      if (field.kind === 'boolean') {
        return '<input type="checkbox" data-path="' + field.path + '"' + (value ? ' checked' : '') + '>';
      }
      if (field.kind === 'secret') {
        const typed = dirty.has(field.path) ? dirty.get(field.path) : '';
        return '<input type="password" autocomplete="new-password" placeholder="leave blank to keep" data-path="' + field.path + '" value="' + escAttr(typed) + '">';
      }
      if (field.kind === 'choice') {
        const cur = String(value ?? '');
        const opts = (field.choices || []).map((c) =>
          '<option value="' + escAttr(c) + '"' + (c === cur ? ' selected' : '') + '>' + escText(c) + '</option>'
        ).join('');
        return '<select data-path="' + field.path + '">' + opts + '</select>';
      }
      if (field.kind === 'stringList') {
        return '<input type="text" data-path="' + field.path + '" value="' + escAttr(formatList(field.path, value)) + '">';
      }
      if (field.kind === 'number') {
        return '<input type="text" inputmode="decimal" data-path="' + field.path + '" value="' + escAttr(value) + '">';
      }
      if (field.kind === 'multiline' || field.kind === 'json') {
        const raw = field.kind === 'json' ? JSON.stringify(value, null, 2) : (value ?? '');
        const tall = String(raw).length > 400 ? ' tall' : '';
        const preview = escText(String(raw).split('\\n')[0]).slice(0, 80);
        return '<div class="preview" data-expand="' + field.path + '">' + preview + '</div>'
          + '<textarea class="long ' + tall + '" data-path="' + field.path + '">' + escText(raw) + '</textarea>';
      }
      return '<input type="text" data-path="' + field.path + '" value="' + escAttr(value ?? '') + '">';
    }

    function extraBlock(field) {
      const samples = field.examples || [];
      const hasExtra = !!(field.more || samples.length);
      let html = '<div class="meta"><div class="meta-line">';
      html += '<code data-help="' + field.path + '">' + field.path + '</code>';
      if (hasExtra) {
        const label = samples.length > 1 ? 'Examples' : (samples.length ? 'Example' : 'More');
        html += '<button type="button" class="more-lbl" data-more="' + field.path
          + '" aria-expanded="false">' + label + '</button>';
      }
      html += '</div>';
      if (hasExtra) {
        html += '<div class="more-panel" data-more-panel="' + field.path + '" hidden>';
        if (field.more) html += '<p class="more-copy">' + escText(field.more) + '</p>';
        for (const sample of samples) {
          html += '<figure class="example-block"><figcaption><span>' + escText(sample.label)
            + '</span><button type="button" class="copy-ex" data-copy>Copy</button></figcaption>'
            + '<pre>' + escText(sample.value) + '</pre></figure>';
        }
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    function pending(path) {
      return dirty.has(path) || resets.has(path);
    }

    function renderFields(list) {
      let html = '';
      for (const field of list) {
        // Check conditional visibility based on parent field
        let visible = true;
        if (field.dependsOn) {
          const parent = fields.find(f => f.path === field.dependsOn);
          if (parent && DEPS[field.dependsOn]) {
            const depInfo = DEPS[field.dependsOn];
            visible = depInfo.showValues.includes(valueFor(parent));
          }
        }
        const current = field.kind !== 'secret'
          && JSON.stringify(valueFor(field)) === JSON.stringify(field.defaultValue);
        const over = field.kind !== 'secret' && !current ? '<span class="over">changed</span>' : '';
        const bool = field.kind === 'boolean' ? ' bool' : '';
        const dep = field.dependsOn ? ' dependent' : '';
        html += '<div class="row' + bool + dep + (visible ? '' : ' hidden-field') + '" data-row="' + field.path + '"' + (visible ? '' : ' style="display:none;"') + '>';
        html += '<div class="title">' + escText(field.label) + ' ' + over + '</div>';
        html += '<p class="desc">' + escText(field.hint || '') + '</p>';
        html += extraBlock(field);
        html += '<div class="controls"><div class="control">' + inputFor(field) + '</div>';
        html += '<div class="actions">';
        if (field.kind !== 'secret' && !field.noDefault) {
          html += '<button type="button" class="btn-default' + (current ? ' is-current' : ' is-reset')
            + '" data-reset="' + field.path + '">Default</button>';
        }
        html += '<button type="button" class="btn-undo" data-undo="' + field.path + '"'
          + (pending(field.path) ? '' : ' hidden') + '>Undo</button>';
        html += '</div></div></div>';
      }
      return html;
    }

    function parseCurrent(field, el) {
      if (field.kind === 'boolean') return el.checked;
      if (field.kind === 'number') {
        const val = el.value.replace(/,/g, '.');
        return val === '' ? field.defaultValue : Number(val);
      }
      if (field.kind === 'json') {
        try { return JSON.parse(el.value); } catch { return el.value; }
      }
      if (field.kind === 'stringList') {
        return field.path.indexOf('.executors.') >= 0
          ? el.value.trim().split(/\\s+/).filter(Boolean)
          : el.value.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return el.value;
    }

    function atDefault(field) {
      if (field.kind === 'secret') {
        return resets.has(field.path) || (!dirty.has(field.path) && !field.overridden);
      }
      const el = formEl.querySelector('[data-path="' + field.path + '"]');
      if (!el) {
        const value = valueFor(field);
        return JSON.stringify(value) === JSON.stringify(field.defaultValue);
      }
      return JSON.stringify(parseCurrent(field, el)) === JSON.stringify(field.defaultValue);
    }

    function applyValue(field, value) {
      const el = formEl.querySelector('[data-path="' + field.path + '"]');
      if (!el) return;
      if (field.kind === 'secret') el.value = '';
      else if (field.kind === 'boolean') el.checked = !!value;
      else if (field.kind === 'json') el.value = JSON.stringify(value, null, 2);
      else if (field.kind === 'stringList') el.value = formatList(field.path, value);
      else el.value = value ?? '';
      const preview = formEl.querySelector('[data-expand="' + field.path + '"]');
      if (preview) {
        const raw = field.kind === 'json' ? JSON.stringify(value, null, 2) : String(value ?? '');
        preview.textContent = raw.split('\\n')[0].slice(0, 80);
      }
    }

    function markRow(path) {
      const field = fields.find((f) => f.path === path);
      const row = formEl.querySelector('[data-row="' + path + '"]');
      if (!field || !row) return;
      if (field.kind === 'secret') {
        const undo = row.querySelector('[data-undo]');
        if (undo) undo.hidden = !pending(path);
        const over = row.querySelector('.over');
        if (over) over.remove();
        return;
      }
      const current = atDefault(field);
      const btn = row.querySelector('[data-reset]');
      if (btn) {
        btn.classList.toggle('is-current', current);
        btn.classList.toggle('is-reset', !current);
        btn.setAttribute('aria-pressed', current ? 'true' : 'false');
        btn.title = current ? 'Already the default' : 'Restore the default';
      }
      const undo = row.querySelector('[data-undo]');
      if (undo) undo.hidden = !pending(path);
      let over = row.querySelector('.over');
      if (!current && !over) {
        const title = row.querySelector('.title');
        over = document.createElement('span');
        over.className = 'over';
        over.textContent = 'changed';
        title.appendChild(over);
      } else if (current && over) {
        over.remove();
      }
    }

    function markAllRows() {
      formEl.querySelectorAll('[data-row]').forEach((row) => markRow(row.getAttribute('data-row')));
    }

    function bindForm() {
      formEl.querySelectorAll('[data-path]').forEach((el) => {
        el.addEventListener('input', onEdit);
        el.addEventListener('change', onEdit);
      });
      formEl.querySelectorAll('[data-reset]').forEach((el) => {
        el.addEventListener('click', onReset);
      });
      formEl.querySelectorAll('[data-undo]').forEach((el) => {
        el.addEventListener('click', onUndo);
      });
      formEl.querySelectorAll('[data-expand]').forEach((el) => {
        el.addEventListener('click', () => el.closest('.row').classList.add('expanded'));
      });
      formEl.querySelectorAll('[data-more]').forEach((el) => {
        el.addEventListener('click', () => {
          const path = el.getAttribute('data-more');
          const panel = formEl.querySelector('[data-more-panel="' + path + '"]');
          if (!panel) return;
          const open = panel.hidden;
          panel.hidden = !open;
          el.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      });
      formEl.querySelectorAll('[data-copy]').forEach((el) => {
        el.addEventListener('click', async () => {
          const pre = el.closest('.example-block').querySelector('pre');
          const text = pre ? pre.textContent : '';
          try {
            await navigator.clipboard.writeText(text);
          } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          }
          const prev = el.textContent;
          el.textContent = 'Copied';
          setTimeout(() => { el.textContent = prev; }, 1200);
        });
      });
      // Conditional field visibility: watch parent toggles
      for (const [childPath, depInfo] of Object.entries(DEPS)) {
        const parentEl = formEl.querySelector('[data-path="' + depInfo.parent + '"]');
        if (!parentEl) continue;
        const updateChildren = () => {
          const parentField = fields.find(f => f.path === depInfo.parent);
          if (!parentField) return;
          const isVisible = depInfo.showValues.includes(parseCurrent(parentField, parentEl));
          const childRow = formEl.querySelector('[data-row="' + childPath + '"]');
          if (childRow) childRow.style.display = isVisible ? '' : 'none';
        };
        parentEl.addEventListener('change', updateChildren);
        parentEl.addEventListener('input', updateChildren);
        updateChildren();
      }
      markAllRows();
    }

    function renderNav() {
      const q = query();
      navEl.innerHTML = CATEGORIES.map((cat) => {
        const n = fields.filter((f) => f.category === cat.id && visible(f)).length;
        const dim = q && n === 0 ? ' dim' : '';
        const on = !q && cat.id === active ? ' active' : '';
        return '<button type="button" class="nav-item' + on + dim + '" data-cat="' + cat.id + '">'
          + escText(cat.title) + '<span class="count">' + n + '</span></button>';
      }).join('');
      navEl.querySelectorAll('[data-cat]').forEach((el) => {
        el.addEventListener('click', () => {
          active = el.getAttribute('data-cat');
          localStorage.setItem('lumo-tamer-config-cat', active);
          filterEl.value = '';
          render();
        });
      });
    }

    function render() {
      const q = query();
      const searching = !!q;
      if (searching) {
        paneHead.innerHTML = '<h2>Search results</h2><p class="lede">Matches across every category.</p>';
        let html = '';
        for (const cat of CATEGORIES) {
          const list = fields.filter((f) => f.category === cat.id && visible(f));
          if (!list.length) continue;
          html += '<div class="group"><h2>' + escText(cat.title) + '</h2>' + renderFields(list) + '</div>';
        }
        formEl.innerHTML = html || '<p class="hint">Nothing matches.</p>';
        statusEl.textContent = fields.filter(visible).length + ' matches';
      } else {
        const cat = CATEGORIES.find((c) => c.id === active) || CATEGORIES[0];
        const list = fields.filter((f) => f.category === cat.id);
        paneHead.innerHTML = '<h2>' + escText(cat.title) + '</h2><p class="lede">' + escText(cat.blurb) + '</p>';
        formEl.innerHTML = list.length ? renderFields(list) : '<p class="hint">Nothing in this category.</p>';
        statusEl.textContent = list.length + ' settings';
      }
      renderNav();
      bindForm();
      updateButtons();
      resetAllBtn.disabled = false;
    }

    function updateButtons() {
      const hasChanges = dirty.size > 0 || resets.size > 0;
      saveRestartBtn.disabled = !hasChanges;
    }

    function onEdit(ev) {
      const el = ev.target;
      if (el.tagName === 'INPUT' && el.type === 'number') {
        el.value = el.value.replace(/,/g, '.');
      }
      const path = el.getAttribute('data-path');
      const field = fields.find((f) => f.path === path);
      const parsed = parseCurrent(field, el);
      if (field.kind === 'secret') {
        if (el.value === '') {
          dirty.delete(path);
          resets.delete(path);
        } else {
          resets.delete(path);
          dirty.set(path, el.value);
        }
        markRow(path);
        updateButtons();
        return;
      }
      resets.delete(path);
      if (JSON.stringify(parsed) === JSON.stringify(field.value)) {
        dirty.delete(path);
      } else {
        dirty.set(path, (field.kind === 'boolean' || field.kind === 'number') ? parsed : el.value);
      }
      markRow(path);
      updateButtons();
    }

    function onReset(ev) {
      const path = ev.currentTarget.getAttribute('data-reset');
      const field = fields.find((f) => f.path === path);
      if (!field || field.kind === 'secret') return;
      if (atDefault(field) && !pending(path)) return;
      applyValue(field, field.defaultValue);
      dirty.delete(path);
      resets.add(path);
      markRow(path);
      updateButtons();
    }

    function onUndo(ev) {
      const path = ev.currentTarget.getAttribute('data-undo');
      const field = fields.find((f) => f.path === path);
      if (!field) return;
      applyValue(field, field.value);
      dirty.delete(path);
      resets.delete(path);
      markRow(path);
      updateButtons();
    }

    async function load() {
      const res = await fetch('/v1/config');
      if (!res.ok) throw new Error('Could not load config');
      const data = await res.json();
      fields = data.fields;
      render();
    }

    async function waitUntilUp() {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const ping = await fetch('/health', { cache: 'no-store' });
          if (ping.ok) return;
        } catch (_) { /* still down */ }
      }
      throw new Error('Server did not come back. Docker should restart it; if you started it by hand, start it again, then press F5.');
    }

    filterEl.addEventListener('input', render);

    async function putConfig(payload) {
      msgEl.className = 'muted';
      msgEl.textContent = 'Saving…';
      saveRestartBtn.disabled = true;
      resetAllBtn.disabled = true;
      try {
        const res = await fetch('/v1/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        dirty.clear();
        resets.clear();
        updateButtons();
        msgEl.className = 'ok';
        msgEl.textContent = 'Saved.';
        await load();
      } catch (err) {
        msgEl.className = 'err';
        msgEl.textContent = err.message || 'Save failed';
        saveRestartBtn.disabled = false;
        resetAllBtn.disabled = false;
      }
    }

    resetAllBtn.addEventListener('click', () => {
      if (!confirm('Reset all visible fields to defaults? This does not save — refresh to undo.')) return;
      for (const field of fields) {
        if (field.kind === 'secret' || field.noDefault) continue;
        applyValue(field, field.defaultValue);
        dirty.delete(field.path);
        resets.add(field.path);
      }
      markAllRows();
      updateButtons();
    });

    restartBtn.addEventListener('click', async () => {
      if (!confirm('Restart the server now? Unsaved changes will be lost.')) return;
      msgEl.className = 'muted';
      msgEl.textContent = 'Restarting…';
      restartBtn.disabled = true;
      try {
        await fetch('/v1/restart', { method: 'POST' });
        msgEl.className = 'ok';
        msgEl.textContent = 'Restarting. Waiting for the server…';
        await waitUntilUp();
        location.reload();
      } catch (err) {
        msgEl.className = 'err';
        msgEl.textContent = err.message || 'Restart failed';
        restartBtn.disabled = false;
      }
    });

    saveRestartBtn.addEventListener('click', () => {
      putConfig({ changes: Object.fromEntries(dirty), resets: [...resets] });
    });

    load().catch((err) => {
      statusEl.className = 'err';
      statusEl.textContent = err.message || 'Load failed';
    });
  </script>`;
  return htmlPage({
    title: 'Settings · lumo-tamer',
    body,
    wide: true,
    extraCss,
    page: 'config',
    version: VERSION,
  });
}

export function createConfigRouter(app: Application, hooks: ConfigRouterHooks = {}): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    const isAuthenticated = app.isAuthenticated();
    res.type('html').send(renderConfigPage(isAuthenticated));
  });

  router.get('/v1/config', (_req: Request, res: Response) => {
    const status = checkConfigFile();
    if (status.error) {
      res.status(500).json({ error: status.error });
      return;
    }
    const defaults = loadDefaultsYaml();
    const user = loadConfigYaml();
    const fields = walkConfigFields(defaults, user);
    res.json({
      fields,
      current: redactSecrets(user),
    });
  });

  router.put('/v1/config', (req: Request, res: Response) => {
    if (!allowSave(clientIp(req))) {
      res.status(429).json({ error: 'Too many config saves. Wait a few minutes.' });
      return;
    }

    const status = checkConfigFile();
    if (status.error) {
      res.status(500).json({ error: status.error });
      return;
    }

    const body = req.body ?? {};

    try {
      const defaults = loadDefaultsYaml();
      const edits: ConfigEdits = body.resetAll === true
        ? resetAllEdits(defaults)
        : {
          changes: (body.changes && typeof body.changes === 'object') ? body.changes as Record<string, unknown> : {},
          resets: Array.isArray(body.resets) ? body.resets.filter((p: unknown) => typeof p === 'string') : [],
        };
      const next = applyConfigEdits(loadConfigYaml(), defaults, edits);
      parseServerUserConfig(next);
      const changedPaths = body.resetAll === true
        ? ['resetAll']
        : [
          ...Object.keys(edits.changes ?? {}),
          ...(edits.resets ?? []).map((p) => `reset:${p}`),
        ];
      updateConfigYaml((doc) => {
        applyEditsToDocument(doc, defaults, edits);
      });
      logger.info({ paths: changedPaths }, 'Config updated via /config');

      res.json({
        success: true,
        message: 'Saved.',
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
        res.status(400).json({ error: `Invalid config: ${details}` });
        return;
      }
      const message = error instanceof Error ? error.message : 'Save failed';
      logger.error({ error }, "Can't save config via /config");
      res.status(400).json({ error: message });
    }
  });

  router.post('/v1/restart', (_req: Request, res: Response) => {
    logger.info('Restart requested via /v1/restart — exiting now');
    res.json({ success: true, message: 'Restarting…' });
    setTimeout(() => {
      try { hooks.onSaved?.(); } catch (e) { logger.error({ e }, 'Restart hook failed'); }
    }, 100);
  });

  return router;
}
