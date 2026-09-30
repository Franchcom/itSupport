// Gemeinsame Bausteine der API: Antworten, Eingabepruefung, Anmeldung.
//
// Anmeldung: Der Browser leitet aus dem Master-Passwort per PBKDF2 zwei
// Schluessel ab. Den einen (KEK) sieht der Server nie, er entschluesselt den
// Datenschluessel. Den anderen (authKey) schickt der Browser als Nachweis mit;
// der Server speichert davon nur einen SHA-256-Hash.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from './storage.js';

export const KDF_ITER_MIN = 300000;
const USER_FAIL_LIMIT = 10;
const IP_FAIL_LIMIT = 50;
const FAIL_WINDOW_SEC = 15 * 60;

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body || {};
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// Umhuellt einen Handler: Methodenpruefung, JSON-Body, Fehlerbehandlung.
export function handler(methods) {
  return async (req, res) => {
    const fn = methods[req.method];
    if (!fn) return send(res, 405, { error: 'method_not_allowed' });
    try {
      let body = {};
      if (req.method !== 'GET') {
        try {
          body = await readBody(req);
        } catch {
          throw new HttpError(400, 'invalid_json');
        }
      }
      const out = await fn({ req, body, store: getStore() });
      send(res, out.status || 200, out.body ?? out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      if (e.code === 'storage_missing') return send(res, 503, { error: 'storage_missing' });
      console.error(e);
      send(res, 500, { error: 'server' });
    }
  };
}

const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

export function checkB64(v, maxLen, code = 'invalid_input') {
  if (typeof v !== 'string' || !v.length || v.length > maxLen || !B64.test(v)) throw new HttpError(400, code);
  return v;
}

export function checkBox(box, maxLen) {
  if (!box || typeof box !== 'object') throw new HttpError(400, 'invalid_box');
  return { v: 1, iv: checkB64(box.iv, 32, 'invalid_box'), ct: checkB64(box.ct, maxLen, 'invalid_box') };
}

export function checkName(v) {
  const name = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[a-z0-9._-]{2,32}$/.test(name)) throw new HttpError(400, 'invalid_name');
  return name;
}

// Neuer bzw. geaenderter Zugang eines Benutzers, wie ihn der Browser schickt.
export function checkCredentials(body) {
  const iter = Number(body.iter);
  if (!Number.isInteger(iter) || iter < KDF_ITER_MIN || iter > 10000000) throw new HttpError(400, 'invalid_iter');
  return {
    salt: checkB64(body.salt, 64),
    iter,
    authHash: sha256(checkB64(body.authKey, 64)),
    wrappedKey: checkBox(body.wrappedKey, 256),
  };
}

export const MAX_VAULT = 6 * 1024 * 1024;

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function sameHex(a, b) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

// Fuer unbekannte Benutzernamen liefert prelogin ein stabiles Schein-Salt,
// damit sich nicht erraten laesst, welche Namen existieren.
export function fakeSalt(name) {
  const secret = process.env.KZ_SETUP_TOKEN || 'kundenzentrale';
  return createHmac('sha256', secret).update(`salt:${name}`).digest('base64').slice(0, 22);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown';
}

export async function authenticate(req, store) {
  let name;
  try {
    name = checkName(decodeURIComponent(req.headers['x-kz-user'] || ''));
  } catch {
    throw new HttpError(401, 'unauthorized');
  }
  const key = req.headers['x-kz-key'];
  const ip = clientIp(req);
  if ((await store.hits(`u:${name}`)) >= USER_FAIL_LIMIT || (await store.hits(`ip:${ip}`)) >= IP_FAIL_LIMIT) {
    throw new HttpError(429, 'too_many_attempts');
  }
  const cur = await store.read();
  if (!cur) throw new HttpError(409, 'not_initialized');
  const user = cur.doc.users[name];
  const ok = user && typeof key === 'string' && B64.test(key) && sameHex(sha256(key), user.authHash);
  if (!ok) {
    await store.hit(`u:${name}`, FAIL_WINDOW_SEC);
    await store.hit(`ip:${ip}`, FAIL_WINDOW_SEC);
    throw new HttpError(401, 'unauthorized');
  }
  await store.clearHits(`u:${name}`);
  return { name, user, cur };
}

export function publicUsers(doc) {
  return Object.entries(doc.users).map(([name, u]) => ({ name, role: u.role, createdAt: u.createdAt }));
}

export function meOf(name, user) {
  return { name, role: user.role, salt: user.salt, iter: user.iter, wrappedKey: user.wrappedKey };
}
