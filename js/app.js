// App shell: boot, hash router, tab bar, offline service worker.

import { loadState } from './store.js';
import * as sync from './sync.js';
import { h, icon, toast } from './ui.js';
import * as Home from './views/home.js';
import * as Playbook from './views/playbook.js';
import * as Editor from './views/editor.js';
import * as Roster from './views/roster.js';
import * as Settings from './views/settings.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'playbook', label: 'Playbook', icon: 'playbook' },
  { id: 'roster', label: 'Roster', icon: 'users' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];
const VIEWS = { home: Home, playbook: Playbook, roster: Roster, settings: Settings };

const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = null;

function renderTabs(active) {
  tabbar.replaceChildren(...TABS.map((t) =>
    h('a', { class: `tab ${active === t.id ? 'on' : ''}`, href: `#/${t.id}` }, icon(t.icon), h('span', null, t.label))));
}

function route() {
  const [name = 'home', arg] = location.hash.replace(/^#\/?/, '').split('/');
  try { current?.destroy?.(); } catch (e) { console.error(e); }
  current = null;
  viewEl.replaceChildren();
  viewEl.scrollTop = 0;
  const inEditor = name === 'play';
  document.body.classList.toggle('in-editor', inEditor);
  renderTabs(inEditor ? 'playbook' : VIEWS[name] ? name : 'home');
  try {
    current = inEditor ? Editor.mount(viewEl, arg) : (VIEWS[name] || Home).mount(viewEl);
  } catch (e) {
    console.error(e);
    viewEl.replaceChildren(h('div', { class: 'page empty-state' }, h('h2', null, 'Something went wrong'), h('p', null, String(e.message || e))));
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let devOptIn = false;
  try { devOptIn = localStorage.getItem('fc-sw') === '1'; } catch { /* storage blocked */ }
  if (['localhost', '127.0.0.1'].includes(location.hostname) && !devOptIn) return;
  if (!window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of Flag Coach is ready', { duration: 20000, action: { label: 'Update', onClick: () => worker.postMessage('skipWaiting') } });
        }
      });
    });
  }).catch((e) => console.warn('Service worker failed', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

async function boot() {
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  try {
    await loadState();
  } catch (e) {
    console.error(e);
    viewEl.replaceChildren(h('div', { class: 'page empty-state' },
      h('h2', null, "Flag Coach couldn't open its storage"),
      h('p', null, 'If you are in a Private Browsing tab, open Flag Coach in a normal tab or from the Home Screen.'),
      h('p', { class: 'muted' }, String(e.message || e))));
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  // Team sync is off until an iPad is paired in Settings.
  try {
    await sync.loadConfig();
    if (sync.isOn()) { sync.start(); sync.sync({ quiet: true }); }
  } catch (e) { console.warn('Sync unavailable', e); }
  window.addEventListener('hashchange', route);
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/home');
  route();
  registerServiceWorker();
}

boot();
