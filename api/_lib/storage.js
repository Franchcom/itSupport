// Speicher fuer den Tresor. Der Server sieht nur Chiffretext: das Dokument
// enthaelt die Benutzerliste (mit verschluesselten Schluesseln) und den
// verschluesselten Datenblock. Zwei Umsetzungen:
//  - Upstash Redis ueber REST (Produktion auf Vercel)
//  - eine lokale JSON-Datei (Entwicklung und Tests)

import { readFile, writeFile, rename } from 'node:fs/promises';

const REV_KEY = 'kz:rev';
const DOC_KEY = 'kz:doc';

// Schreibt nur, wenn die Revision noch die erwartete ist (optimistische Sperre).
const CAS_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur ~= tonumber(ARGV[1]) then return {0, cur} end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], cur + 1)
return {1, cur + 1}
`;

const INCR_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

function upstash(url, token) {
  async function cmd(args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Speicherfehler: ${body.error || res.status}`);
    return body.result;
  }
  return {
    async read() {
      const [rev, doc] = await cmd(['MGET', REV_KEY, DOC_KEY]);
      if (!doc) return null;
      return { rev: Number(rev), doc: JSON.parse(doc) };
    },
    async write(baseRev, doc) {
      const [ok, rev] = await cmd(['EVAL', CAS_SCRIPT, '2', REV_KEY, DOC_KEY, String(baseRev), JSON.stringify(doc)]);
      return { ok: ok === 1, rev: Number(rev) };
    },
    async hit(key, ttlSec) {
      return Number(await cmd(['EVAL', INCR_SCRIPT, '1', `kz:rl:${key}`, String(ttlSec)]));
    },
    async hits(key) {
      return Number((await cmd(['GET', `kz:rl:${key}`])) || 0);
    },
    async clearHits(key) {
      await cmd(['DEL', `kz:rl:${key}`]);
    },
  };
}

function fileStore(path) {
  const counters = new Map();
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  async function load() {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  return {
    read: () => serial(load),
    write: (baseRev, doc) =>
      serial(async () => {
        const cur = await load();
        const rev = cur ? cur.rev : 0;
        if (rev !== baseRev) return { ok: false, rev };
        await writeFile(`${path}.tmp`, JSON.stringify({ rev: rev + 1, doc }));
        await rename(`${path}.tmp`, path);
        return { ok: true, rev: rev + 1 };
      }),
    async hit(key, ttlSec) {
      const now = Date.now();
      const c = counters.get(key);
      if (!c || c.until < now) {
        counters.set(key, { n: 1, until: now + ttlSec * 1000 });
        return 1;
      }
      return ++c.n;
    },
    async hits(key) {
      const c = counters.get(key);
      return c && c.until >= Date.now() ? c.n : 0;
    },
    async clearHits(key) {
      counters.delete(key);
    },
  };
}

let store;
export function getStore() {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) store = upstash(url, token);
  else if (process.env.KZ_FILE_STORE) store = fileStore(process.env.KZ_FILE_STORE);
  else throw new Error('Kein Speicher konfiguriert (KV_REST_API_URL/KV_REST_API_TOKEN fehlen).');
  return store;
}
