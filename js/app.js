// Oberflaeche. Baut alles mit DOM-Methoden und textContent, nie mit innerHTML,
// damit kein gespeicherter Wert als HTML ausgefuehrt werden kann.

import { api, ApiError } from './api.js';
import {
  CATEGORIES,
  KINDS,
  formatId,
  guessKind,
  liveCustomers,
  changedEntryIds,
  newCustomer,
  newEntry,
  newSection,
  remoteEntries,
  reusedSecrets,
  search,
} from './model.js';
import { UnlockError, forgetDevice, loadCache, setupVault, unlock } from './vault.js';
import { prepareImage } from './images.js';
import {
  TEMPLATES,
  TEMPLATE_ORDER,
  fieldDef,
  migrateCustomer,
  missingFields,
  needsMigration,
  newTemplateSection,
  normalizeSection,
  syncTitle,
} from './templates.js';

const MIN_PASSWORD = 12;
const REVEAL_MS = 20000;
const CLIPBOARD_CLEAR_MS = 30000;

const state = {
  session: null,
  query: '',
  tab: pref('tab', 'kunden'),
  revealed: new Set(),
  draft: null,
  lockMessage: '',
};

// ---------- Hilfen ----------

function pref(key, fallback) {
  try {
    return localStorage.getItem(`itsupport.pref.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function setPref(key, value) {
  try {
    localStorage.setItem(`itsupport.pref.${key}`, value);
  } catch {
    /* egal */
  }
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  x: 'M6 6l12 12M18 6L6 18',
  go: 'M5 12h13M13 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  image: 'M4 5h16v14H4zM4 16l4-4 4 4 3-3 5 5M15.5 9.5h.01',
  restore: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function copy(text, what = 'Kopiert') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(`${what} – Zwischenablage wird in 30 s geleert`);
  setTimeout(() => {
    if (document.hasFocus()) navigator.clipboard?.writeText('').catch(() => {});
  }, CLIPBOARD_CLEAR_MS);
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', id: parts[1], sub: parts[2], vid: parts[3] };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function findCustomer(id) {
  return state.session?.data.customers.find((c) => c.id === id && !c.deleted);
}

function countEntries(c) {
  return c.sections.reduce((n, s) => n + s.entries.length, 0);
}

function fmtTime(d) {
  if (!d) return '–';
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- Rahmen ----------

const app = document.getElementById('app');
let mainEl;
let pillEl;

function render() {
  if (!state.session) return;
  if (!mainEl || !app.contains(mainEl)) renderShell();
  const r = route();
  const editing = r.name === 'k' && r.sub === 'bearbeiten';
  const searchWrap = app.querySelector('.search');
  searchWrap.classList.toggle('hidden', editing || r.name === 'einstellungen' || r.name === 'sicherheit' || r.name === 'werkzeug');
  mainEl.replaceChildren();
  if (state.query.trim() && !editing) return renderResults();
  if (r.name === 'k' && r.sub === 'bearbeiten') return renderEdit(r.id);
  if (r.name === 'k' && r.sub === 'verlauf' && r.vid) return renderVersion(r.id, r.vid);
  if (r.name === 'k' && r.sub === 'verlauf') return renderHistory(r.id);
  if (r.name === 'neu') return renderEdit(null);
  if (r.name === 'k') return renderCustomer(r.id);
  if (r.name === 'einstellungen') return renderSettings();
  if (r.name === 'sicherheit') return renderSecurity();
  if (r.name === 'werkzeug' && r.id === 'anydesk') return renderAnydeskTool();
  if (r.name === 'offen') return renderOpen(r.id);
  return renderHome();
}

function renderShell() {
  pillEl = h('span', { class: 'pill' });
  const input = h('input', {
    type: 'search',
    placeholder: 'Suchen: Kunde, Gerät, IP, AnyDesk …',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    value: state.query,
    oninput: (e) => {
      state.query = e.target.value;
      clearBtn.classList.toggle('hidden', !state.query);
      render();
    },
  });
  const clearBtn = h(
    'button',
    {
      class: `btn ghost icon clear${state.query ? '' : ' hidden'}`,
      'aria-label': 'Suche leeren',
      onclick: () => {
        state.query = '';
        input.value = '';
        clearBtn.classList.add('hidden');
        input.focus();
        render();
      },
    },
    icon('x'),
  );
  mainEl = h('main');
  topObserver?.disconnect();
  app.replaceChildren(
    h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'top-row' },
        h(
          'a',
          {
            class: 'brand',
            href: '#/',
            onclick: () => {
              clearQuery();
              if (!location.hash || location.hash === '#/') render();
            },
          },
          h('img', { src: '/icons/icon.svg', alt: '' }),
          'itSupport',
        ),
        pillEl,
        h('a', { class: 'btn ghost icon', href: '#/einstellungen', 'aria-label': 'Einstellungen' }, icon('gear')),
        h('button', { class: 'btn ghost icon', 'aria-label': 'Sperren', onclick: () => lock() }, icon('lock')),
      ),
      h('div', { class: 'search' }, h('span', { class: 'search-icon' }, icon('search')), input, clearBtn),
    ),
    mainEl,
  );
  updatePill();
  // Hoehe der Kopfzeile fuer die angeheftete Kundenleiste bereitstellen.
  const top = app.querySelector('.top');
  const setTop = () => document.documentElement.style.setProperty('--top-h', `${top.getBoundingClientRect().height}px`);
  setTop();
  topObserver = new ResizeObserver(setTop);
  topObserver.observe(top);
}

let topObserver;

function updatePill() {
  if (!pillEl || !state.session) return;
  const s = state.session.status;
  const map = {
    synced: ['Synchron', 'ok'],
    syncing: ['Synchronisiere …', ''],
    pending: ['Wird hochgeladen …', 'warn'],
    offline: [state.session.pending ? 'Offline – lokal gespeichert' : 'Offline', 'warn'],
    error: ['Sync-Fehler', 'bad'],
    auth: ['Zugang ungültig', 'bad'],
  };
  const [text, cls] = map[s] || ['', ''];
  pillEl.textContent = text;
  pillEl.className = `pill ${cls}`;
}

// ---------- Eintrag (Anzeige) ----------

function entryRow(c, s, e, { context = false, badge = '' } = {}) {
  const isRemote = e.kind === 'anydesk' || e.kind === 'teamviewer';
  const revealed = state.revealed.has(e.id);
  const fd = s && fieldDef(s, e);
  let valueEl;
  if (fd && !String(e.value || '').trim()) {
    // Leeres Standardfeld einer Vorlage
    if (e.na) valueEl = h('div', { class: 'entry-value empty-na' }, 'gibt es nicht');
    else if (fd.optional) valueEl = h('div', { class: 'entry-value empty-opt' }, '–');
    else valueEl = h('div', { class: 'entry-value empty-missing' }, 'fehlt – bitte nachtragen');
  } else if (e.secret && !revealed) {
    valueEl = h('div', { class: 'entry-value masked' }, e.value ? '••••••••' : '–');
  } else if (e.kind === 'url' && /^https?:\/\//i.test(e.value)) {
    valueEl = h('div', { class: 'entry-value' }, h('a', { href: e.value, target: '_blank', rel: 'noopener noreferrer' }, e.value));
  } else if (e.kind === 'email' && e.value) {
    valueEl = h('div', { class: 'entry-value' }, h('a', { href: `mailto:${e.value}` }, e.value));
  } else if (e.kind === 'phone' && e.value) {
    valueEl = h('div', { class: 'entry-value' }, h('a', { href: `tel:${e.value.replace(/[^\d+]/g, '')}` }, e.value));
  } else {
    valueEl = h('div', { class: `entry-value${e.label ? '' : ' plain'}` }, isRemote ? formatId(e.value) : e.value || '–');
  }

  const label = e.label || (isRemote ? KINDS[e.kind] : '');
  const actions = h('div', { class: 'entry-actions' });
  if (e.kind === 'anydesk' && e.value) {
    actions.append(
      h('a', { class: 'btn connect', href: `anydesk:${e.value.replace(/\s+/g, '')}`, title: 'In AnyDesk öffnen' }, 'Verbinden'),
    );
  }
  if (e.secret && e.value) {
    actions.append(
      h(
        'button',
        {
          class: 'btn ghost icon',
          'aria-label': revealed ? 'Verbergen' : 'Anzeigen',
          onclick: () => {
            if (state.revealed.has(e.id)) state.revealed.delete(e.id);
            else {
              state.revealed.add(e.id);
              setTimeout(() => {
                if (state.revealed.delete(e.id)) render();
              }, REVEAL_MS);
            }
            render();
          },
        },
        icon(revealed ? 'eyeOff' : 'eye'),
      ),
    );
  }
  if (e.value) {
    actions.append(
      h(
        'button',
        {
          class: 'btn ghost icon',
          'aria-label': 'Kopieren',
          onclick: () => copy(isRemote ? e.value.replace(/\s+/g, '') : e.value, e.secret ? 'Passwort kopiert' : 'Kopiert'),
        },
        icon('copy'),
      ),
    );
  }

  return h(
    'div',
    { class: 'entry' },
    h(
      'div',
      { class: 'entry-main' },
      context &&
        h(
          'a',
          { class: 'entry-ctx', href: `#/k/${c.id}`, onclick: () => clearQuery() },
          [c.name, s.title].filter(Boolean).join(' · '),
        ),
      (label || badge) && h('div', { class: 'entry-label' }, label, badge && h('span', { class: 'badge' }, badge)),
      valueEl,
      e.note && h('div', { class: 'entry-note' }, e.note),
    ),
    actions,
  );
}

