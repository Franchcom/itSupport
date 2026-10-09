import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyImport, emptyData } from '../js/model.js';
import { migrateCustomer, missingFields, needsMigration, newTemplateSection, normalizeSection, TEMPLATES } from '../js/templates.js';

const imported = () =>
  applyImport(
    emptyData(),
    {
      customers: [
        {
          name: 'Muster GmbH',
          sections: [
            { title: 'Muster Server', category: 'Fernwartung', entries: [{ label: 'AnyDesk', value: '123456789', kind: 'anydesk' }, { label: 'AnyDesk-Passwort', value: 'Ad1234!x', secret: true }, { label: 'TeamViewer', value: '987654321', kind: 'teamviewer' }] },
            { title: 'Microsoft 365 – muster.at', category: 'Microsoft 365', entries: [
              { label: 'Tenant-Admin', value: 'admin@muster.onmicrosoft.com' },
              { label: 'Admin-Passwort', value: 'Adm1n!pw', secret: true },
              { label: 'max.mustermann@muster.at', value: 'Mm1234!x', secret: true, note: 'Lizenz: E3' },
              { label: 'office@muster.at', value: 'Of1234!x', secret: true },
              { label: 'Lizenzkosten', value: 'Umstellungskosten: 300 · Pro Monat: 11,4' },
            ] },
            { title: 'Max Mustermann', category: 'Benutzer & Geräte', entries: [{ label: '', value: 'MSOffice365 Konto · max.mustermann@muster.at', secret: true }, { label: 'Windows Anmeldename', value: 'max' }] },
            { title: 'Qnap NAS', category: 'Server & NAS', entries: [{ label: 'Adresse', value: '192.168.1.5' }, { label: 'User', value: 'admin' }, { label: 'PW', value: 'Nas1234!', secret: true }] },
            { title: 'TP-Link LTE Router', category: 'Server & NAS', entries: [{ label: 'Adresse', value: '192.168.1.1' }, { label: 'PW', value: 'Rt1234!x', secret: true }] },
            { title: 'DHCP Bereich:', category: 'Server & NAS', entries: [{ label: 'Adresse', value: '192.168.1.1-50' }] },
            { title: 'Notizen', category: 'Notizen', entries: [{ label: '', value: 'Irgendwas' }] },
          ],
        },
      ],
    },
    't',
  ).data.customers[0];

const values = (c) => c.sections.flatMap((s) => s.entries.map((e) => e.value)).filter(Boolean);

test('Umstellung ordnet zu und verliert keinen Wert', () => {
  const c = imported();
  assert.ok(needsMigration(c));
  const m = migrateCustomer(c);
  assert.ok(!needsMigration(m));
  const nv = values(m);
  for (const v of values(c)) assert.ok(nv.includes(v) || nv.some((n) => v.endsWith(` · ${n}`)), `verloren: ${v}`);
  const of = (type) => m.sections.filter((s) => s.type === type);
  const field = (s, k) => s.entries.find((e) => e.field === k)?.value;
  assert.equal(field(of('firma')[0], 'name'), 'Muster GmbH');
  const server = of('geraet').find((s) => s.title === 'Muster Server');
  assert.equal(field(server, 'anydesk'), '123456789');
  assert.equal(field(server, 'anydeskpw'), 'Ad1234!x');
  assert.equal(field(server, 'typ'), 'Server');
  const persons = of('person');
  assert.equal(persons.length, 1, 'Postfach und Tabellenzeile derselben Person zusammengefuehrt, office@ ist keine Person');
  assert.equal(field(persons[0], 'name'), 'Max Mustermann');
  assert.equal(field(persons[0], 'email'), 'max.mustermann@muster.at');
  assert.equal(field(persons[0], 'm365pw'), 'Mm1234!x');
  assert.equal(field(persons[0], 'winuser'), 'max');
  const m365 = of('m365')[0];
  assert.equal(field(m365, 'tenant'), 'muster.onmicrosoft.com');
  assert.equal(field(m365, 'adminpw'), 'Adm1n!pw');
  assert.ok(m365.entries.some((e) => e.label === 'Postfach office@muster.at'));
  assert.equal(field(m365, 'kosten'), '11,4 €');
  const netz = of('netz')[0];
  assert.equal(field(netz, 'routerip'), '192.168.1.1');
  assert.equal(field(netz, 'routerpw'), 'Rt1234!x');
  assert.equal(field(netz, 'dhcp'), '192.168.1.1-50');
  assert.equal(field(of('geraet').find((s) => s.title === 'Qnap NAS'), 'adminpw'), 'Nas1234!');
  assert.equal(field(of('domain')[0], 'domain'), 'muster.at');
  assert.ok(m.sections.some((s) => s.category === 'Notizen'));
  assert.equal(migrateCustomer(m), m, 'zweites Umstellen aendert nichts');
});

