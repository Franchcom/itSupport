import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/crypto.js';
import { applyImport, emptyData, merge, reusedSecrets, search, secretTokens, formatId, guessKind } from '../js/model.js';

test('Schluessel ableiten, verpacken und Daten ver-/entschluesseln', async () => {
  const raw = C.newDataKey();
  const creds = await C.makeCredentials('ein sehr langes Passwort', raw);
  const { kek, authKey } = await C.deriveKeys('ein sehr langes Passwort', creds.salt, creds.iter);
  assert.equal(authKey, creds.authKey);
  const back = await C.unwrapKey(kek, creds.wrappedKey);
  assert.deepEqual([...back], [...raw]);
  const key = await C.importDataKey(raw);
  const box = await C.encryptJSON(key, { a: 'Mößner' });
  assert.ok(!Buffer.from(C.unb64(box.ct)).toString('latin1').includes('J\xc3'));
  assert.deepEqual(await C.decryptJSON(key, box), { a: 'Mößner' });
});

test('falsches Passwort scheitert am Entpacken', async () => {
  const raw = C.newDataKey();
  const creds = await C.makeCredentials('richtiges Passwort!', raw);
  const { kek } = await C.deriveKeys('falsches Passwort!!', creds.salt, creds.iter);
  await assert.rejects(C.unwrapKey(kek, creds.wrappedKey));
});

const sample = () =>
  applyImport(
    emptyData(),
    {
      customers: [
        {
          name: 'Muster Fleisch',
          sections: [
            { title: 'Server', category: 'Fernwartung', entries: [{ label: 'AnyDesk', value: '123456789', kind: 'anydesk' }, { label: 'Passwort', value: 'Geheim123?', secret: true }] },
            { title: 'Netzwerk', category: 'Netzwerk', entries: [{ label: 'Gateway', value: '192.168.178.1' }] },
          ],
        },
        { name: 'Mößner Kanzlei', sections: [{ title: 'PC', category: 'Fernwartung', entries: [{ label: 'Admin', value: 'admin / Geheim123?', secret: true }] }] },
      ],
    },
    'test',
  ).data;

test('Import legt Kunden an und ersetzt gleichnamige', () => {
  const data = sample();
  assert.equal(data.customers.length, 2);
  assert.equal(data.customers[0].sections[1].entries[0].kind, 'ip');
  const r = applyImport(data, { customers: [{ name: 'muster fleisch', sections: [] }] }, 'test');
  assert.equal(r.replaced, 1);
  assert.equal(r.data.customers.length, 2);
  assert.equal(r.data.customers[0].id, data.customers[0].id);
});

test('Suche: Kundenname liefert Kunde plus Fernwartung, Umlaute egal', () => {
  const data = sample();
  const hits = search(data, 'muster');
  assert.equal(hits[0].entry, null);
  assert.equal(hits[1].entry.kind, 'anydesk');
  assert.equal(search(data, 'moessner').length, 1);
  assert.equal(search(data, 'muster gateway')[0].entry.value, '192.168.178.1');
  assert.equal(search(data, '192.168.178').length, 1);
});

test('Mehrfach verwendete Passwoerter ueber Kunden hinweg', () => {
  const groups = reusedSecrets(sample());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].customers, 2);
  assert.deepEqual(secretTokens('admin / Geheim123?'), ['Geheim123?']);
});

test('Zusammenfuehren: neuerer Stand je Kunde gewinnt, Loeschungen bleiben', () => {
  const a = sample();
  const b = structuredClone(a);
  a.customers[0] = { ...a.customers[0], name: 'Muster NEU', updatedAt: '2030-01-01T00:00:00Z' };
  b.customers[1] = { id: b.customers[1].id, name: 'x', deleted: true, sections: [], updatedAt: '2030-01-01T00:00:00Z' };
  b.customers.push({ id: 'neu', name: 'Neu', sections: [], updatedAt: '2030-01-01T00:00:00Z' });
  const m = merge(a, b);
  assert.equal(m.customers.length, 3);
  assert.equal(m.customers.find((c) => c.id === a.customers[0].id).name, 'Muster NEU');
  assert.ok(m.customers.find((c) => c.id === a.customers[1].id).deleted);
});

test('Hilfsfunktionen', () => {
  assert.equal(formatId('123456789'), '123 456 789');
  assert.equal(formatId('1401356314'), '1 401 356 314');
  assert.equal(guessKind('AnyDesk', '123456789'), 'anydesk');
  assert.equal(guessKind('Portal', 'https://admin.microsoft.com'), 'url');
  assert.equal(guessKind('NAS', '192.168.0.2:5000'), 'ip');
});

test('Verlauf: Aenderungen werden beschrieben, geaenderte Eintraege erkannt', async () => {
  const { diffCustomers, changedEntryIds, snapshotOf } = await import('../js/model.js');
  const before = sample().customers[0];
  before.versions = [{ id: 'v1', savedAt: '2026-01-01' }];
  const after = structuredClone(before);
  after.sections[0].entries[1].value = 'Neu456!';
  after.sections[1].entries.push({ id: 'x1', label: 'DNS', value: '8.8.8.8', secret: false, kind: 'ip', note: '' });
  after.sections[1].entries.splice(0, 1);
  const d = diffCustomers(before, after);
  assert.ok(d.includes('geändert: Server – Passwort'));
  assert.ok(d.includes('neu: Netzwerk – DNS'));
  assert.ok(d.includes('entfernt: Netzwerk – Gateway'));
  assert.deepEqual(diffCustomers(before, structuredClone(before)), []);
  assert.equal(snapshotOf(before).versions, undefined);
  const ids = changedEntryIds(before, after);
  assert.ok(ids.has(before.sections[0].entries[1].id));
  assert.ok(!ids.has(before.sections[0].entries[0].id));
});

test('Zusammenfuehren behaelt die Versionen beider Geraete', () => {
  const a = sample();
  const b = structuredClone(a);
  a.customers[0].versions = [{ id: 'va', savedAt: '2030-01-02' }];
  a.customers[0].updatedAt = '2030-01-02';
  b.customers[0].versions = [{ id: 'vb', savedAt: '2030-01-01' }];
  const m = merge(a, b);
  assert.deepEqual(m.customers.find((c) => c.id === a.customers[0].id).versions.map((v) => v.id), ['va', 'vb']);
});
