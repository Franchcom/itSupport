// Entsperrte Sitzung: haelt Schluessel und Klartextdaten im Speicher,
// speichert verschluesselt auf dem Geraet und gleicht mit dem Server ab.

import * as C from './crypto.js';
import { api, ApiError } from './api.js';
import { applyImport, emptyData, merge } from './model.js';

const CACHE_KEY = 'itsupport.cache.v1';

export function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveCache(obj) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

export function forgetDevice() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nichts zu tun */
  }
}

export class Session {
  constructor({ user, authKey, rawKey, key, me, data, rev, pending, users, vault }) {
    Object.assign(this, { user, authKey, rawKey, key, me, data, rev, pending, users, vault });
    this.status = pending ? 'pending' : 'synced';
    this.lastSync = null;
    this.listeners = new Set();
    this.syncing = null;
  }

  get auth() {
    return { user: this.user, key: this.authKey };
  }

  get isAdmin() {
    return this.me.role === 'admin';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what) {
    for (const fn of this.listeners) fn(what, this);
  }

  setStatus(s) {
    this.status = s;
    this.emit('status');
  }

  persist() {
    saveCache({
      user: this.user,
      me: this.me,
      rev: this.rev,
      vault: this.vault,
      pending: this.pending,
      users: this.users,
      savedAt: new Date().toISOString(),
    });
  }

  // Neuer Datenstand aus der Oberflaeche: verschluesseln, lokal ablegen, hochladen.
  async save(data) {
    this.data = data;
    this.vault = await C.encryptJSON(this.key, data);
    this.pending = true;
    this.persist();
    this.setStatus('pending');
    this.emit('data');
    this.sync();
  }

  sync() {
    if (!this.syncing) {
      this.syncing = this.#sync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  async #sync() {
    if (!this.key) return;
    this.setStatus('syncing');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (this.pending) {
          try {
            const r = await api.putVault(this.auth, this.rev, this.vault);
            this.rev = r.rev;
            this.pending = false;
            this.persist();
            break;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 409 || e.code !== 'conflict') throw e;
            // Jemand anderes hat inzwischen gespeichert: zusammenfuehren, erneut versuchen.
            await this.#pull(true);
          }
        } else {
          await this.#pull(false);
          break;
        }
      }
      this.lastSync = new Date();
      this.setStatus(this.pending ? 'pending' : 'synced');
    } catch (e) {
      if (e instanceof ApiError && e.offline) this.setStatus('offline');
      else if (e instanceof ApiError && e.status === 401) {
        this.setStatus('auth');
        this.emit('auth');
      } else {
        console.error(e);
        this.setStatus('error');
      }
    }
  }

  async #pull(mergeLocal) {
    if (!this.key) return;
    const r = await api.getVault(this.auth);
    this.users = r.users;
    this.me = r.me;
    if (r.rev === this.rev && !mergeLocal) {
      this.persist();
      this.emit('users');
      return;
    }
    const remote = await C.decryptJSON(this.key, r.vault);
    if (mergeLocal) {
      this.data = merge(this.data, remote);
      this.vault = await C.encryptJSON(this.key, this.data);
    } else {
      this.data = remote;
      this.vault = r.vault;
    }
    this.rev = r.rev;
    this.persist();
    this.emit('data');
    this.emit('users');
  }

  async changePassword(newPassword) {
    const creds = await C.makeCredentials(newPassword, this.rawKey);
    const r = await api.password(this.auth, creds);
    this.authKey = creds.authKey;
    this.me = r.me;
    this.persist();
    await this.sync();
  }

  async addUser(name, password, role) {
    const creds = await C.makeCredentials(password, this.rawKey);
    const r = await api.users(this.auth, { action: 'add', name, role, ...creds });
    this.users = r.users;
    this.emit('users');
    this.sync();
  }

  async removeUser(name) {
    const r = await api.users(this.auth, { action: 'remove', name });
    this.users = r.users;
    this.emit('users');
    this.sync();
  }

  // Verschluesselte Sicherung: nur mit einem Master-Passwort dieses Tresors lesbar.
  backup() {
    return {
      format: 'itsupport-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: this.user,
      vault: this.vault,
    };
  }

  // Nimmt eine Import-Datei (aus tools/import_bestand.py) oder eine Sicherung entgegen.
  async importFile(obj) {
    if (obj && obj.format === 'itsupport-backup') {
      let restored;
      try {
        restored = await C.decryptJSON(this.key, obj.vault);
      } catch {
        throw new Error('Diese Sicherung gehört zu einem anderen Tresor.');
      }
      const before = new Set(this.data.customers.map((c) => c.id));
      const data = merge(this.data, restored);
      await this.save(data);
      return { added: data.customers.filter((c) => !before.has(c.id)).length, replaced: 0 };
    }
    const r = applyImport(this.data, obj, this.user);
    await this.save(r.data);
    return r;
  }

  lock() {
    this.key = null;
    this.rawKey = null;
    this.authKey = null;
    this.data = null;
    this.listeners.clear();
  }
}