// ---------- Startseite ----------

function renderHome() {
  const data = state.session.data;
  const tabs = h(
    'div',
    { class: 'tabs', role: 'tablist' },
    [
      ['kunden', 'Kunden'],
      ['fernwartung', 'Fernwartung'],
      ['offen', `Offen (${liveCustomers(state.session.data).reduce((n, c) => n + missingFields(c).length, 0)})`],
    ].map(([key, label]) =>
      h(
        'button',
        {
          class: state.tab === key ? 'on' : '',
          role: 'tab',
          'aria-selected': state.tab === key ? 'true' : 'false',
          onclick: () => {
            state.tab = key;
            setPref('tab', key);
            render();
          },
        },
        label,
      ),
    ),
  );
  mainEl.append(tabs);

  const customers = liveCustomers(data);
  if (!customers.length) {
    mainEl.append(
      h(
        'div',
        { class: 'empty' },
        h('p', {}, 'Noch keine Kunden.'),
        h('p', {}, 'Importiere deine Bestandsdaten unter ', h('a', { href: '#/einstellungen' }, 'Einstellungen'), ' oder lege einen Kunden an.'),
        h('a', { class: 'btn primary', href: '#/neu' }, icon('plus'), 'Kunde anlegen'),
      ),
    );
    return;
  }

  if (state.tab === 'offen') {
    renderOpen(null, { embedded: true });
    return;
  }

  if (state.tab === 'fernwartung') {
    const items = remoteEntries(data);
    const byCustomer = new Map();
    for (const it of items) {
      if (!byCustomer.has(it.customer.id)) byCustomer.set(it.customer.id, []);
      byCustomer.get(it.customer.id).push(it);
    }
    if (!items.length) mainEl.append(h('p', { class: 'empty' }, 'Keine AnyDesk- oder TeamViewer-IDs hinterlegt.'));
    for (const list of byCustomer.values()) {
      const c = list[0].customer;
      mainEl.append(
        h(
          'div',
          { class: 'card' },
          h('h3', {}, h('a', { href: `#/k/${c.id}` }, c.name), h('span', { class: 'muted small' }, `${list.length}`)),
          list.map(({ section, entry }) =>
            entryRow(c, section, { ...entry, label: entry.kind === 'teamviewer' ? `${section.title} – TeamViewer` : section.title || entry.label }),
          ),
        ),
      );
    }
    return;
  }

  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('span', { class: 'muted small', style: 'flex:1' }, `${customers.length} Kunden`),
      h('a', { class: 'btn', href: '#/neu' }, icon('plus'), 'Kunde'),
    ),
    h(
      'div',
      { class: 'card' },
      customers.map((c) => {
        const remote = c.sections.reduce((n, s) => n + s.entries.filter((e) => e.kind === 'anydesk').length, 0);
        const imgs = (c.attachments || []).length;
        const sub = [`${countEntries(c)} Einträge`, remote ? `${remote} AnyDesk` : '', imgs ? `${imgs} Bilder` : ''].filter(Boolean).join(' · ');
        return h(
          'a',
          { class: 'list-item', href: `#/k/${c.id}` },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name), h('div', { class: 'sub' }, sub)),
          h('span', { class: 'chev' }, icon('chev')),
        );
      }),
    ),
  );
}

// ---------- Suche ----------

function renderResults() {
  const hits = search(state.session.data, state.query);
  if (!hits.length) {
    mainEl.append(h('p', { class: 'empty' }, `Nichts gefunden für „${state.query.trim()}“.`));
    return;
  }
  const customerHits = hits.filter((x) => !x.entry);
  const entryHits = hits.filter((x) => x.entry);
  if (customerHits.length) {
    mainEl.append(
      h(
        'div',
        { class: 'card' },
        customerHits.map(({ customer: c }) =>
          h(
            'a',
            { class: 'list-item', href: `#/k/${c.id}`, onclick: () => clearQuery() },
            h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name), h('div', { class: 'sub' }, `${countEntries(c)} Einträge`)),
            h('span', { class: 'chev' }, icon('chev')),
          ),
        ),
      ),
    );
  }
  if (entryHits.length) {
    mainEl.append(
      h('div', { class: 'card' }, entryHits.map(({ customer, section, entry }) => entryRow(customer, section, entry, { context: true }))),
    );
  }
}

function clearQuery() {
  state.query = '';
  const input = app.querySelector('.search input');
  if (input) input.value = '';
  app.querySelector('.search .clear')?.classList.add('hidden');
}

// ---------- Kundenansicht ----------

// Hinweise wie "Importiert am 30.09.2026." nicht anzeigen.
function visibleNote(note) {
  return String(note || '')
    .split('\n')
    .filter((l) => !/^Importiert am \d{1,2}\.\d{1,2}\.\d{4}\.?$/.test(l.trim()))
    .join('\n')
    .trim();
}

function renderCustomer(id) {
  const c = findCustomer(id);
  if (!c) {
    mainEl.append(h('p', { class: 'empty' }, 'Kunde nicht gefunden. ', h('a', { href: '#/' }, 'Zur Übersicht')));
    return;
  }
  const cats = CATEGORIES.filter((cat) => c.sections.some((s) => s.category === cat));
  const others = c.sections.filter((s) => !CATEGORIES.includes(s.category));
  const images = c.attachments || [];

  // Kapitel fuer die angeheftete Leiste: [id, Beschriftung]
  const chapters = cats.map((cat) => [`cat-${CATEGORIES.indexOf(cat)}`, cat]);
  if (images.length) chapters.push(['cat-bilder', `Bilder (${images.length})`]);

  const chipLinks = chapters.map(([cid, label]) =>
    h(
      'a',
      {
        href: '#',
        'data-target': cid,
        onclick: (ev) => {
          ev.preventDefault();
          scrollToChapter(cid);
        },
      },
      label,
    ),
  );

  // Name, Knoepfe und Kapitel bleiben beim Scrollen oben angeheftet.
  mainEl.append(
    h(
      'div',
      { class: 'sticky-head' },
      h(
        'div',
        { class: 'row-head' },
        h('a', { class: 'btn ghost icon', href: '#/', 'aria-label': 'Zurück' }, icon('back')),
        h('h1', {}, c.name),
        h(
          'a',
          { class: 'btn icon', href: `#/k/${c.id}/verlauf`, 'aria-label': 'Verlauf', title: `Verlauf (${(c.versions || []).length} Versionen)` },
          icon('clock'),
        ),
        h('a', { class: 'btn', href: `#/k/${c.id}/bearbeiten`, 'aria-label': 'Bearbeiten' }, icon('edit'), h('span', { class: 'btn-label' }, 'Bearbeiten')),
      ),
      chapters.length > 1 && h('nav', { class: 'chips' }, chipLinks),
    ),
  );
  const note = visibleNote(c.note);
  if (note) mainEl.append(h('div', { class: 'note' }, note));
  if (needsMigration(c)) {
    mainEl.append(
      h(
        'div',
        { class: 'version-banner' },
        h('div', {}, h('b', {}, 'Noch nicht auf Vorlagen umgestellt.'), ' Felder sind uneinheitlich benannt.'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              await state.session.commitCustomers([migrateCustomer(c)]);
              toast('Umgestellt – der alte Stand ist im Verlauf');
            },
          },
          'Jetzt umstellen',
        ),
      ),
    );
  } else {
    const open = missingFields(c).length;
    if (open) mainEl.append(h('a', { class: 'open-link', href: `#/offen/${c.id}` }, `${open} offene Punkte – nachtragen`));
  }

  for (const cat of cats) {
    mainEl.append(h('h2', { class: 'cat', id: `cat-${CATEGORIES.indexOf(cat)}` }, cat));
    for (const s of c.sections.filter((x) => x.category === cat)) mainEl.append(sectionCard(c, s));
  }
  for (const s of others) mainEl.append(sectionCard(c, s));
  if (images.length) {
    mainEl.append(h('h2', { class: 'cat', id: 'cat-bilder' }, `Bilder (${images.length})`));
    mainEl.append(imageGallery(images));
  }
  if (!c.sections.length && !images.length) mainEl.append(h('p', { class: 'empty' }, 'Noch keine Einträge. Tippe auf „Bearbeiten“.'));
  mainEl.append(
    h('p', { class: 'muted small', style: 'margin-top:18px' }, `Zuletzt geändert ${fmtTime(c.updatedAt)}${c.updatedBy ? ` von ${c.updatedBy}` : ''}`),
  );
  updateActiveChip();
}

