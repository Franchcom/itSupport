// Oberflaeche. Baut alles mit DOM-Methoden und textContent, nie mit innerHTML,
// damit kein gespeicherter Wert als HTML ausgefuehrt werden kann.

import { api, ApiError } from './api.js';
import {
  CATEGORIES,
  KINDS,
  formatId,
  guessKind,
  liveCustomers,
  newCustomer,
  newEntry,
  newSection,
  remoteEntries,
  reusedSecrets,
  search,
} from './model.js';
import { UnlockError, forgetDevice, loadCache, setupVault, unlock } from './vault.js';

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
  return { name: parts[0] || '', id: parts[1], sub: parts[2] };
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
  searchWrap.classList.toggle('hidden', editing || r.name === 'einstellungen' || r.name === 'sicherheit');
  mainEl.replaceChildren();
  if (state.query.trim() && !editing) return renderResults();
  if (r.name === 'k' && r.sub === 'bearbeiten') return renderEdit(r.id);
  if (r.name === 'neu') return renderEdit(null);
  if (r.name === 'k') return renderCustomer(r.id);
  if (r.name === 'einstellungen') return renderSettings();
  if (r.name === 'sicherheit') return renderSecurity();
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
}

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

function entryRow(c, s, e, { context = false } = {}) {
  const isRemote = e.kind === 'anydesk' || e.kind === 'teamviewer';
  const revealed = state.revealed.has(e.id);
  let valueEl;
  if (e.secret && !revealed) {
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
      label && h('div', { class: 'entry-label' }, label),
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
        const sub = [`${countEntries(c)} Einträge`, remote ? `${remote} AnyDesk` : ''].filter(Boolean).join(' · ');
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

function renderCustomer(id) {
  const c = findCustomer(id);
  if (!c) {
    mainEl.append(h('p', { class: 'empty' }, 'Kunde nicht gefunden. ', h('a', { href: '#/' }, 'Zur Übersicht')));
    return;
  }
  mainEl.append(
    h(
      'div',
      { class: 'row-head' },
      h('a', { class: 'btn ghost icon', href: '#/', 'aria-label': 'Zurück' }, icon('back')),
      h('h1', {}, c.name),
      h('a', { class: 'btn', href: `#/k/${c.id}/bearbeiten` }, icon('edit'), 'Bearbeiten'),
    ),
  );
  if (c.note) mainEl.append(h('div', { class: 'note' }, c.note));

  const cats = CATEGORIES.filter((cat) => c.sections.some((s) => s.category === cat));
  const others = c.sections.filter((s) => !CATEGORIES.includes(s.category));
  if (cats.length > 2) {
    mainEl.append(
      h(
        'nav',
        { class: 'chips' },
        cats.map((cat) =>
          h(
            'a',
            {
              href: '#',
              onclick: (ev) => {
                ev.preventDefault();
                document.getElementById(`cat-${CATEGORIES.indexOf(cat)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              },
            },
            cat,
          ),
        ),
      ),
    );
  }
  for (const cat of cats) {
    mainEl.append(h('h2', { class: 'cat', id: `cat-${CATEGORIES.indexOf(cat)}`, style: 'scroll-margin-top:140px' }, cat));
    for (const s of c.sections.filter((x) => x.category === cat)) mainEl.append(sectionCard(c, s));
  }
  for (const s of others) mainEl.append(sectionCard(c, s));
  if (!c.sections.length) mainEl.append(h('p', { class: 'empty' }, 'Noch keine Einträge. Tippe auf „Bearbeiten“.'));
  mainEl.append(
    h('p', { class: 'muted small', style: 'margin-top:18px' }, `Zuletzt geändert ${fmtTime(c.updatedAt)}${c.updatedBy ? ` von ${c.updatedBy}` : ''}`),
  );
}

function sectionCard(c, s) {
  return h(
    'div',
    { class: 'card' },
    s.title && h('h3', {}, s.title),
    s.entries.length ? s.entries.map((e) => entryRow(c, s, e)) : h('div', { class: 'entry muted small' }, 'Leer'),
  );
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

  d.sections.forEach((s, si) => {
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

  mainEl.append(
    h(
      'div',
      { class: 'bar' },
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            d.sections.push(newSection('', 'Netzwerk'));
            rerender();
          },
        },
        icon('plus'),
        'Bereich',
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            const s = newSection('Neues Gerät', 'Fernwartung');
            s.entries.push(newEntry({ label: 'AnyDesk', kind: 'anydesk' }), newEntry({ label: 'Windows-Passwort', secret: true }));
            d.sections.push(s);
            rerender();
          },
        },
        icon('plus'),
        'AnyDesk-Gerät',
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
  clean.sections = clean.sections
    .map((s) => ({ ...s, title: s.title.trim(), entries: s.entries.filter((e) => e.label.trim() || e.value.trim()) }))
    .filter((s) => s.title || s.entries.length);
  clean.updatedAt = new Date().toISOString();
  clean.updatedBy = state.session.user;
  const data = structuredClone(state.session.data);
  const idx = data.customers.findIndex((c) => c.id === clean.id);
  if (idx >= 0) data.customers[idx] = clean;
  else data.customers.push(clean);
  state.draft = null;
  await state.session.save(data);
  toast('Gespeichert');
  go(`#/k/${clean.id}`);
}

async function deleteCustomer() {
  const d = state.draft;
  if (!confirm(`„${d.name}“ mit allen Einträgen löschen? Das kann nicht rückgängig gemacht werden.`)) return;
  const data = structuredClone(state.session.data);
  const idx = data.customers.findIndex((c) => c.id === d._for);
  // Grabstein statt Entfernen, damit das Loeschen auf alle Geraete uebertragen wird.
  data.customers[idx] = { id: d._for, name: d.name, deleted: true, sections: [], updatedAt: new Date().toISOString(), updatedBy: state.session.user };
  state.draft = null;
  await state.session.save(data);
  toast('Kunde gelöscht');
  go('#/');
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
        const r = await s.importFile(obj);
        toast(`Import fertig: ${r.added} neu, ${r.replaced} ersetzt`);
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
        'Die Sicherung ist mit dem Tresorschlüssel verschlüsselt und nur zusammen mit einem Master-Passwort dieses Tresors lesbar.',
      ),
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
          onclick: () => {
            if (!confirm('Die verschlüsselte Kopie auf diesem Gerät löschen und sperren? Danach ist zum Entsperren eine Verbindung nötig.')) return;
            forgetDevice();
            lock();
          },
        },
        'Dieses Gerät vergessen',
      ),
    ),
  );
  mainEl.append(wrap);
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(state.session.backup())], { type: 'application/json' });
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
      invalid_name: 'Benutzername: 2–32 Zeichen, nur a–z, 0–9, Punkt, Minus, Unterstrich.',
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
      h('label', { class: 'field' }, h('span', {}, 'Benutzer'), user),
      h('label', { class: 'field' }, h('span', {}, 'Master-Passwort'), pw),
      err,
      btn,
    ),
  );
  (user.value ? pw : user).focus();
}

function renderSetup() {
  const token = h('input', { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true });
  const user = h('input', { autocomplete: 'username', autocapitalize: 'off', value: 'admin', required: true });
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
      h('label', { class: 'field' }, h('span', {}, 'Dein Benutzername'), user),
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
}

function lock(message = '') {
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

addEventListener('online', () => state.session?.sync());
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
