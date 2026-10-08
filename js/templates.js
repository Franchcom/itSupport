// Feste Vorlagen fuer einheitliche Kundendaten.
//
// Ein Bereich mit "type" ist eine Vorlagen-Karte (Firma, Person, Geraet …).
// Seine Standardfelder tragen "field" (Schluessel der Vorlage) und sind immer
// vorhanden, auch leer – so sieht man, was noch fehlt. Weitere Eintraege ohne
// "field" sind Zusatzfelder. "na: true" heisst: gibt es bei diesem Kunden nicht.

import { newEntry, uid } from './model.js';

const f = (key, label, opts = {}) => ({ key, label, kind: 'text', secret: false, optional: false, ...opts });
const pw = (key, label, opts = {}) => f(key, label, { secret: true, ...opts });

export const TEMPLATES = {
  firma: {
    label: 'Firma',
    category: 'Firma',
    single: true,
    titleField: 'name',
    fields: [
      f('name', 'Firmenname'),
      f('adresse', 'Adresse'),
      f('ansprechpartner', 'Ansprechpartner'),
      f('telefon', 'Telefon (Zentrale)', { kind: 'phone' }),
      f('email', 'E-Mail (allgemein)', { kind: 'email' }),
      f('uid', 'UID', { optional: true }),
    ],
  },
  person: {
    label: 'Person',
    category: 'Personen',
    titleField: 'name',
    fields: [
      f('name', 'Name'),
      f('funktion', 'Funktion', { optional: true }),
      f('email', 'E-Mail', { kind: 'email' }),
      f('telefon', 'Telefon / Durchwahl', { kind: 'phone', optional: true }),
      f('handy', 'Handynummer', { kind: 'phone', optional: true }),
      pw('m365pw', 'M365-Passwort'),
      f('winuser', 'Windows-Benutzer'),
      pw('winpw', 'Windows-Passwort'),
      f('appleid', 'Apple-ID', { kind: 'email' }),
      pw('applepw', 'Apple-ID-Passwort'),
      f('notiz', 'Notiz', { optional: true }),
    ],
  },
  geraet: {
    label: 'Gerät',
    category: 'Geräte',
    titleField: 'name',
    fields: [
      f('name', 'Gerätename'),
      f('typ', 'Typ'),
      f('benutzer', 'Benutzt von', { optional: true }),
      f('ip', 'IP-Adresse', { kind: 'ip' }),
      f('anydesk', 'AnyDesk-ID', { kind: 'anydesk' }),
      pw('anydeskpw', 'AnyDesk-Passwort'),
      f('adminuser', 'Admin-Benutzer'),
      pw('adminpw', 'Admin-Passwort'),
      f('serial', 'Seriennummer', { optional: true }),
      f('garantie', 'Garantie bis', { optional: true }),
    ],
  },
  netz: {
    label: 'Internet & WLAN',
    category: 'Internet & WLAN',
    titleField: null,
    fields: [
      f('anbieter', 'Anbieter'),
      f('wanip', 'Öffentliche IP', { kind: 'ip', optional: true }),
      f('routerip', 'Router-IP', { kind: 'ip' }),
      f('routeruser', 'Router-Benutzer'),
      pw('routerpw', 'Router-Passwort'),
      f('ssid', 'WLAN-Name'),
      pw('wlanpw', 'WLAN-Passwort'),
      f('gast', 'Gast-WLAN', { optional: true }),
      f('dhcp', 'DHCP-Bereich', { optional: true }),
    ],
  },
  m365: {
    label: 'Microsoft 365',
    category: 'Microsoft 365',
    titleField: 'tenant',
    fields: [
      f('tenant', 'Tenant'),
      f('adminuser', 'Admin-Benutzer', { kind: 'email' }),
      pw('adminpw', 'Admin-Passwort'),
      f('lizenzen', 'Lizenzen', { optional: true }),
      f('kosten', 'Kosten/Monat', { optional: true }),
    ],
  },
  domain: {
    label: 'Domain & E-Mail',
    category: 'Domain & E-Mail',
    titleField: 'domain',
    fields: [
      f('domain', 'Domain'),
      f('registrar', 'Registrar'),
      f('reguser', 'Registrar-Benutzer'),
      pw('regpw', 'Registrar-Passwort'),
      f('imap', 'IMAP-Server', { optional: true }),
      f('smtp', 'SMTP-Server', { optional: true }),
    ],
  },
  backup: {
    label: 'Backup',
    category: 'Backup',
    titleField: 'was',
    fields: [f('was', 'Was'), f('wohin', 'Wohin'), f('wann', 'Wann'), f('geprueft', 'Zuletzt geprüft', { optional: true })],
  },
};