// Hoehe von Kopfzeile + angehefteter Kundenleiste, damit Kapitel nicht darunter verschwinden.
function stickyOffset() {
  const top = app.querySelector('.top')?.getBoundingClientRect().height || 0;
  const head = mainEl?.querySelector('.sticky-head')?.getBoundingClientRect().height || 0;
  return top + head + 8;
}

function scrollToChapter(cid) {
  const el = document.getElementById(cid);
  if (!el) return;
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - stickyOffset(), behavior: 'smooth' });
}

// Markiert in der Kapitelleiste das Kapitel, in dem man gerade ist.
function updateActiveChip() {
  const nav = mainEl?.querySelector('.sticky-head .chips');
  if (!nav) return;
  const offset = stickyOffset() + 4;
  let current = null;
  for (const a of nav.querySelectorAll('a[data-target]')) {
    const el = document.getElementById(a.dataset.target);
    if (el && el.getBoundingClientRect().top <= offset) current = a;
  }
  if (!current) current = nav.querySelector('a[data-target]');
  const bottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
  if (bottom) current = [...nav.querySelectorAll('a[data-target]')].pop();
  for (const a of nav.querySelectorAll('a[data-target]')) a.classList.toggle('on', a === current);
  current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let chipFrame = 0;
addEventListener(
  'scroll',
  () => {
    if (chipFrame) return;
    chipFrame = requestAnimationFrame(() => {
      chipFrame = 0;
      updateActiveChip();
    });
  },
  { passive: true },
);

function sectionCard(c, s) {
  const t = TEMPLATES[s.type];
  const open = t ? missingFields({ sections: [s] }).length : 0;
  return h(
    'div',
    { class: 'card' },
    (s.title || t) &&
      h(
        'h3',
        {},
        h('span', {}, s.title || t.label),
        t && h('span', { class: 'muted small' }, [t.label !== s.title ? t.label : '', open ? `${open} offen` : ''].filter(Boolean).join(' · ')),
      ),
    s.entries.length ? s.entries.map((e) => entryRow(c, s, e)) : h('div', { class: 'entry muted small' }, 'Leer'),
  );
}

// ---------- Bilder ----------

const imageUrls = new Map();

async function imageURL(att) {
  if (imageUrls.has(att.id)) return imageUrls.get(att.id);
  const bytes = await state.session.getBlobBytes(att.id);
  const url = URL.createObjectURL(new Blob([bytes], { type: att.mime || 'image/jpeg' }));
  imageUrls.set(att.id, url);
  return url;
}

function thumb(att, onClick) {
  const img = h('img', { alt: att.title || 'Bild', loading: 'lazy' });
  const box = h('button', { class: 'thumb', type: 'button', onclick: onClick, title: att.title || '' }, img);
  imageURL(att)
    .then((url) => (img.src = url))
    .catch(() => box.append(h('span', { class: 'thumb-missing' }, 'offline nicht verfügbar')));
  return box;
}

function imageGallery(images) {
  const groups = new Map();
  for (const a of images) {
    const g = a.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  const wrap = h('div', { class: 'gallery' });
  for (const [g, list] of groups) {
    wrap.append(
      h(
        'div',
        { class: 'card' },
        g && h('h3', {}, g, h('span', { class: 'muted small' }, `${list.length}`)),
        h(
          'div',
          { class: 'thumbs' },
          list.map((a) =>
            h(
              'figure',
              {},
              thumb(a, () => openViewer(images, images.indexOf(a))),
              a.title && h('figcaption', {}, a.title),
            ),
          ),
        ),
      ),
    );
  }
  return wrap;
}

function openViewer(list, index) {
  closeViewer();
  let i = index;
  const img = h('img', { alt: '' });
  const caption = h('div', { class: 'viewer-caption' });
  const stage = h('div', { class: 'viewer-stage', onclick: () => stage.classList.toggle('zoom') }, img);
  const show = async () => {
    const a = list[i];
    caption.textContent = `${a.title || 'Bild'}  ·  ${i + 1}/${list.length}`;
    stage.classList.remove('zoom');
    img.removeAttribute('src');
    try {
      img.src = await imageURL(a);
    } catch {
      caption.textContent += ' – offline nicht verfügbar';
    }
  };
  const nav = (d) => {
    i = (i + d + list.length) % list.length;
    show();
  };
  const el = h(
    'div',
    { class: 'viewer', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'viewer-bar' },
      caption,
      list.length > 1 && h('button', { class: 'btn ghost icon', 'aria-label': 'Vorheriges', onclick: () => nav(-1) }, icon('left')),
      list.length > 1 && h('button', { class: 'btn ghost icon', 'aria-label': 'Nächstes', onclick: () => nav(1) }, icon('right')),
      h('button', { class: 'btn ghost icon', 'aria-label': 'Schließen', onclick: () => closeViewer() }, icon('x')),
    ),
    stage,
    h('div', { class: 'viewer-hint' }, 'Tippen zum Vergrößern'),
  );
  el._keys = (ev) => {
    if (ev.key === 'Escape') closeViewer();
    if (ev.key === 'ArrowLeft') nav(-1);
    if (ev.key === 'ArrowRight') nav(1);
  };
  addEventListener('keydown', el._keys);
  document.body.append(el);
  show();
}

function closeViewer() {
  const el = document.querySelector('.viewer');
  if (!el) return;
  removeEventListener('keydown', el._keys);
  el.remove();
}

// ---------- Verlauf ----------

function renderHistory(id) {
  const c = findCustomer(id);
  if (!c) {
    mainEl.append(h('p', { class: 'empty' }, 'Kunde nicht gefunden.'));
    return;
  }
  const versions = c.versions || [];
  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: `#/k/${c.id}`, 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, `Verlauf: ${c.name}`),
    ),
    h(
      'p',
      { class: 'muted' },
      'Bei jeder Änderung wird der vorherige Stand aufgehoben (bis zu 50 Versionen). Öffne eine Version, um alte Werte anzusehen, zu kopieren oder den ganzen Stand wiederherzustellen.',
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'list-item' },
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'title' }, `Aktueller Stand · ${fmtTime(c.updatedAt)}`),
          h('div', { class: 'sub' }, c.updatedBy ? `von ${c.updatedBy}` : ''),
        ),
      ),
      versions.map((v) =>
        h(
          'a',
          { class: 'list-item', href: `#/k/${c.id}/verlauf/${v.id}` },
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'title' }, `Stand vom ${fmtTime(v.at)}${v.by ? ` · ${v.by}` : ''}`),
            h('div', { class: 'sub' }, `ersetzt am ${fmtTime(v.savedAt)}${v.savedBy ? ` von ${v.savedBy}` : ''}`),
            (v.summary || []).length > 0 &&
              h('div', { class: 'sub' }, `Danach: ${v.summary.join(' · ')}${v.more ? ` · und ${v.more} weitere` : ''}`),
          ),
          h('span', { class: 'chev' }, icon('chev')),
        ),
      ),
    ),
  );
  if (!versions.length) mainEl.append(h('p', { class: 'empty' }, 'Noch keine früheren Versionen.'));
}

