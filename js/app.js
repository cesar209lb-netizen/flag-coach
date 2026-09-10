// App shell: boot, hash router, tab bar, offline service worker.

import { loadState, playById } from './store.js';
import * as sync from './sync.js';
import { openHuddle } from './views/huddle.js';
import { joinFromLink } from './views/teamsync.js';
import { h, icon, toast } from './ui.js';
import * as Home from './views/home.js';
import * as Playbook from './views/playbook.js';
import * as Editor from './views/editor.js';
import * as Roster from './views/roster.js';
import * as Settings from './views/settings.js';
import * as RouteLab from './views/routelab.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'playbook', label: 'Playbook', icon: 'playbook' },
  { id: 'routes', label: 'Routes', icon: 'route' },
  { id: 'roster', label: 'Roster', icon: 'users', coachOnly: true },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];
const VIEWS = { home: Home, playbook: Playbook, routes: RouteLab, roster: Roster, settings: Settings };

const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = null;

function renderTabs(active) {
  tabbar.replaceChildren(...TABS.filter((t) => !(t.coachOnly && sync.isViewer())).map((t) =>
    h('a', { class: `tab ${active === t.id ? 'on' : ''}`, href: `#/${t.id}` }, icon(t.icon), h('span', null, t.label))));
}

function route() {
  let [name = 'home', arg] = location.hash.replace(/^#\/?/, '').split('/');
  // A tap on a join link. Land on Home and let the join confirm open over it,
  // so a player never has to go hunting through Settings.
  if (name === 'join') {
    const code = arg;
    history.replaceState(null, '', '#/home');
    name = 'home';
    arg = undefined;
    if (code) setTimeout(() => joinFromLink(code, route), 0);
  }
  // Player view has no editor and no roster; send those back to the playbook.
  if (sync.isViewer() && (name === 'roster' || name === 'play')) {
    const playId = name === 'play' ? arg : null;
    history.replaceState(null, '', '#/playbook');
    name = 'playbook';
    arg = undefined;
    if (playId && playById(playId)) setTimeout(() => openHuddle([playId], 0), 0);
  }
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
  // Pinch is the only way back out of an accidental double-tap zoom on iOS, so
  // it is blocked on the drawing surfaces only — a stray pinch mid-route would
  // fight the route being drawn — and left alone everywhere else. Blocking it
  // for the whole document trapped anyone who zoomed in, with no way back.
  document.addEventListener('gesturestart', (e) => {
    if (e.target?.closest?.('.field-svg, .lab-field svg')) e.preventDefault();
  });
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