export const TEMPLATE_ORDER = ['firma', 'person', 'geraet', 'netz', 'm365', 'domain', 'backup'];

export function fieldDef(section, entry) {
  return TEMPLATES[section.type]?.fields.find((x) => x.key === entry.field) || null;
}

// Neue Vorlagen-Karte mit allen Standardfeldern (optional vorbelegt).
export function newTemplateSection(type, values = {}) {
  const t = TEMPLATES[type];
  const sec = { id: uid(), type, title: '', category: t.category, entries: [] };
  for (const fd of t.fields) {
    sec.entries.push(newEntry({ field: fd.key, label: fd.label, kind: fd.kind, secret: fd.secret, value: values[fd.key] || '' }));
  }
  return syncTitle(sec);
}

// Bringt eine Vorlagen-Karte in Form: fehlende Standardfelder ergaenzen,
// Bezeichnung/Art/Geheim aus der Vorlage, Standardfelder zuerst in Vorlagen-Reihenfolge.
export function normalizeSection(sec) {
  const t = TEMPLATES[sec.type];
  if (!t) return sec;
  const byField = new Map();
  const extras = [];
  for (const e of sec.entries) {
    if (e.field && t.fields.some((x) => x.key === e.field) && !byField.has(e.field)) byField.set(e.field, e);
    else extras.push(e.field ? { ...e, field: undefined } : e);
  }
  const fixed = t.fields.map((fd) => {
    const e = byField.get(fd.key) || newEntry({ field: fd.key, value: '' });
    return { ...e, field: fd.key, label: fd.label, kind: fd.kind, secret: fd.secret };
  });
  sec.entries = [...fixed, ...extras];
  sec.category = t.category;
  return syncTitle(sec);
}

export function syncTitle(sec) {
  const t = TEMPLATES[sec.type];
  if (!t) return sec;
  const v = t.titleField ? sec.entries.find((e) => e.field === t.titleField)?.value?.trim() : '';
  if (v) sec.title = v;
  else if (!sec.title) sec.title = t.label;
  return sec;
}

// Offene Punkte: leere Pflichtfelder, die nicht als "gibt es nicht" markiert sind.
export function missingFields(customer) {
  const out = [];
  for (const sec of customer.sections || []) {
    const t = TEMPLATES[sec.type];
    if (!t) continue;
    for (const e of sec.entries) {
      const fd = e.field && t.fields.find((x) => x.key === e.field);
      if (fd && !fd.optional && !e.na && !String(e.value || '').trim()) out.push({ section: sec, entry: e, field: fd, type: sec.type });
    }
  }
  return out;
}

export function needsMigration(customer) {
  return !customer.deleted && !(customer.sections || []).some((s) => s.type === 'firma');
}

// ---------------------------------------------------------------- Umstellung

const norm = (s) => String(s || '').trim().toLowerCase();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || '').trim());
const SHARED = /^(office|info|shop|bestellung|rechnung|verkauf|expedit|management|register|web|vorstand|heli|noreply|no-reply|buchhaltung|kontakt|service|support|admin|franchcom|ap)$/i;