async function renderVersion(id, vid) {
  const c = state.session.data.customers.find((x) => x.id === id);
  const v = c?.versions?.find((x) => x.id === vid);
  const target = mainEl;
  if (!c || !v) {
    target.append(h('p', { class: 'empty' }, 'Version nicht gefunden.'));
    return;
  }
  target.append(h('p', { class: 'muted' }, 'Lade Version …'));
  let snap;
  try {
    snap = await state.session.loadVersion(vid);
  } catch {
    if (target !== mainEl || route().vid !== vid) return;
    target.replaceChildren(h('p', { class: 'empty' }, 'Diese Version ist offline nicht verfügbar. Bitte mit Internet erneut öffnen.'));
    return;
  }
  if (target !== mainEl || route().vid !== vid) return;
  const changed = changedEntryIds(snap, c.deleted ? null : c);
  target.replaceChildren(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: `#/k/${id}/verlauf`, 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, snap.name),
    ),
    h(
      'div',
      { class: 'version-banner' },
      h('div', {}, h('b', {}, `Alte Version: Stand vom ${fmtTime(v.at)}`), v.by ? ` (von ${v.by})` : ''),
      h('div', { class: 'small' }, 'Einträge, die heute anders lauten, sind mit „anders als jetzt“ markiert.'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            if (!confirm('Diese Version wiederherstellen? Der aktuelle Stand wird dabei als Version aufgehoben.')) return;
            try {
              await state.session.restoreVersion(id, vid);
              toast('Version wiederhergestellt');
              go(`#/k/${id}`);
            } catch {
              toast('Wiederherstellen fehlgeschlagen – bitte mit Internet erneut versuchen.');
            }
          },
        },
        icon('restore'),
        'Diese Version wiederherstellen',
      ),
    ),
  );
  if (snap.note) target.append(h('div', { class: 'note' }, snap.note));
  for (const s of snap.sections || []) {
    target.append(
      h(
        'div',
        { class: 'card' },
        s.title && h('h3', {}, s.title, h('span', { class: 'muted small' }, s.category)),
        s.entries.map((e) => entryRow(snap, s, e, { badge: changed.has(e.id) ? 'anders als jetzt' : '' })),
      ),
    );
  }
  if ((snap.attachments || []).length) {
    target.append(h('h2', { class: 'cat' }, `Bilder (${snap.attachments.length})`), imageGallery(snap.attachments));
  }
}

// ---------- Bearbeiten ----------

function renderEdit(id) {
  const user = state.session.user;
  const key = id || 'neu';
  if (!state.draft || state.draft._key !== key) {
    const base = id ? findCustomer(id) : null;
    if (id && !base) {
      mainEl.append(h('p', { class: 'empty' }, 'Kunde nicht gefunden.'));
      return;
    }
    state.draft = base ? structuredClone(base) : newCustomer('', user);
    if (!base) state.draft.sections.push(newTemplateSection('firma'));
    state.draft._for = id || null;
    state.draft._key = key;
  }
  const d = state.draft;
  const isNew = !d._for;
  const rerender = () => render();

  const nameInput = h('input', { class: 'inp', value: d.name, placeholder: 'z. B. Muster GmbH', oninput: (e) => (d.name = e.target.value) });
  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('button', { class: 'btn ghost icon', 'aria-label': 'Abbrechen', onclick: () => cancelEdit() }, icon('back')),
      h('h1', {}, isNew ? 'Neuer Kunde' : 'Bearbeiten'),
    ),
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Notiz zum Kunden'),
      h('textarea', { class: 'inp', value: d.note || '', oninput: (e) => (d.note = e.target.value) }),
    ),
  );

  function templateEditCard(s, si) {
    normalizeSection(s);
    const t = TEMPLATES[s.type];
    const card = h(
      'div',
      { class: 'edit-sec tpl' },
      h(
        'div',
        { class: 'tpl-head' },
        h('span', { class: 'tpl-type' }, t.label),
        h('b', { class: 'tpl-title' }, s.title !== t.label ? s.title : ''),
        h(
          'button',
          {
            class: 'btn danger icon',
            'aria-label': `${t.label} entfernen`,
            onclick: () => {
              if (!confirm(`${t.label} „${s.title}“ entfernen? (bleibt im Verlauf erhalten)`)) return;
              d.sections.splice(si, 1);
              rerender();
            },
          },
          icon('trash'),
        ),
      ),
    );
    for (const e of s.entries) {
      const fd = e.field && t.fields.find((x) => x.key === e.field);
      if (fd) {
        const isTitle = fd.key === t.titleField;
        const valueInp = h('input', {
          class: `inp${fd.secret || fd.kind !== 'text' ? ' mono' : ''}`,
          value: e.value,
          placeholder: e.na ? 'gibt es nicht' : fd.optional ? 'optional' : '',
          disabled: e.na ? true : null,
          autocapitalize: 'off',
          autocomplete: 'off',
          spellcheck: 'false',
          oninput: (ev) => {
            e.value = ev.target.value;
            if (isTitle) syncTitle(s);
          },
        });
        card.append(
          h(
            'div',
            { class: 'tpl-row' },
            h('label', { class: 'tpl-label' }, fd.label, fd.secret && h('span', { class: 'muted small' }, ' (geheim)')),
            valueInp,
            !isTitle
              ? h(
                  'label',
                  { class: 'check small', title: 'Bei diesem Kunden nicht vorhanden – zählt nicht als offen' },
                  h('input', {
                    type: 'checkbox',
                    checked: !!e.na,
                    onchange: (ev) => {
                      e.na = ev.target.checked;
                      valueInp.disabled = e.na;
                      valueInp.placeholder = e.na ? 'gibt es nicht' : fd.optional ? 'optional' : '';
                    },
                  }),
                  'gibt es nicht',
                )
              : h('span'),
          ),
        );
      } else {
        const ei = s.entries.indexOf(e);
        card.append(
          h(
            'div',
            { class: 'tpl-row extra' },
            h('input', { class: 'inp', value: e.label, placeholder: 'Zusatzfeld', oninput: (ev) => (e.label = ev.target.value) }),
            h('input', {
              class: 'inp mono',
              value: e.value,
              placeholder: 'Wert',
              autocapitalize: 'off',
              autocomplete: 'off',
              spellcheck: 'false',
              oninput: (ev) => (e.value = ev.target.value),
              onchange: () => {
                if (e.kind === 'text') e.kind = guessKind(e.label, e.value);
              },
            }),
            h(
              'div',
              { class: 'tpl-extra-opts' },
              h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: e.secret, onchange: (ev) => (e.secret = ev.target.checked) }), 'geheim'),
              h(
                'button',
                {
                  class: 'btn danger icon',
                  'aria-label': 'Zusatzfeld löschen',
                  onclick: () => {
                    s.entries.splice(ei, 1);
                    rerender();
                  },
                },
                icon('trash'),
              ),
            ),
          ),
        );
      }
    }
    card.append(
      h(
        'div',
        { class: 'bar', style: 'margin-top:8px' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              s.entries.push(newEntry());
              rerender();
            },
          },
          icon('plus'),
          'Zusatzfeld',
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              s.entries.push(newEntry({ label: 'Passwort', secret: true }));
              rerender();
            },
          },
          icon('plus'),
          'Zusatz-Passwort',
        ),
      ),
    );
    return card;
  }

  d.sections.forEach((s, si) => {
    if (s.type) {
      mainEl.append(templateEditCard(s, si));
      return;
    }
    const sec = h(
      'div',
      { class: 'edit-sec' },
      h(
        'div',
        { class: 'sec-head' },
        h('input', { class: 'inp', value: s.title, placeholder: 'Bereich, z. B. Server', oninput: (e) => (s.title = e.target.value) }),
        h(
          'select',
          { class: 'inp', onchange: (e) => (s.category = e.target.value) },
          CATEGORIES.map((cat) => h('option', { value: cat, selected: cat === s.category ? 'selected' : null }, cat)),
        ),
        h(
          'button',
          {
            class: 'btn danger icon',
            'aria-label': 'Bereich löschen',
            onclick: () => {
              if (s.entries.length && !confirm(`Bereich „${s.title || 'ohne Titel'}“ mit ${s.entries.length} Einträgen löschen?`)) return;
              d.sections.splice(si, 1);
              rerender();
            },
          },
          icon('trash'),
        ),
      ),
    );
    s.entries.forEach((e, ei) => {
      const valueInput = h('input', {
        class: 'inp mono',
        value: e.value,
        placeholder: 'Wert',
        autocapitalize: 'off',
        autocomplete: 'off',
        spellcheck: 'false',
        oninput: (ev) => {
          e.value = ev.target.value;
        },
        onchange: () => {
          if (e.kind === 'text') {
            e.kind = guessKind(e.label, e.value);
            kindSel.value = e.kind;
          }
        },
      });
      const kindSel = h(
        'select',
        { class: 'inp', 'aria-label': 'Art', onchange: (ev) => (e.kind = ev.target.value) },
        Object.entries(KINDS).map(([k, label]) => h('option', { value: k, selected: k === e.kind ? 'selected' : null }, label)),
      );
      sec.append(
        h(
          'div',
          { class: 'edit-entry' },
          h('input', { class: 'inp', value: e.label, placeholder: 'Bezeichnung, z. B. Admin-Passwort', oninput: (ev) => (e.label = ev.target.value) }),
          valueInput,
          h(
            'div',
            { class: 'opts' },
            kindSel,
            h(
              'label',
              { class: 'check' },
              h('input', { type: 'checkbox', checked: e.secret, onchange: (ev) => (e.secret = ev.target.checked) }),
              'geheim',
            ),
            h('input', { class: 'inp', value: e.note || '', placeholder: 'Notiz', oninput: (ev) => (e.note = ev.target.value) }),
            h(
              'button',
              { class: 'btn ghost icon', 'aria-label': 'Nach oben', disabled: ei === 0, onclick: () => move(s.entries, ei, -1) },
              icon('up'),
            ),
            h(
              'button',
              {
                class: 'btn ghost icon',
                'aria-label': 'Nach unten',
                disabled: ei === s.entries.length - 1,
                onclick: () => move(s.entries, ei, 1),
              },
              icon('down'),
            ),
            h(
              'button',
              {
                class: 'btn danger icon',
                'aria-label': 'Eintrag löschen',
                onclick: () => {
                  s.entries.splice(ei, 1);
                  rerender();
                },
              },
              icon('trash'),
            ),
          ),
        ),
      );
    });
    sec.append(
      h(
        'div',
        { class: 'bar', style: 'margin-top:8px' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              s.entries.push(newEntry());
              rerender();
            },
          },
          icon('plus'),
          'Eintrag',
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              s.entries.push(newEntry({ label: 'Passwort', secret: true }));
              rerender();
            },
          },
          icon('plus'),
          'Passwort',
        ),
      ),
    );
    mainEl.append(sec);
  });

  function move(list, i, dir) {
    const [x] = list.splice(i, 1);
    list.splice(i + dir, 0, x);
    rerender();
  }

  d.attachments ||= [];
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    class: 'hidden',
    onchange: async (ev) => {
      const files = [...ev.target.files];
      ev.target.value = '';
      for (const [i, f] of files.entries()) {
        toast(`Bild ${i + 1}/${files.length} wird verschlüsselt …`);
        try {
          const meta = await state.session.addImage(await prepareImage(f), { title: f.name.replace(/\.[^.]+$/, '') });
          d.attachments.push(meta);
        } catch (e) {
          console.error(e);
          toast(`„${f.name}“ konnte nicht gelesen werden.`);
        }
      }
      rerender();
    },
  });
  const imgSec = h(
    'div',
    { class: 'edit-sec' },
    h('div', { class: 'sec-title' }, `Bilder (${d.attachments.length})`),
    d.attachments.map((a, ai) =>
      h(
        'div',
        { class: 'edit-image' },
        thumb(a, () => openViewer(d.attachments, ai)),
        h(
          'div',
          { class: 'edit-image-fields' },
          h('input', { class: 'inp', value: a.title || '', placeholder: 'Titel, z. B. Router-Aufkleber', oninput: (ev) => (a.title = ev.target.value) }),
          h('input', { class: 'inp', value: a.group || '', placeholder: 'Gruppe (optional), z. B. Türsprechanlage', oninput: (ev) => (a.group = ev.target.value) }),
        ),
        h(
          'button',
          {
            class: 'btn danger icon',
            'aria-label': 'Bild entfernen',
            onclick: () => {
              d.attachments.splice(ai, 1);
              rerender();
            },
          },
          icon('trash'),
        ),
      ),
    ),
    h('div', { class: 'bar', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('image'), 'Bild hinzufügen'), fileInput),
    h('p', { class: 'muted small' }, 'Am iPhone kannst du auch direkt ein Foto aufnehmen. Entfernte Bilder bleiben im Verlauf erhalten.'),
  );
  mainEl.append(imgSec);

  mainEl.append(
    h(
      'div',
      { class: 'bar' },
      TEMPLATE_ORDER.filter((type) => !(TEMPLATES[type].single && d.sections.some((x) => x.type === type))).map((type) =>
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const sec = newTemplateSection(type, type === 'firma' ? { name: d.name } : {});
              // An passender Stelle einfuegen: hinter der letzten Karte gleicher Art bzw. Reihenfolge.
              const rank = (x) => (x.type ? TEMPLATE_ORDER.indexOf(x.type) : 99);
              let at = d.sections.length;
              for (let i = d.sections.length - 1; i >= 0; i--) {
                if (rank(d.sections[i]) <= rank(sec)) {
                  at = i + 1;
                  break;
                }
                at = i;
              }
              d.sections.splice(at, 0, sec);
              rerender();
              setTimeout(() => mainEl.querySelectorAll('.edit-sec')[at]?.querySelector('input')?.focus(), 0);
            },
          },
          icon('plus'),
          TEMPLATES[type].label,
        ),
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            d.sections.push(newSection('', 'Notizen'));
            rerender();
          },
        },
        icon('plus'),
        'Freier Bereich',
      ),
    ),
    h(
      'div',
      { class: 'bar sticky-bar' },
      h('button', { class: 'btn primary', onclick: () => saveDraft() }, 'Speichern'),
      h('button', { class: 'btn', onclick: () => cancelEdit() }, 'Abbrechen'),
      !isNew && h('span', { style: 'flex:1' }),
      !isNew && h('button', { class: 'btn danger', onclick: () => deleteCustomer() }, icon('trash'), 'Kunde löschen'),
    ),
  );
  if (isNew) nameInput.focus();
}

