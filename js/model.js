// Datenmodell der Kundendaten (liegt nur entschluesselt im Speicher vor).
//
// { schema: 1, customers: [Customer] }
// Customer = { id, name, note, updatedAt, updatedBy, deleted?, sections: [Section],
//              attachments: [Attachment], versions: [Version] }
// Attachment = { id, title, group, mime, w, h, size, createdAt, createdBy }  (Bild liegt als Block)
// Version    = { id, at, by, savedAt, savedBy, summary: [text] }         (alter Stand liegt als Block)
// Section  = { id, title, category, entries: [Entry] }
// Entry    = { id, label, value, secret, kind, note }

export const CATEGORIES = [
  'Fernwartung',
  'Netzwerk',
  'Server & NAS',
  'Benutzer & Geräte',
  'Microsoft 365',
  'E-Mail',
  'Portale & Web',
  'Backup',
  'Notizen',
];

export const KINDS = {
  text: 'Text',
  anydesk: 'AnyDesk-ID',
  teamviewer: 'TeamViewer-ID',
  url: 'Link',
  ip: 'IP-Adresse',
  email: 'E-Mail',
  phone: 'Telefon',
};

export function uid() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function emptyData() {
  return { schema: 1, customers: [] };
}

export const MAX_VERSIONS = 50;

export function newCustomer(name, by) {
  return { id: uid(), name, note: '', sections: [], attachments: [], versions: [], updatedAt: new Date().toISOString(), updatedBy: by };
}

// Stand eines Kunden ohne Verlauf, so wie er als Version gespeichert wird.
export function snapshotOf(c) {
  const { versions, ...rest } = c;
  return structuredClone(rest);
}

function unionVersions(a = [], b = []) {
  const byId = new Map();
  for (const v of [...a, ...b]) byId.set(v.id, v);
  return [...byId.values()].sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || '')).slice(0, MAX_VERSIONS);
}

// Was hat sich zwischen zwei Staenden eines Kunden geaendert? Kurze Texte fuer den Verlauf.
export function diffCustomers(before, after) {
  const out = [];
  if (!before || before.deleted) return after && !after.deleted ? ['angelegt bzw. wiederhergestellt'] : [];
  if (!after || after.deleted) return ['Kunde gelöscht'];
  if (before.name !== after.name) out.push(`Name: „${before.name}“ → „${after.name}“`);
  if ((before.note || '') !== (after.note || '')) out.push('Notiz geändert');
  const flat = (c) => {
    const m = new Map();
    for (const s of c.sections || []) for (const e of s.entries) m.set(e.id, { s, e });
    return m;
  };
  const a = flat(before);
  const b = flat(after);
  const name = ({ s, e }) => [s.title, e.label].filter(Boolean).join(' – ') || KINDS[e.kind] || 'Eintrag';
  for (const [id, x] of a) {
    const y = b.get(id);
    if (!y) out.push(`entfernt: ${name(x)}`);
    else if (x.e.value !== y.e.value) out.push(`geändert: ${name(y)}`);
    else if (x.e.label !== y.e.label || x.e.note !== y.e.note || x.e.secret !== y.e.secret || x.e.kind !== y.e.kind) {
      out.push(`bearbeitet: ${name(y)}`);
    }
  }
  for (const [id, y] of b) if (!a.has(id)) out.push(`neu: ${name(y)}`);
  const sa = new Map((before.sections || []).map((s) => [s.id, s]));
  for (const s of after.sections || []) {
    const old = sa.get(s.id);
    if (old && (old.title !== s.title || old.category !== s.category)) out.push(`Bereich umbenannt: ${s.title || 'ohne Titel'}`);
  }
  const ia = new Set((before.attachments || []).map((x) => x.id));
  const ib = new Set((after.attachments || []).map((x) => x.id));
  const addedImgs = [...ib].filter((x) => !ia.has(x)).length;
  const removedImgs = [...ia].filter((x) => !ib.has(x)).length;
  if (addedImgs) out.push(`${addedImgs} Bild(er) hinzugefügt`);
  if (removedImgs) out.push(`${removedImgs} Bild(er) entfernt`);
  return out;
}

