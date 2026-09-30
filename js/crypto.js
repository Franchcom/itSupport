// Verschluesselung im Browser (WebCrypto). Laeuft unveraendert auch in Node,
// dort fuer die Tests.
//
// Master-Passwort --PBKDF2-SHA256--> 512 Bit
//   erste Haelfte:  KEK, entschluesselt den Datenschluessel (verlaesst das Geraet nie)
//   zweite Haelfte: authKey, Anmeldenachweis gegenueber dem Server
// Datenschluessel (zufaellig, 256 Bit) --AES-GCM--> Kundendaten

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_ITER = 600000;

export function b64(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64(n) {
  return b64(globalThis.crypto.getRandomValues(new Uint8Array(n)));
}

export async function deriveKeys(password, salt, iter = KDF_ITER) {
  const base = await subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: iter }, base, 512),
  );
  const kek = await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { kek, authKey: b64(bits.slice(32)) };
}

async function seal(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

async function open(key, box) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
}

export function newDataKey() {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function importDataKey(raw) {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export const wrapKey = (kek, raw) => seal(kek, raw);

// Wirft bei falschem Passwort (GCM-Pruefsumme stimmt nicht).
export const unwrapKey = (kek, box) => open(kek, box);

export async function encryptJSON(key, obj) {
  return seal(key, te.encode(JSON.stringify(obj)));
}

export async function decryptJSON(key, box) {
  return JSON.parse(td.decode(await open(key, box)));
}

// Alles, was der Server fuer einen (neuen) Zugang braucht.
export async function makeCredentials(password, rawDataKey) {
  const salt = randomB64(16);
  const { kek, authKey } = await deriveKeys(password, salt, KDF_ITER);
  return { salt, iter: KDF_ITER, authKey, wrappedKey: await wrapKey(kek, rawDataKey) };
}

// Rohdaten (z. B. Bilder) ver-/entschluesseln.
export const encryptBytes = (key, bytes) => seal(key, bytes);
export const decryptBytes = (key, box) => open(key, box);