function cancelEdit() {
  const id = state.draft?._for;
  state.draft = null;
  go(id ? `#/k/${id}` : '#/');
}

async function saveDraft() {
  const d = state.draft;
  d.name = d.name.trim();
  if (!d.name) {
    toast('Bitte einen Namen eingeben.');
    return;
  }
  const clean = structuredClone(d);
  delete clean._for;
  delete clean._key;
  clean.attachments = (clean.attachments || []).map((a) => ({ ...a, title: (a.title || '').trim(), group: (a.group || '').trim() }));
  clean.sections = clean.sections
    .map((s) => {
      if (s.type) {
        const sec = normalizeSection({ ...s, entries: s.entries.filter((e) => e.field || e.label.trim() || e.value.trim()) });
        if (s.type === 'firma') {
          const n = sec.entries.find((e) => e.field === 'name');
          if (!n.value.trim()) n.value = clean.name;
        }
        for (const e of sec.entries) e.value = e.value.trim();
        return syncTitle(sec);
      }
      return { ...s, title: s.title.trim(), entries: s.entries.filter((e) => e.label.trim() || e.value.trim()) };
    })
    .filter((s) => s.type || s.title || s.entries.length);
  state.draft = null;
  await state.session.commitCustomers([clean]);
  toast('Gespeichert – der vorherige Stand ist im Verlauf');
  go(`#/k/${clean.id}`);
}

async function deleteCustomer() {
  const d = state.draft;
  if (!confirm(`„${d.name}“ löschen?\n\nDer Kunde landet im Papierkorb (Einstellungen) und kann dort wiederhergestellt werden.`)) return;
  state.draft = null;
  // Grabstein statt Entfernen, damit das Loeschen auf alle Geraete uebertragen wird;
  // der letzte Stand bleibt als Version erhalten.
  await state.session.deleteCustomer(d._for);
  toast('Kunde in den Papierkorb gelegt');
  go('#/');
}

// ---------- Offene Punkte ----------