export async function setupVault({ token, user, password }) {
  const rawKey = C.newDataKey();
  const creds = await C.makeCredentials(password, rawKey);
  const key = await C.importDataKey(rawKey);
  const data = emptyData();
  const vault = await C.encryptJSON(key, data);
  const r = await api.setup({ setupToken: token, user, vault, ...creds });
  const s = new Session({
    user: r.me.name,
    authKey: creds.authKey,
    rawKey,
    key,
    me: r.me,
    data,
    rev: r.rev,
    pending: false,
    users: [{ name: r.me.name, role: 'admin' }],
    vault,
  });
  s.persist();
  return s;
}

export class UnlockError extends Error {}

// Entsperren: zuerst mit der Kopie auf dem Geraet (geht auch offline),
// sonst ueber den Server.
export async function unlock(userInput, password) {
  const user = userInput.trim().toLowerCase();
  const cache = loadCache();
  const cached = cache && cache.user === user ? cache : null;

  if (cached) {
    try {
      const { kek, authKey } = await C.deriveKeys(password, cached.me.salt, cached.me.iter);
      const rawKey = await C.unwrapKey(kek, cached.me.wrappedKey);
      const key = await C.importDataKey(rawKey);
      const data = await C.decryptJSON(key, cached.vault);
      const s = new Session({ user, authKey, rawKey, key, ...pick(cached), data });
      s.sync();
      return s;
    } catch {
      // Falsches Passwort, oder das Passwort wurde auf einem anderen Geraet
      // geaendert: online nachsehen.
    }
  }

  let pre;
  try {
    pre = await api.prelogin(user);
  } catch (e) {
    if (e instanceof ApiError && e.offline) {
      throw new UnlockError(cached ? 'Falsches Passwort.' : 'Keine Verbindung und auf diesem Gerät noch keine Daten.');
    }
    throw e;
  }
  const { kek, authKey } = await C.deriveKeys(password, pre.salt, pre.iter);
  let r;
  try {
    r = await api.getVault({ user, key: authKey });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw new UnlockError('Benutzername oder Passwort falsch.');
    if (e instanceof ApiError && e.status === 429) throw new UnlockError('Zu viele Fehlversuche. Bitte 15 Minuten warten.');
    throw e;
  }
  const rawKey = await C.unwrapKey(kek, r.me.wrappedKey);
  const key = await C.importDataKey(rawKey);
  let data = await C.decryptJSON(key, r.vault);
  let vault = r.vault;
  let pending = false;
  if (cached && cached.pending) {
    // Offline gemachte Aenderungen dieses Geraets nicht verlieren.
    try {
      data = merge(await C.decryptJSON(key, cached.vault), data);
      vault = await C.encryptJSON(key, data);
      pending = true;
    } catch {
      /* alte Kopie nicht lesbar: verwerfen */
    }
  }
  const s = new Session({ user, authKey, rawKey, key, me: r.me, data, rev: r.rev, pending, users: r.users, vault });
  s.persist();
  if (pending) s.sync();
  else s.lastSync = new Date();
  return s;
}

function pick(c) {
  return { me: c.me, rev: c.rev, pending: c.pending, users: c.users || [], vault: c.vault };
}