function nameFromEmail(email) {
  const local = email.split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function deviceType(title) {
  const t = norm(title);
  if (/nas|qnap|synology|mycloud/.test(t)) return 'NAS';
  if (/server|idrac/.test(t)) return 'Server';
  if (/router|lte|4g|telekom|upc|fritz/.test(t)) return 'Router';
  if (/switch|unifi/.test(t)) return 'Switch';
  if (/access ?point|airport|wifi|wlan|zyxel/.test(t)) return 'Access Point';
  if (/usv/.test(t)) return 'USV';
  if (/drucker|laserjet|printer/.test(t)) return 'Drucker';
  if (/notebook|laptop|mbp|macbook/.test(t)) return 'Notebook';
  if (/iphone|handy|smartphone/.test(t)) return 'Smartphone';
  if (/pc|desktop|kasse|workstation/.test(t)) return 'PC';
  return '';
}

function set(sec, key, value) {
  const e = sec.entries.find((x) => x.field === key);
  if (e && !e.value && value) e.value = String(value).trim();
  return !!e && e.value === String(value).trim();
}

function extra(sec, e, label) {
  sec.entries.push({ ...e, id: e.id || uid(), field: undefined, label: label ?? e.label });
}

// Wandelt einen Kunden mit freien Bereichen in Vorlagen-Karten um. Was sich nicht
// sicher zuordnen laesst, bleibt unveraendert unter "Noch einzusortieren".
// Reparatur fuer aeltere Importe: Spaltenkopf und Wert landeten verdeckt in
// einem Eintrag ohne Bezeichnung ("MSOffice365 Konto · name@firma.at").
function repairEntry(e) {
  if (e.label) return e;
  const m = String(e.value || '').match(/^((?:MS)?Office ?365 Konto|Windows Anmeldename) · (.+)$/i);
  if (!m) return e;
  return { ...e, label: m[1], value: m[2], secret: !isEmail(m[2]) && e.secret };
}

export function migrateCustomer(customer) {
  if (!needsMigration(customer)) return customer;
  const c = structuredClone(customer);
  for (const s of c.sections) s.entries = s.entries.map(repairEntry);
  const out = { firma: [], person: [], geraet: [], netz: [], m365: [], domain: [], rest: [] };
  const firma = newTemplateSection('firma', { name: c.name });
  out.firma.push(firma);
  const persons = new Map(); // E-Mail -> Karte
  const m365ByKey = new Map();
  const domains = new Map();

  const personFor = (email, name) => {
    const k = norm(email);
    if (k && persons.has(k)) return persons.get(k);
    const p = newTemplateSection('person', { email, name: name || (email ? nameFromEmail(email) : '') });
    if (k) persons.set(k, p);
    out.person.push(p);
    return p;
  };
  const m365Default = () => {
    if (!m365ByKey.has('')) {
      const card = newTemplateSection('m365');
      m365ByKey.set('', card);
      out.m365.push(card);
    }
    return m365ByKey.get('');
  };
  let netz = null;
  const netzCard = () => {
    if (!netz) {
      netz = newTemplateSection('netz');
      out.netz.push(netz);
    }
    return netz;
  };
  const domainCard = (d) => {
    const k = norm(d);
    if (!k) return null;
    if (!domains.has(k)) {
      const sec = newTemplateSection('domain', { domain: k });
      domains.set(k, sec);
      out.domain.push(sec);
    }
    return domains.get(k);
  };

  for (const s of c.sections) {
    if (s.type) {
      out.rest.push(s);
      continue;
    }

    // 1) Fernwartung: Geraet mit AnyDesk-ID
    if (s.entries.some((e) => e.kind === 'anydesk')) {
      const g = newTemplateSection('geraet', { name: s.title, typ: deviceType(s.title) });
      for (const e of s.entries) {
        const l = norm(e.label);
        if (e.kind === 'anydesk' && set(g, 'anydesk', e.value)) continue;
        if (/^anydesk.?pass/.test(l) && set(g, 'anydeskpw', e.value)) continue;
        if (e.value || e.note) extra(g, e);
      }
      out.geraet.push(g);
      continue;
    }

    // 2) Microsoft 365 je Domain: Postfaecher -> Personen, Admin -> M365-Karte
    const m = s.title.match(/^Microsoft 365 – (\S+)(?: \((.+)\))?$/);
    if (s.category === 'Microsoft 365' && m) {
      const domain = m[1];
      const stand = m[2] ? ` (${m[2]})` : '';
      domainCard(domain);
      const adminE = s.entries.find((e) => norm(e.label) === 'tenant-admin' && /onmicrosoft/i.test(e.value));
      const key = norm(adminE?.value) || norm(domain);
      let card = m365ByKey.get(key);
      if (!card) {
        card = newTemplateSection('m365', { tenant: adminE ? adminE.value.split('@')[1] : domain, adminuser: adminE?.value || '' });
        m365ByKey.set(key, card);
        out.m365.push(card);
      }
      for (const e of s.entries) {
        const l = norm(e.label);
        if (isEmail(e.label)) {
          const local = e.label.split('@')[0];
          if (SHARED.test(local)) {
            extra(card, e, `Postfach ${e.label}${stand}`);
            continue;
          }
          const p = personFor(e.label);
          if (!set(p, 'm365pw', e.value) && e.value) extra(p, e, `M365-Passwort${stand || ' (weiteres)'}`);
          if (e.note) {
            const n = p.entries.find((x) => x.field === 'notiz');
            n.value = [n.value, e.note].filter(Boolean).join(' · ');
          }
          continue;
        }
        if (l === 'tenant-admin') {
          if (!set(card, 'adminuser', e.value)) extra(card, e);
          continue;
        }
        if (l === 'admin-passwort') {
          if (!set(card, 'adminpw', e.value) && e.value) extra(card, e, `Admin-Passwort${stand || ' (weiteres)'}`);
          continue;
        }
        if (l === 'lizenzkosten') {
          const pm = e.value.match(/Pro Monat: ([\d,.]+)/);
          if (pm) set(card, 'kosten', `${pm[1]} €${stand}`);
          extra(card, e, `Lizenzkosten${stand}`);
          continue;
        }
        if (l.startsWith('o365-anmeldung ')) {
          const who = e.label.slice('O365-Anmeldung '.length).trim();
          const p = persons.get(norm(who));
          if (p && set(p, 'm365pw', e.value)) continue;
          extra(card, e);
          continue;
        }
        if (e.value || e.note) extra(card, e, e.label && stand ? `${e.label}${stand}` : e.label);
      }
      continue;
    }

    // 3a) Sammelpostfach als eigene Karte (office@, shop@ …) -> zur M365-Karte
    if (s.category === 'Microsoft 365' && isEmail(s.title) && SHARED.test(s.title.split('@')[0])) {
      const card = m365Default();
      for (const e of s.entries) if (e.value || e.note) extra(card, e, /pw|pass/i.test(e.label) ? `Postfach ${s.title}` : `${e.label} (${s.title})`);
      continue;
    }

    // 3b) Exchange-/Tenant-Admin aus einer Tabelle
    const tenantUser = s.entries.find((e) => /onmicrosoft\.com$/i.test(String(e.value).trim()));
    if (s.category === 'Microsoft 365' && tenantUser && !s.entries.some((e) => isEmail(e.label))) {
      const card = m365ByKey.get(norm(tenantUser.value)) || m365Default();
      set(card, 'tenant', tenantUser.value.trim().split('@')[1]);
      set(card, 'adminuser', tenantUser.value.trim());
      for (const e of s.entries) if (e !== tenantUser && (e.value || e.note)) extra(card, e);
      continue;
    }

    // 3c) Benutzer-Karten aus Tabellen (mit M365-Konto) -> Person
    const mail = s.entries.find((e) => /office ?365 konto|msoffice365/.test(norm(e.label)));
    if (mail || (isEmail(s.title) && s.category === 'Microsoft 365')) {
      const email = mail?.value || s.title;
      if (SHARED.test(String(email).split('@')[0])) {
        // Sammelpostfach (office@ …) mit Passwoertern -> M365-Karte
        const card = m365Default();
        for (const e of s.entries) {
          if (e === mail) extra(card, { ...e, secret: false, kind: 'email' }, `Postfach ${s.title}`);
          else if (e.value || e.note) extra(card, e, `${e.label || 'Passwort'} (${email})`);
        }
        continue;
      }
      const p = personFor(email, isEmail(s.title) ? '' : s.title);
      if (!isEmail(s.title)) p.entries.find((x) => x.field === 'name').value = s.title;
      const neu = s.entries.find((e) => /pw neu/.test(norm(e.label)) && e.value && norm(e.value) !== 'gelöscht');
      for (const e of s.entries) {
        const l = norm(e.label);
        if (e === mail) continue;
        if (e === neu && set(p, 'm365pw', e.value)) continue;
        if (/^o365 pw$/.test(l) && !neu && set(p, 'm365pw', e.value)) continue;
        if (/windows anmeldename/.test(l) && set(p, 'winuser', e.value)) continue;
        if (e.value || e.note) extra(p, e, /^o365 pw$/.test(l) ? 'M365-Passwort (alt)' : e.label);
      }
      continue;
    }

    // 4a) DHCP-Bereich -> Internet & WLAN
    if (/dhcp/i.test(s.title) && s.entries.length === 1 && /\d+\.\d+\.\d+\.\d+\s*-/.test(s.entries[0].value)) {
      if (!set(netzCard(), 'dhcp', s.entries[0].value)) extra(netzCard(), s.entries[0], 'DHCP-Bereich');
      continue;
    }

    // 4) Geraete-Karten (Server, NAS, Router, Arbeitsplaetze) mit IP-Adresse
    const ipE = s.entries.find((e) => /^(ip ?adress|ip-adresse|adresse|ip)$/.test(norm(e.label)) && /\d{1,3}\.\d{1,3}/.test(e.value));
    // Erster Router mit Zugangsdaten -> direkt in die Karte Internet & WLAN
    if (ipE && s.category === 'Server & NAS' && deviceType(s.title) === 'Router' && !netz?.entries.find((x) => x.field === 'routerip')?.value) {
      const n = netzCard();
      set(n, 'routerip', ipE.value);
      for (const e of s.entries) {
        const l = norm(e.label);
        if (e === ipE) continue;
        if (/^(user|benutzer)$/.test(l) && set(n, 'routeruser', e.value)) continue;
        if (/^(pw|pass|passwort)$/.test(l) && set(n, 'routerpw', e.value)) continue;
        if (e.value || e.note) extra(n, e, `${e.label || 'Router'} (${s.title})`);
      }
      n.entries.find((x) => x.field === 'anbieter').value ||= '';
      extra(n, newEntry({ label: 'Router-Modell', value: s.title }));
      continue;
    }
    if (ipE && ['Server & NAS', 'Benutzer & Geräte', 'Netzwerk'].includes(s.category)) {
      const workstation = s.category === 'Benutzer & Geräte';
      const g = newTemplateSection('geraet', {
        name: workstation ? `PC ${s.title}` : s.title,
        typ: deviceType(s.title) || (workstation ? 'PC' : ''),
        benutzer: workstation ? s.title : '',
      });
      for (const e of s.entries) {
        const l = norm(e.label);
        if (e === ipE && set(g, 'ip', e.value)) continue;
        if (!workstation && /^(user|benutzer)$/.test(l) && set(g, 'adminuser', e.value)) continue;
        if (!workstation && /^(pw|pass|passwort)$/.test(l) && set(g, 'adminpw', e.value)) continue;
        if (/teamviewer/.test(l) && !/pw|pass/.test(l)) {
          extra(g, { ...e, kind: 'teamviewer' }, 'TeamViewer-ID');
          continue;
        }
        if (workstation && /^(user|benutzer)$/.test(l)) {
          extra(g, e, 'Anmelde-Benutzer');
          continue;
        }
        if (workstation && /^(pw|pass|passwort)$/.test(l)) {
          extra(g, { ...e, secret: true }, 'Anmelde-Passwort');
          continue;
        }
        if (e.value || e.note) extra(g, e);
      }
      out.geraet.push(g);
      continue;
    }

    // 5) Alles andere bleibt, wie es ist; unklare Technik-Bereiche zum Einsortieren
    if (['Fernwartung', 'Netzwerk', 'Server & NAS', 'Benutzer & Geräte', 'E-Mail', 'Microsoft 365'].includes(s.category)) {
      s.category = 'Noch einzusortieren';
    }
    out.rest.push(s);
  }

  // Wer eigene Geraete hat, hat auch Internet/WLAN vor Ort.
  if (out.geraet.length) netzCard();

  // "Benutzt von": Geraet "Haas Michel" gehoert zur Person "Michel Haas".
  const words = (x) => norm(x).split(/[^a-z0-9äöüß]+/).filter((w) => w.length > 1);
  for (const g of out.geraet) {
    const ben = g.entries.find((e) => e.field === 'benutzer');
    if (ben.value) continue;
    const gw = new Set(words(g.entries.find((e) => e.field === 'name').value));
    const hit = out.person.filter((p) => {
      const pw = words(p.entries.find((e) => e.field === 'name').value);
      return pw.length >= 2 && pw.every((w) => gw.has(w));
    });
    if (hit.length === 1) ben.value = hit[0].entries.find((e) => e.field === 'name').value;
  }

  c.sections = [...out.firma, ...out.person, ...out.geraet, ...out.netz, ...out.m365, ...out.domain, ...out.rest].map((s) =>
    s.type ? normalizeSection(s) : s,
  );
  return c;
}