function renderOpen(customerId, { embedded = false } = {}) {
  const all = liveCustomers(state.session.data).filter((c) => !customerId || c.id === customerId);
  const items = all.flatMap((c) => missingFields(c).map((m) => ({ ...m, customer: c })));
  const unmigrated = all.filter(needsMigration);
  if (!embedded) {
    mainEl.append(
      h(
        'div',
        { class: 'row-head' },
        h('a', { class: 'btn ghost icon', href: customerId ? `#/k/${customerId}` : '#/', 'aria-label': 'Zurück' }, icon('back')),
        h('h1', {}, customerId ? `Offen: ${all[0]?.name || ''}` : 'Offene Punkte'),
      ),
    );
  }
  if (unmigrated.length) {
    mainEl.append(
      h(
        'p',
        { class: 'version-banner' },
        `${unmigrated.length} Kunden sind noch nicht auf Vorlagen umgestellt und fehlen hier. `,
        h('a', { href: '#/einstellungen' }, 'Unter Einstellungen → Werkzeuge umstellen'),
      ),
    );
  }
  if (!items.length) {
    mainEl.append(h('p', { class: 'empty' }, 'Nichts offen – alles nachgetragen. 🎉'));
    return;
  }
  // Ueberblick: welches Feld fehlt wie oft
  if (!customerId) {
    const byField = new Map();
    for (const it of items) {
      const k = `${TEMPLATES[it.type].label}: ${it.field.label}`;
      byField.set(k, (byField.get(k) || 0) + 1);
    }
    mainEl.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Was am häufigsten fehlt', h('span', { class: 'muted small' }, `${items.length} gesamt`)),
        h(
          'div',
          { class: 'open-summary' },
          [...byField]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([k, n]) => h('span', { class: 'pill' }, `${k} · ${n}`)),
        ),
      ),
    );
  }
  mainEl.append(
    h(
      'p',
      { class: 'muted small' },
      'Tippe auf einen Punkt, um den Kunden zu bearbeiten. „Gibt es nicht“ blendet ihn dauerhaft aus (z. B. Person ohne Apple-ID).',
    ),
  );
  const byCustomer = new Map();
  for (const it of items) {
    if (!byCustomer.has(it.customer.id)) byCustomer.set(it.customer.id, []);
    byCustomer.get(it.customer.id).push(it);
  }
  for (const list of byCustomer.values()) {
    const c = list[0].customer;
    mainEl.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, h('a', { href: `#/k/${c.id}` }, c.name), h('span', { class: 'muted small' }, `${list.length} offen`)),
        list.map((it) =>
          h(
            'div',
            { class: 'list-item' },
            h(
              'a',
              { class: 'grow', href: `#/k/${c.id}/bearbeiten`, style: 'text-decoration:none;color:inherit' },
              h('div', { class: 'title' }, it.field.label),
              h('div', { class: 'sub' }, `${TEMPLATES[it.type].label}${it.section.title && it.section.title !== TEMPLATES[it.type].label ? ` „${it.section.title}“` : ''}`),
            ),
            h(
              'button',
              {
                class: 'btn small-btn',
                onclick: async () => {
                  const next = structuredClone(c);
                  const e = next.sections.find((x) => x.id === it.section.id)?.entries.find((x) => x.id === it.entry.id);
                  if (!e) return;
                  e.na = true;
                  await state.session.commitCustomers([next]);
                  toast(`„${it.field.label}“ als nicht vorhanden markiert`);
                },
              },
              'gibt es nicht',
            ),
          ),
        ),
      ),
    );
  }
}

// ---------- Werkzeug: AnyDesk-Passwort fuer alle Geraete ----------

function renderAnydeskTool() {
  const data = state.session.data;
  const customers = liveCustomers(data);
  // Quellen: geheime Eintraege, Kunden mit "Franchcom" im Namen zuerst.
  const sources = [];
  const ordered = [...customers].sort((a, b) => /franchcom/i.test(b.name) - /franchcom/i.test(a.name));
  for (const c of ordered) {
    for (const sec of c.sections) for (const e of sec.entries) if (e.secret && e.value) sources.push({ c, sec, e });
  }
  const groups = new Map();
  for (const x of sources) {
    if (!groups.has(x.c.name)) groups.set(x.c.name, []);
    groups.get(x.c.name).push(x);
  }
  const select = h(
    'select',
    { class: 'inp' },
    h('option', { value: '' }, '– Passwort auswählen –'),
    h('option', { value: 'eigenes' }, 'Eigenes Passwort eingeben …'),
    [...groups].map(([name, list]) =>
      h(
        'optgroup',
        { label: name },
        list.map((x) => h('option', { value: x.e.id }, [x.sec.title, x.e.label].filter(Boolean).join(' – ') || 'Passwort')),
      ),
    ),
  );
  const own = h('input', { class: 'inp mono hidden', type: 'text', autocomplete: 'off', placeholder: 'Passwort' });
  const labelInp = h('input', { class: 'inp', value: 'AnyDesk-Passwort' });
  const overwrite = h('input', { type: 'checkbox' });
  const preview = h('p', { class: 'muted' });
  const isTarget = (e, label) => e.label.trim().toLowerCase() === label.trim().toLowerCase();

  const plan = () => {
    const label = labelInp.value.trim() || 'AnyDesk-Passwort';
    let add = 0;
    let update = 0;
    let keep = 0;
    const devices = new Set();
    for (const c of customers) {
      for (const sec of c.sections) {
        if (!sec.entries.some((e) => e.kind === 'anydesk' && e.value)) continue;
        devices.add(sec.id);
        const existing = sec.entries.find((e) => isTarget(e, label));
        if (!existing || !existing.value) add++;
        else if (overwrite.checked) update++;
        else keep++;
      }
    }
    return { label, add, update, keep, devices: devices.size };
  };
  const value = () => {
    if (select.value === 'eigenes') return own.value;
    return sources.find((x) => x.e.id === select.value)?.e.value || '';
  };
  const refresh = () => {
    own.classList.toggle('hidden', select.value !== 'eigenes');
    const p = plan();
    preview.textContent =
      `${p.devices} AnyDesk-Geräte: bei ${p.add} wird „${p.label}“ neu eingetragen` +
      (p.update ? `, bei ${p.update} überschrieben` : '') +
      (p.keep ? `, ${p.keep} haben schon eins und bleiben unverändert` : '') +
      '.';
  };
  select.onchange = refresh;
  labelInp.oninput = refresh;
  overwrite.onchange = refresh;
  refresh();

  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: '#/einstellungen', 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, 'AnyDesk-Passwort eintragen'),
    ),
    h(
      'div',
      { class: 'settings' },
      h(
        'section',
        {},
        h('p', { class: 'muted small' }, 'Trägt ein Passwort bei jedem Gerät ein, das eine AnyDesk-ID hat – direkt unter der ID. Jede Änderung landet im Verlauf des Kunden und lässt sich dort rückgängig machen.'),
        h('label', { class: 'field' }, h('span', {}, 'Welches Passwort?'), select),
        own,
        h('label', { class: 'field', style: 'margin-top:12px' }, h('span', {}, 'Bezeichnung des Eintrags'), labelInp),
        h('label', { class: 'check' }, overwrite, 'Vorhandene Einträge mit dieser Bezeichnung überschreiben'),
        preview,
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const v = value();
              if (!v) return toast('Bitte zuerst ein Passwort auswählen.');
              const p = plan();
              if (!p.add && !p.update) return toast('Es gibt nichts einzutragen.');
              if (!confirm(`Bei ${p.add + p.update} AnyDesk-Geräten „${p.label}“ eintragen?`)) return;
              const changed = [];
              for (const c of customers) {
                const next = structuredClone(c);
                let touched = false;
                for (const sec of next.sections) {
                  const idx = sec.entries.findIndex((e) => e.kind === 'anydesk' && e.value);
                  if (idx < 0) continue;
                  const existing = sec.entries.find((e) => isTarget(e, p.label));
                  if (existing) {
                    if (existing.value && (!overwrite.checked || existing.value === v)) continue;
                    existing.na = false;
                    existing.value = v;
                    existing.secret = true;
                  } else {
                    sec.entries.splice(idx + 1, 0, newEntry({ label: p.label, value: v, secret: true }));
                  }
                  touched = true;
                }
                if (touched) changed.push(next);
              }
              await state.session.commitCustomers(changed);
              toast(`Bei ${changed.length} Kunden eingetragen – rückgängig über den Verlauf`);
              go('#/');
            },
          },
          'Eintragen',
        ),
      ),
    ),
  );
}

// ---------- Sicherheitscheck ----------

function renderSecurity() {
  const groups = reusedSecrets(state.session.data);
  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: '#/einstellungen', 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, 'Mehrfach verwendete Passwörter'),
    ),
    h(
      'p',
      { class: 'muted' },
      'Diese Passwörter kommen bei mehreren Kunden vor. Wird eines davon bekannt, sind alle diese Zugänge offen. Die Passwörter selbst werden hier nicht angezeigt.',
    ),
  );
  if (!groups.length) {
    mainEl.append(h('p', { class: 'empty' }, 'Keine kundenübergreifend wiederverwendeten Passwörter gefunden.'));
    return;
  }
  groups.forEach((g, i) => {
    mainEl.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `Passwort ${i + 1}`, h('span', { class: 'muted small' }, `${g.customers} Kunden · ${g.places.length} Stellen`)),
        g.places.map(({ customer, section, entry }) =>
          h(
            'a',
            { class: 'list-item', href: `#/k/${customer.id}` },
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'title' }, customer.name),
              h('div', { class: 'sub' }, [section.title, entry.label].filter(Boolean).join(' · ') || '–'),
            ),
            h('span', { class: 'chev' }, icon('chev')),
          ),
        ),
      ),
    );
  });
}

// ---------- Einstellungen ----------