test('Offene Punkte: Pflichtfelder fehlen, optionale und "gibt es nicht" zaehlen nicht', () => {
  const p = newTemplateSection('person', { name: 'A', email: 'a@b.at' });
  const c = { sections: [p] };
  const keys = missingFields(c).map((x) => x.field.key);
  assert.deepEqual(keys, ['m365pw', 'winuser', 'winpw', 'appleid', 'applepw']);
  p.entries.find((e) => e.field === 'appleid').na = true;
  assert.ok(!missingFields(c).some((x) => x.field.key === 'appleid'));
});

test('Vorlagen-Karte normalisieren: fehlende Felder ergaenzen, Reihenfolge, Zusatzfelder bleiben', () => {
  const sec = { id: 'x', type: 'geraet', title: '', category: 'X', entries: [{ id: 'e1', label: 'Bemerkung', value: 'v', secret: false, kind: 'text' }, { id: 'e2', field: 'ip', label: 'alt', value: '10.0.0.1', kind: 'text' }] };
  normalizeSection(sec);
  assert.equal(sec.category, 'Geräte');
  assert.deepEqual(sec.entries.slice(0, TEMPLATES.geraet.fields.length).map((e) => e.field), TEMPLATES.geraet.fields.map((f) => f.key));
  assert.equal(sec.entries.find((e) => e.field === 'ip').label, 'IP-Adresse');
  assert.equal(sec.entries.at(-1).label, 'Bemerkung');
});

test('Kontaktdaten aus Notizen: Handy zur Person, Adresse/Zentrale/UID zur Firma', async () => {
  const { suggestContacts, applySuggestions } = await import('../js/templates.js');
  const c = migrateCustomer(
    applyImport(emptyData(), { customers: [{ name: 'Muster GmbH', sections: [
      { title: 'Microsoft 365 – muster.at', category: 'Microsoft 365', entries: [{ label: 'anna.berg@muster.at', value: 'Ab1234!x', secret: true }] },
      { title: 'Notizen', category: 'Notizen', entries: [
        { label: '', value: 'anna.berg@muster.at' }, { label: 'PW', value: 'x', secret: true }, { label: 'Tel', value: '+43 664 1234567' },
        { label: 'Adressen', value: '1010 Wien, Testgasse 7 · phone +43(1)555-1234' }, { label: 'UID', value: 'ATU12345678' },
        { label: 'Alte Adresse', value: '1020 Wien, Altgasse 1' },
      ] },
    ] }] }, 't').data.customers[0],
  );
  const s = suggestContacts(c);
  assert.deepEqual(s.map((x) => `${x.owner}|${x.key}|${x.value}`), [
    'Anna Berg|handy|+43 664 1234567',
    'Muster GmbH|adresse|Testgasse 7, 1010 Wien',
    'Muster GmbH|telefon|+43(1)555-1234',
    'Muster GmbH|uid|ATU12345678',
  ]);
  const after = applySuggestions(c, s);
  assert.equal(suggestContacts(after).length, 0, 'nichts doppelt');
});
