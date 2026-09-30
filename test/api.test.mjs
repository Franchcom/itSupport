// Startet die echten API-Handler mit Dateispeicher und spielt die Ablaeufe durch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '../js/crypto.js';

let dir, server, base;
const TOKEN = 'test-setup-token-123456';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'itsupport-'));
  process.env.KZ_FILE_STORE = join(dir, 'store.json');
  process.env.KZ_SETUP_TOKEN = TOKEN;
  const handlers = {};
  for (const n of ['status', 'prelogin', 'setup', 'vault', 'users', 'password', 'blob']) {
    handlers[n] = (await import(`../api/${n}.js`)).default;
  }
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.slice(5).replace(/\?.*/, '');
    handlers[name](req, res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api/`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) Object.assign(headers, { 'X-KZ-User': encodeURIComponent(auth.user), 'X-KZ-Key': auth.key });
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('kompletter Ablauf: Einrichtung, Anmeldung, Speichern, Konflikt, Mitarbeiter, Passwort', async () => {
  assert.deepEqual((await call('GET', 'status')).body, { initialized: false, rev: 0 });

  const raw = C.newDataKey();
  const key = await C.importDataKey(raw);
  const admin = await C.makeCredentials('admin-passwort-lang', raw);
  const vault0 = await C.encryptJSON(key, { schema: 1, customers: [] });

  assert.equal((await call('POST', 'setup', { setupToken: 'falsch', user: 'andreas', vault: vault0, ...admin })).status, 403);
  const setup = await call('POST', 'setup', { setupToken: TOKEN, user: 'Andreas', vault: vault0, ...admin });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.me.name, 'andreas');
  assert.equal((await call('POST', 'setup', { setupToken: TOKEN, user: 'x', vault: vault0, ...admin })).status, 409);

  // Anmeldung wie im Browser
  const pre = await call('POST', 'prelogin', { user: 'andreas' });
  const { kek, authKey } = await C.deriveKeys('admin-passwort-lang', pre.body.salt, pre.body.iter);
  const auth = { user: 'andreas', key: authKey };
  const got = await call('GET', 'vault', null, auth);
  assert.equal(got.status, 200);
  assert.deepEqual([...(await C.unwrapKey(kek, got.body.me.wrappedKey))], [...raw]);

  // Unbekannte Namen bekommen ein stabiles Schein-Salt
  const fake1 = await call('POST', 'prelogin', { user: 'gibtsnicht' });
  const fake2 = await call('POST', 'prelogin', { user: 'gibtsnicht' });
  assert.equal(fake1.body.salt, fake2.body.salt);

  assert.equal((await call('GET', 'vault', null, { user: 'andreas', key: 'AAAA' })).status, 401);

  // Speichern mit Revision, veraltete Revision -> 409
  const v1 = await C.encryptJSON(key, { schema: 1, customers: [{ id: 'a', name: 'A' }] });
  const put = await call('PUT', 'vault', { baseRev: got.body.rev, vault: v1 }, auth);
  assert.equal(put.status, 200);
  assert.equal((await call('PUT', 'vault', { baseRev: got.body.rev, vault: v1 }, auth)).status, 409);

  // Mitarbeiter anlegen, der kann lesen und schreiben, aber keine Benutzer verwalten
  const member = await C.makeCredentials('mitarbeiter-passwort', raw);
  const add = await call('POST', 'users', { action: 'add', name: 'mitarbeiter', role: 'member', ...member }, auth);
  assert.equal(add.status, 200);
  assert.equal(add.body.users.length, 2);
  const mAuth = { user: 'mitarbeiter', key: member.authKey };
  const mGot = await call('GET', 'vault', null, mAuth);
  assert.equal(mGot.status, 200);
  assert.deepEqual(await C.decryptJSON(key, mGot.body.vault), { schema: 1, customers: [{ id: 'a', name: 'A' }] });
  assert.equal((await call('POST', 'users', { action: 'remove', name: 'andreas' }, mAuth)).status, 403);

  // Passwort aendern: alter Nachweis gilt nicht mehr
  const neu = await C.makeCredentials('neues-mitarbeiter-pw', raw);
  assert.equal((await call('POST', 'password', neu, mAuth)).status, 200);
  assert.equal((await call('GET', 'vault', null, mAuth)).status, 401);
  assert.equal((await call('GET', 'vault', null, { user: 'mitarbeiter', key: neu.authKey })).status, 200);

  // Entfernen
  assert.equal((await call('POST', 'users', { action: 'remove', name: 'andreas' }, auth)).status, 400);
  assert.equal((await call('POST', 'users', { action: 'remove', name: 'mitarbeiter' }, auth)).status, 200);
  assert.equal((await call('GET', 'vault', null, { user: 'mitarbeiter', key: neu.authKey })).status, 401);
});

test('Sperre nach zu vielen Fehlversuchen', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await call('GET', 'vault', null, { user: 'angreifer', key: 'QUFBQQ==' });
  assert.equal(last.status, 429);
});

test('E-Mail-Adresse als Benutzername', async () => {
  const { checkName } = await import('../api/_lib/server.js');
  assert.equal(checkName(' Office@Franchcom.at '), 'office@franchcom.at');
  assert.equal(checkName('andreas'), 'andreas');
  assert.throws(() => checkName('a b@x.at'));
  assert.throws(() => checkName('x@y'));
});

test('Datenbloecke: nur angemeldet, speichern, lesen, loeschen', async () => {
  const pre = await call('POST', 'prelogin', { user: 'andreas' });
  const { authKey } = await C.deriveKeys('admin-passwort-lang', pre.body.salt, pre.body.iter);
  const auth = { user: 'andreas', key: authKey };
  const box = { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'QUJD' };
  assert.equal((await call('PUT', 'blob?id=abcdefgh12', { box })).status, 401);
  assert.equal((await call('PUT', 'blob?id=../etc', { box }, auth)).status, 400);
  assert.equal((await call('PUT', 'blob?id=abcdefgh12', { box }, auth)).status, 200);
  const got = await call('GET', 'blob?id=abcdefgh12', null, auth);
  assert.deepEqual(got.body.box, box);
  assert.equal((await call('DELETE', 'blob?id=abcdefgh12', null, auth)).status, 200);
  assert.equal((await call('GET', 'blob?id=abcdefgh12', null, auth)).status, 404);
});