function renderSettings() {
  const s = state.session;
  const wrap = h('div', { class: 'settings' });
  wrap.append(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: '#/', 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, 'Einstellungen'),
    ),
  );

  // Konto
  const pw1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const pwErr = h('div', { class: 'error' });
  wrap.append(
    h(
      'section',
      {},
      h('h2', {}, 'Dein Zugang'),
      h('p', { class: 'muted small' }, `Angemeldet als ${s.user} (${s.isAdmin ? 'Admin' : 'Mitarbeiter'}).`),
      h(
        'form',
        {
          onsubmit: async (ev) => {
            ev.preventDefault();
            pwErr.textContent = '';
            if (pw1.value.length < MIN_PASSWORD) return (pwErr.textContent = `Mindestens ${MIN_PASSWORD} Zeichen.`);
            if (pw1.value !== pw2.value) return (pwErr.textContent = 'Die Passwörter stimmen nicht überein.');
            try {
              await s.changePassword(pw1.value);
              pw1.value = pw2.value = '';
              toast('Master-Passwort geändert');
            } catch (e) {
              pwErr.textContent = errorText(e);
            }
          },
        },
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, 'Neues Master-Passwort'), pw1), h('label', { class: 'field' }, h('span', {}, 'Wiederholen'), pw2)),
        pwErr,
        h('button', { class: 'btn', type: 'submit' }, 'Passwort ändern'),
      ),
    ),
  );

  // Benutzer
  if (s.isAdmin) {
    const nName = h('input', { autocapitalize: 'off', autocomplete: 'off', placeholder: 'z. B. mitarbeiter' });
    const nPw = h('input', { type: 'text', autocomplete: 'off', placeholder: `mind. ${MIN_PASSWORD} Zeichen` });
    const nRole = h('select', {}, h('option', { value: 'member' }, 'Mitarbeiter'), h('option', { value: 'admin' }, 'Admin'));
    const uErr = h('div', { class: 'error' });
    wrap.append(
      h(
        'section',
        {},
        h('h2', {}, 'Benutzer'),
        h(
          'div',
          { class: 'card' },
          (s.users || []).map((u) =>
            h(
              'div',
              { class: 'list-item' },
              h('div', { class: 'grow' }, h('div', { class: 'title' }, u.name), h('div', { class: 'sub' }, u.role === 'admin' ? 'Admin' : 'Mitarbeiter')),
              u.name !== s.user &&
                h(
                  'button',
                  {
                    class: 'btn danger',
                    onclick: async () => {
                      if (!confirm(`Zugang von „${u.name}“ entfernen?\n\nAuf dem Gerät dieser Person bleibt eine verschlüsselte Kopie, die sie mit ihrem Passwort weiter öffnen kann. Ändere danach die wichtigsten Kundenpasswörter.`)) return;
                      try {
                        await s.removeUser(u.name);
                        toast('Benutzer entfernt');
                        render();
                      } catch (e) {
                        toast(errorText(e));
                      }
                    },
                  },
                  'Entfernen',
                ),
            ),
          ),
        ),
        h(
          'form',
          {
            onsubmit: async (ev) => {
              ev.preventDefault();
              uErr.textContent = '';
              if (nPw.value.length < MIN_PASSWORD) return (uErr.textContent = `Startpasswort: mindestens ${MIN_PASSWORD} Zeichen.`);
              try {
                await s.addUser(nName.value.trim().toLowerCase(), nPw.value, nRole.value);
                toast('Benutzer angelegt – Startpasswort persönlich übergeben');
                nName.value = nPw.value = '';
                render();
              } catch (e) {
                uErr.textContent = errorText(e);
              }
            },
          },
          h(
            'div',
            { class: 'grid2' },
            h('label', { class: 'field' }, h('span', {}, 'Benutzername'), nName),
            h('label', { class: 'field' }, h('span', {}, 'Startpasswort'), nPw),
            h('label', { class: 'field' }, h('span', {}, 'Rolle'), nRole),
          ),
          uErr,
          h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Benutzer anlegen'),
          h('p', { class: 'muted small' }, 'Die Person ändert das Startpasswort nach der ersten Anmeldung unter „Dein Zugang“.'),
        ),
      ),
    );
  }

  // Daten
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      try {
        const obj = JSON.parse(await file.text());
        const n = Array.isArray(obj.customers) ? obj.customers.length : null;
        const msg =
          obj.format === 'itsupport-backup'
            ? 'Sicherung einspielen? Kunden werden zusammengeführt, neuere Stände gewinnen.'
            : `${n} Kunden importieren? Bestehende Kunden mit gleichem Namen werden ersetzt.`;
        if (!confirm(msg)) return;
        const r = await s.importFile(obj, (i, n) => toast(`Bild ${i}/${n} wird verschlüsselt …`));
        toast(`Import fertig: ${r.added} neu, ${r.replaced} ersetzt${r.images ? `, ${r.images} Bilder` : ''}. Wird hochgeladen …`);
        go('#/');
      } catch (e) {
        toast(e.message || 'Import fehlgeschlagen');
      }
    },
  });
  wrap.append(
    h(
      'section',
      {},
      h('h2', {}, 'Daten'),
      h('p', { class: 'muted small' }, `${liveCustomers(s.data).length} Kunden · Revision ${s.rev} · letzter Abgleich ${fmtTime(s.lastSync)}`),
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import / Sicherung einspielen'),
        h('button', { class: 'btn', onclick: () => downloadBackup() }, 'Verschlüsselte Sicherung laden'),
        h('button', { class: 'btn', onclick: () => s.sync().then(() => toast('Abgeglichen')) }, 'Jetzt abgleichen'),
        fileInput,
      ),
      h(
        'p',
        { class: 'muted small' },
        'Die Sicherung enthält alle Kunden, Bilder und Versionen. Sie ist mit dem Tresorschlüssel verschlüsselt und nur zusammen mit einem Master-Passwort dieses Tresors lesbar.',
      ),
    ),
  );

  // Werkzeuge
  wrap.append(
    h(
      'section',
      {},
      h('h2', {}, 'Werkzeuge'),
      (() => {
        const todo = liveCustomers(s.data).filter(needsMigration);
        if (!todo.length) return h('p', { class: 'muted small' }, 'Alle Kunden sind auf die einheitlichen Vorlagen umgestellt.');
        return h(
          'div',
          { class: 'version-banner' },
          h('div', {}, h('b', {}, `${todo.length} Kunden auf einheitliche Vorlagen umstellen`)),
          h(
            'div',
            { class: 'small' },
            'Firma, Personen, Geräte, Internet & WLAN, Microsoft 365, Domain & E-Mail, Backup. Was sich nicht sicher zuordnen lässt, landet unverändert unter „Noch einzusortieren“. Der bisherige Stand jedes Kunden bleibt im Verlauf.',
          ),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: async () => {
                if (!confirm(`${todo.length} Kunden jetzt umstellen?`)) return;
                await s.commitCustomers(todo.map(migrateCustomer));
                toast('Umgestellt – offene Punkte siehst du auf der Startseite unter „Offen“');
                state.tab = 'offen';
                setPref('tab', 'offen');
                go('#/');
              },
            },
            'Jetzt umstellen',
          ),
        );
      })(),
      h(
        'a',
        { class: 'list-item', href: '#/werkzeug/anydesk', style: 'padding-left:0;padding-right:0' },
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'title' }, 'AnyDesk-Passwort bei allen Geräten eintragen'),
          h('div', { class: 'sub' }, `${remoteEntries(s.data).filter((x) => x.entry.kind === 'anydesk').length} AnyDesk-Geräte`),
        ),
        h('span', { class: 'chev' }, icon('chev')),
      ),
    ),
  );

  // Papierkorb
  const trash = s.data.customers
    .filter((c) => c.deleted && (c.versions || []).length)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  wrap.append(
    h(
      'section',
      {},
      h('h2', {}, `Papierkorb (${trash.length})`),
      trash.length
        ? h(
            'div',
            { class: 'card' },
            trash.map((c) =>
              h(
                'div',
                { class: 'list-item' },
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { class: 'title' }, c.name),
                  h('div', { class: 'sub' }, `gelöscht am ${fmtTime(c.updatedAt)}${c.updatedBy ? ` von ${c.updatedBy}` : ''}`),
                ),
                h(
                  'button',
                  {
                    class: 'btn',
                    onclick: async () => {
                      try {
                        await s.restoreVersion(c.id, c.versions[0].id);
                        toast(`„${c.name}“ wiederhergestellt`);
                        go(`#/k/${c.id}`);
                      } catch {
                        toast('Wiederherstellen fehlgeschlagen – bitte mit Internet erneut versuchen.');
                      }
                    },
                  },
                  icon('restore'),
                  'Wiederherstellen',
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'Gelöschte Kunden landen hier und lassen sich wiederherstellen.'),
    ),
  );

  // Sicherheit
  const reuse = reusedSecrets(s.data).length;
  const lockSel = h(
    'select',
    {
      onchange: (e) => {
        setPref('lockMinutes', e.target.value);
        toast('Gespeichert');
      },
    },
    ['1', '3', '5', '15', '30'].map((m) => h('option', { value: m, selected: m === pref('lockMinutes', '5') ? 'selected' : null }, `${m} Min.`)),
  );
  wrap.append(
    h(
      'section',
      {},
      h('h2', {}, 'Sicherheit'),
      h('label', { class: 'field' }, h('span', {}, 'Automatisch sperren nach Inaktivität'), lockSel),
      h(
        'a',
        { class: 'list-item', href: '#/sicherheit', style: 'padding-left:0;padding-right:0' },
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'title' }, 'Mehrfach verwendete Passwörter'),
          h('div', { class: 'sub' }, reuse ? `${reuse} Passwörter kommen bei mehreren Kunden vor` : 'Keine gefunden'),
        ),
        h('span', { class: 'chev' }, icon('chev')),
      ),
      h(
        'button',
        {
          class: 'btn danger',
          style: 'margin-top:10px',
          onclick: async () => {
            if (!confirm('Die verschlüsselte Kopie auf diesem Gerät löschen und sperren? Danach ist zum Entsperren eine Verbindung nötig.')) return;
            if (s.pending && !confirm('Es gibt noch nicht hochgeladene Änderungen. Trotzdem löschen?')) return;
            await forgetDevice();
            lock();
          },
        },
        'Dieses Gerät vergessen',
      ),
    ),
  );
  mainEl.append(wrap);
}