// IDs der Eintraege, deren Wert sich gegenueber "current" unterscheidet (fuer die Markierung in alten Versionen).
export function changedEntryIds(old, current) {
  const cur = new Map();
  for (const s of current?.sections || []) for (const e of s.entries) cur.set(e.id, e);
  const ids = new Set();
  for (const s of old.sections || []) {
    for (const e of s.entries) {
      const c = cur.get(e.id);
      if (!c || c.value !== e.value || c.label !== e.label) ids.add(e.id);
    }
  }
  return ids;
}

export function newSection(title = '', category = 'Notizen') {
  return { id: uid(), title, category, entries: [] };
}

export function newEntry(fields = {}) {
  return { id: uid(), label: '', value: '', secret: false, kind: 'text', note: '', ...fields };
}

export function liveCustomers(data) {
  return data.customers
    .filter((c) => !c.deleted)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

// Zusammenfuehren zweier Staende, z. B. wenn du und dein Mitarbeiter
// gleichzeitig offline gearbeitet habt. Je Kunde gewinnt der neuere Stand.
export function merge(local, remote) {
  const byId = new Map();
  for (const c of remote.customers) byId.set(c.id, c);
  for (const c of local.customers) {
    const r = byId.get(c.id);
    if (!r) byId.set(c.id, c);
    else {
      const winner = (c.updatedAt || '') > (r.updatedAt || '') ? c : r;
      // Verlauf beider Seiten behalten, damit keine Version verloren geht.
      byId.set(c.id, { ...winner, versions: unionVersions(c.versions, r.versions) });
    }
  }
  return { schema: 1, customers: [...byId.values()] };
}

// Kleinschreibung ohne Akzente, damit "mößner" auch "Moessner" und "Mößner" findet.
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

const fold = (s) => norm(s).replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u');

// Suche ueber alle Kunden. Jedes Wort muss irgendwo im Kontext des Eintrags
// vorkommen (Kunde, Bereich, Bezeichnung, Wert, Notiz).
export function search(data, query, limit = 60) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const c of liveCustomers(data)) {
    const cName = fold(c.name);
    // Nur der Kundenname gesucht: den Kunden selbst zeigen plus seine
    // Fernwartungs-IDs, statt jeden einzelnen Eintrag aufzulisten.
    if (words.every((w) => cName.includes(w))) {
      hits.push({ customer: c, section: null, entry: null, score: 100 });
      for (const s of c.sections) {
        for (const e of s.entries) {
          if ((e.kind === 'anydesk' || e.kind === 'teamviewer') && e.value) {
            hits.push({ customer: c, section: s, entry: e, score: 50 });
          }
        }
      }
      continue;
    }
    for (const s of c.sections) {
      const sTitle = fold(s.title);
      for (const e of s.entries) {
        const label = fold(e.label);
        const value = fold(e.value);
        const hay = `${cName} ${sTitle} ${fold(s.category)} ${label} ${value} ${fold(e.note)}`;
        if (!words.every((w) => hay.includes(w))) continue;
        let score = 0;
        for (const w of words) {
          if (cName.includes(w)) score += 3;
          if (sTitle.includes(w)) score += 2;
          if (label.includes(w)) score += 2;
          if (!e.secret && value.includes(w)) score += 1;
        }
        if (e.kind === 'anydesk' || e.kind === 'teamviewer') score += 1;
        hits.push({ customer: c, section: s, entry: e, score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name, 'de'));
  return hits.slice(0, limit);
}

// Alle Fernwartungs-IDs ueber alle Kunden, fuer die Notfall-Liste.
export function remoteEntries(data) {
  const out = [];
  for (const c of liveCustomers(data)) {
    for (const s of c.sections) {
      for (const e of s.entries) {
        if ((e.kind === 'anydesk' || e.kind === 'teamviewer') && e.value) out.push({ customer: c, section: s, entry: e });
      }
    }
  }
  return out;
}

// Passwoerter, die mehrfach vorkommen. Gibt nur Fundstellen zurueck, nie den Wert.
export function reusedSecrets(data) {
  const map = new Map();
  for (const c of liveCustomers(data)) {
    for (const s of c.sections) {
      for (const e of s.entries) {
        if (!e.secret) continue;
        for (const tok of secretTokens(e.value)) {
          if (!map.has(tok)) map.set(tok, []);
          map.get(tok).push({ customer: c, section: s, entry: e });
        }
      }
    }
  }
  const groups = [];
  for (const places of map.values()) {
    const customers = new Set(places.map((p) => p.customer.id));
    if (customers.size >= 2) groups.push({ places, customers: customers.size });
  }
  return groups.sort((a, b) => b.customers - a.customers || b.places.length - a.places.length);
}

// Zerlegt einen geheimen Wert in die Teile, die wie Passwoerter aussehen
// (z. B. "admin / Geheim123?" -> ["Geheim123?"]).
export function secretTokens(value) {
  return String(value ?? '')
    .split(/[\s/|,;]+|\s[:=]\s?/)
    .map((t) => t.replace(/^(pw|passwort|kennwort|pass)[:=]/i, '').trim())
    .filter((t) => t.length >= 6 && /\d/.test(t) && /[a-z]/i.test(t) && !/[@.]\w+\.\w{2,}$/.test(t));
}

export function formatId(id) {
  const d = String(id).replace(/\s+/g, '');
  return /^\d{7,12}$/.test(d) ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(id);
}

export function guessKind(label, value) {
  const v = String(value ?? '').trim();
  const l = norm(label);
  if (/^\d[\d\s]{6,13}$/.test(v)) {
    if (l.includes('anydesk')) return 'anydesk';
    if (l.includes('teamviewer')) return 'teamviewer';
  }
  if (/^https?:\/\/\S+$/i.test(v)) return 'url';
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(v)) return 'ip';
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return 'email';
  if (/^\+?[\d\s/()-]{8,}$/.test(v) && (l.includes('tel') || l.includes('handy') || l.includes('nummer'))) return 'phone';
  return 'text';
}

// Uebernimmt eine Import-Datei (tools/import_bestand.py) in den Datenbestand.
// Kunden gleichen Namens werden ersetzt, neue angehaengt.
export function applyImport(data, imported, by) {
  if (!imported || !Array.isArray(imported.customers)) throw new Error('Keine gültige Import-Datei.');
  const now = new Date().toISOString();
  const result = { schema: 1, customers: data.customers.slice() };
  let added = 0;
  let replaced = 0;
  for (const ic of imported.customers) {
    const name = String(ic.name || '').trim();
    if (!name) continue;
    const customer = {
      id: uid(),
      name,
      note: String(ic.note || ''),
      attachments: Array.isArray(ic.attachments) ? ic.attachments.filter((a) => a && a.id) : [],
      versions: [],
      updatedAt: now,
      updatedBy: by,
      sections: (ic.sections || []).map((s) => ({
        id: uid(),
        title: String(s.title || ''),
        category: CATEGORIES.includes(s.category) ? s.category : 'Notizen',
        entries: (s.entries || []).map((e) =>
          newEntry({
            label: String(e.label ?? ''),
            value: String(e.value ?? ''),
            secret: !!e.secret,
            kind: KINDS[e.kind] ? e.kind : guessKind(e.label, e.value),
            note: String(e.note ?? ''),
          }),
        ),
      })),
    };
    const idx = result.customers.findIndex((c) => !c.deleted && norm(c.name) === norm(name));
    if (idx >= 0) {
      // Alte ID und Verlauf behalten, damit das Zusammenfuehren mit anderen Geraeten stimmt.
      customer.id = result.customers[idx].id;
      customer.versions = result.customers[idx].versions || [];
      result.customers[idx] = customer;
      replaced++;
    } else {
      result.customers.push(customer);
      added++;
    }
  }
  return { data: result, added, replaced };
}
