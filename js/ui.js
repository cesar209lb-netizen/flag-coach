// Small DOM helpers: element builder, icons, sheets, dialogs, toasts.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'type', 'min', 'max', 'step',
  'placeholder', 'maxLength', 'accept', 'multiple', 'readOnly', 'inputMode', 'rows', 'autocomplete']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || (v === false && !PROPS.has(k))) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
        }
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v12h13V9"/><path d="M10 21v-6h4v6"/>',
  playbook: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m6.5 7.5 3 3m0-3-3 3"/><circle cx="16.5" cy="16" r="2"/><path d="M8 17c3 0 4-5 7-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5c0-3.8 2.9-6.5 6.5-6.5s6.5 2.7 6.5 6.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M21.5 20.5c0-2.9-1.6-5.2-4-6.1"/>',
  sliders: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  flip: '<path d="M12 3v18"/><path d="M9 7 3.5 12 9 17z"/><path d="m15 7 5.5 5-5.5 5z"/>',
  trash: '<path d="M3.5 6h17"/><path d="M8.5 6V4h7v2"/><path d="m6 6 1 14h10l1-14"/><path d="M10 10v6m4-6v6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  star: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 6 6 6-6 6"/>',
  camera: '<path d="M3 8.5h4l2-3h6l2 3h4V20H3z"/><circle cx="12" cy="13.5" r="3.5"/>',
  expand: '<path d="M4 9V4h5m11 5V4h-5M4 15v5h5m11-5v5h-5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3"/><path d="M3 3.5v5h5"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  share: '<path d="M12 15V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M5 11v9h14v-9"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 20V8"/><path d="m7 13 5-5 5 5"/><path d="M4 4h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  whistle: '<circle cx="9" cy="14" r="5.5"/><path d="M13 10h8v3.5h-5"/><circle cx="9" cy="14" r="1.5" fill="currentColor"/>',
  route: '<circle cx="6" cy="19" r="2.2"/><path d="M6 16.5V11l11-6"/><path d="m13 4.5 4.3.4-1.8 4"/>',
  motion: '<path d="M3 17h2m3 0h2m3 0h2"/><path d="m18 14 3 3-3 3"/><circle cx="6" cy="8" r="2.5"/>',
  ball: '<ellipse cx="12" cy="12" rx="9.5" ry="6" transform="rotate(-35 12 12)"/><path d="m9.5 14.5 5-5M10.5 10.5l1 1m1 1 1 1"/>',
  shieldHalf: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6z"/><path d="M12 3v18"/>',
  wifiOff: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.6a10 10 0 0 1 5.2-2.5M17.5 11.3a10 10 0 0 1 1.5 1.3M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="m3 3 18 18"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  bolt: '<path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4m8-4v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01"/>',
};

export function ico(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = ico(name, cls);
  return t.content.firstChild;
}

export function btn(label, onClick, { kind = '', iconName = null, cls = '', disabled = false, title = null } = {}) {
  return h('button', { class: `btn ${kind} ${cls}`.trim(), onclick: onClick, disabled, title, 'aria-label': title || undefined },
    iconName ? icon(iconName) : null, label ? h('span', null, label) : null);
}

export function iconBtn(name, onClick, { title = '', cls = '', disabled = false } = {}) {
  return h('button', { class: `icon-btn ${cls}`.trim(), onclick: onClick, title, 'aria-label': title, disabled }, icon(name));
}

// ---------- Sheets & dialogs ----------

let sheetDepth = 0;

export function openSheet({ title = '', body = null, actions = [], size = 'md', onClose = null, headerExtra = null } = {}) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const close = () => {
    if (overlay._closed) return;
    overlay._closed = true;
    sheetDepth--;
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
    onClose?.();
  };
  const head = h('div', { class: 'sheet-head' },
    h('div', { class: 'sheet-title' }, title),
    headerExtra,
    iconBtn('x', close, { title: 'Close' }));
  const content = h('div', { class: 'sheet-body' }, body);
  const panel = h('div', { class: `sheet sheet-${size}`, role: 'dialog', 'aria-modal': 'true' }, head, content);
  if (actions.length) {
    panel.append(h('div', { class: 'sheet-foot' }, actions.map((a) =>
      h('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); },
      }, a.label))));
  }
  overlay.append(panel);
  let downOnBg = false;
  overlay.addEventListener('pointerdown', (e) => { downOnBg = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (e.target === overlay && downOnBg) close(); });
  document.getElementById('overlays').append(overlay);
  sheetDepth++;
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));
  return { close, panel, content, overlay };
}

export const anySheetOpen = () => sheetDepth > 0;

export function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    openSheet({
      title, size: 'sm',
      body: h('p', { class: 'dialog-msg' }, message),
      actions: [
        { label: cancelText, kind: 'ghost', onClick: () => { result = false; } },
        { label: confirmText, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', confirmText = 'Save' }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { class: 'input', value, placeholder, autocomplete: 'off' });
    const s = openSheet({
      title, size: 'sm',
      body: h('label', { class: 'field-label' }, label, input),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: confirmText, kind: 'primary', onClick: () => { result = input.value.trim(); } },
      ],
      onClose: () => resolve(result || null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { result = input.value.trim(); s.close(); } });
    setTimeout(() => input.focus(), 250);
  });
}

export function actionSheet({ title = '', items }) {
  const s = openSheet({
    title, size: 'sm',
    body: h('div', { class: 'action-list' }, items.filter(Boolean).map((it) =>
      h('button', {
        class: `action-item ${it.danger ? 'danger' : ''}`,
        onclick: () => { s.close(); it.onClick(); },
      }, it.icon ? icon(it.icon) : null, h('span', null, it.label)))),
  });
  return s;
}

// ---------- Toasts ----------

export function toast(message, { action = null, duration = 2800, tone = '' } = {}) {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const el = h('div', { class: `toast ${tone}` }, h('span', null, message),
    action ? h('button', { class: 'toast-action', onclick: () => { action.onClick(); dismiss(); } }, action.label) : null);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  setTimeout(dismiss, duration);
  return dismiss;
}

// ---------- Misc ----------

export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function initials(p) {
  return (p.first?.[0] || '').toUpperCase() || '?';
}

export function stars(value, { size = '', onChange = null } = {}) {
  const wrap = h('div', { class: `stars ${size} ${onChange ? 'editable' : ''}` });
  for (let i = 1; i <= 5; i++) {
    const b = h(onChange ? 'button' : 'span', {
      class: `star ${i <= value ? 'on' : ''}`,
      'aria-label': onChange ? `${i} star${i > 1 ? 's' : ''}` : undefined,
      onclick: onChange ? () => onChange(i === value ? 0 : i) : undefined,
    }, icon('star'));
    wrap.append(b);
  }
  return wrap;
}

export function segmented(options, value, onChange, { cls = '' } = {}) {
  return h('div', { class: `seg ${cls}` }, options.map((o) =>
    h('button', { class: `seg-btn ${o.value === value ? 'on' : ''}`, onclick: () => onChange(o.value) }, o.label)));
}

export function stepper(value, { min = 0, max = 99, step = 1, suffix = '', onChange }) {
  const val = h('span', { class: 'stepper-val' }, `${value}${suffix}`);
  const set = (v) => { v = Math.max(min, Math.min(max, v)); value = v; val.textContent = `${v}${suffix}`; onChange(v); };
  return h('div', { class: 'stepper' },
    h('button', { class: 'icon-btn', onclick: () => set(value - step), 'aria-label': 'Decrease' }, '−'),
    val,
    h('button', { class: 'icon-btn', onclick: () => set(value + step), 'aria-label': 'Increase' }, '+'));
}