async function downloadBackup() {
  const { backup, missing } = await state.session.backup((i, n) => toast(`Sicherung: Block ${i}/${n} …`));
  if (missing) toast(`${missing} Bilder/Versionen waren offline nicht verfügbar und fehlen in der Sicherung.`);
  else toast('Sicherung erstellt');
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `itsupport-sicherung-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function errorText(e) {
  if (e instanceof UnlockError) return e.message;
  if (e instanceof ApiError) {
    const map = {
      offline: 'Keine Verbindung zum Server.',
      unauthorized: 'Benutzername oder Passwort falsch.',
      too_many_attempts: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.',
      user_exists: 'Diesen Benutzer gibt es schon.',
      invalid_name: 'Benutzername: eine E-Mail-Adresse oder 2–64 Zeichen aus a–z, 0–9, Punkt, Minus, Unterstrich.',
      bad_setup_token: 'Der Einrichtungs-Code stimmt nicht.',
      setup_disabled: 'Einrichtung ist am Server nicht freigeschaltet (KZ_SETUP_TOKEN fehlt).',
      already_initialized: 'Der Tresor ist bereits eingerichtet.',
      conflict: 'Gleichzeitige Änderung – bitte nochmal versuchen.',
      forbidden: 'Nur für Admins.',
      storage_missing: 'Die Datenbank ist nicht verbunden. In Vercel unter „Storage“ Upstash mit dem Projekt verbinden und neu deployen.',
      server: 'Serverfehler. Details stehen in Vercel unter „Logs“.',
      method_not_allowed: 'Der Server-Teil ist nicht erreichbar (falsche Vercel-Einstellung).',
      http_404: 'Der Server-Teil ist nicht erreichbar (falsche Vercel-Einstellung).',
    };
    return map[e.code] || `Fehler: ${e.code}`;
  }
  console.error(e);
  return 'Unerwarteter Fehler.';
}

// ---------- Anmeldung und Einrichtung ----------

function gate(title, lead, form) {
  app.replaceChildren(
    h('div', { class: 'gate' }, h('img', { class: 'logo', src: '/icons/icon.svg', alt: '' }), h('h1', {}, title), h('p', { class: 'lead' }, lead), form),
  );
}

function renderLogin(message = '') {
  const cache = loadCache();
  const user = h('input', {
    name: 'username',
    autocomplete: 'username',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: cache?.user || pref('lastUser', ''),
    required: true,
  });
  const pw = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'error' }, message);
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entsperren');
  gate(
    'itSupport',
    'Kunden, Zugänge und Fernwartung',
    h(
      'form',
      {
        onsubmit: async (ev) => {
          ev.preventDefault();
          err.textContent = '';
          btn.disabled = true;
          btn.textContent = 'Entschlüssle …';
          try {
            startSession(await unlock(user.value, pw.value));
            setPref('lastUser', user.value.trim().toLowerCase());
          } catch (e) {
            if (e?.name === 'OperationError') err.textContent = 'Benutzername oder Passwort falsch.';
            else err.textContent = errorText(e);
            btn.disabled = false;
            btn.textContent = 'Entsperren';
            pw.select();
          }
        },
      },
      h('label', { class: 'field' }, h('span', {}, 'Benutzer / E-Mail'), user),
      h('label', { class: 'field' }, h('span', {}, 'Master-Passwort'), pw),
      err,
      btn,
    ),
  );
  (user.value ? pw : user).focus();
}

function renderSetup() {
  const token = h('input', { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true });
  const user = h('input', { inputmode: 'email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', placeholder: 'office@firma.at', required: true });
  const pw1 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Tresor anlegen');
  gate(
    'Einrichtung',
    'Einmalig: Tresor anlegen und Admin-Zugang festlegen.',
    h(
      'form',
      {
        onsubmit: async (ev) => {
          ev.preventDefault();
          err.textContent = '';
          if (pw1.value.length < MIN_PASSWORD) return (err.textContent = `Master-Passwort: mindestens ${MIN_PASSWORD} Zeichen.`);
          if (pw1.value !== pw2.value) return (err.textContent = 'Die Passwörter stimmen nicht überein.');
          btn.disabled = true;
          try {
            const s = await setupVault({ token: token.value.trim(), user: user.value.trim().toLowerCase(), password: pw1.value });
            setPref('lastUser', s.user);
            startSession(s);
            toast('Tresor angelegt');
          } catch (e) {
            err.textContent = errorText(e);
            btn.disabled = false;
          }
        },
      },
      h('label', { class: 'field' }, h('span', {}, 'Einrichtungs-Code (KZ_SETUP_TOKEN aus Vercel)'), token),
      h('label', { class: 'field' }, h('span', {}, 'Dein Benutzername oder deine E-Mail-Adresse'), user),
      h('label', { class: 'field' }, h('span', {}, `Master-Passwort (mind. ${MIN_PASSWORD} Zeichen)`), pw1),
      h('label', { class: 'field' }, h('span', {}, 'Wiederholen'), pw2),
      h(
        'p',
        { class: 'muted small' },
        'Das Master-Passwort kann niemand zurücksetzen – auch nicht der Server. Schreib es dir sicher auf.',
      ),
      err,
      btn,
    ),
  );
  token.focus();
}

// ---------- Sitzung, Sperre ----------

let lastActive = Date.now();
let hiddenAt = null;

function startSession(session) {
  state.session = session;
  state.lockMessage = '';
  session.on((what) => {
    if (what === 'status') updatePill();
    if (what === 'data' || what === 'users') {
      // Nicht mitten im Bearbeiten neu zeichnen.
      if (route().sub !== 'bearbeiten' && route().name !== 'neu') render();
    }
    if (what === 'auth') lock('Dein Zugang wurde geändert oder entfernt. Bitte neu anmelden.');
  });
  lastActive = Date.now();
  mainEl = null;
  render();
  // Bilder im Hintergrund aufs Geraet holen, damit sie offline verfuegbar sind.
  setTimeout(() => state.session === session && session.prefetch(), 4000);
}

function lock(message = '') {
  closeViewer();
  for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  imageUrls.clear();
  state.session?.lock();
  state.session = null;
  state.query = '';
  state.draft = null;
  state.revealed.clear();
  mainEl = null;
  if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
  renderLogin(message);
}

for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
  addEventListener(ev, () => (lastActive = Date.now()), { passive: true, capture: true });
}

setInterval(() => {
  if (!state.session) return;
  const limit = Number(pref('lockMinutes', '5')) * 60000;
  if (Date.now() - lastActive > limit) lock('Automatisch gesperrt.');
}, 10000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (state.session && hiddenAt && Date.now() - hiddenAt > 60000) lock('Automatisch gesperrt.');
  else if (state.session) state.session.sync();
  hiddenAt = null;
});

addEventListener('online', () => state.session?.sync().then(() => state.session?.prefetch()));
setInterval(() => {
  if (state.session && document.visibilityState === 'visible') state.session.sync();
}, 60000);

addEventListener('hashchange', () => {
  if (!state.session) return;
  const r = route();
  if (r.sub !== 'bearbeiten' && r.name !== 'neu') state.draft = null;
  render();
  scrollTo(0, 0);
});

// ---------- Start ----------

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (loadCache()) return renderLogin();
  try {
    const st = await api.status();
    if (st.initialized) renderLogin();
    else renderSetup();
  } catch (e) {
    renderLogin(errorText(e));
  }
}

boot();
