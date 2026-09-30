// Tresor lesen (GET) und speichern (PUT, nur auf Basis der aktuellen Revision).
import { handler, authenticate, checkBox, HttpError, MAX_VAULT, meOf, publicUsers } from './_lib/server.js';

export default handler({
  async GET({ req, store }) {
    const { name, user, cur } = await authenticate(req, store);
    return {
      rev: cur.rev,
      vault: cur.doc.vault,
      updatedAt: cur.doc.updatedAt,
      updatedBy: cur.doc.updatedBy,
      me: meOf(name, user),
      users: publicUsers(cur.doc),
    };
  },
  async PUT({ req, body, store }) {
    const { name, cur } = await authenticate(req, store);
    const baseRev = Number(body.baseRev);
    if (baseRev !== cur.rev) throw new HttpError(409, 'conflict');
    const now = new Date().toISOString();
    const doc = { ...cur.doc, vault: checkBox(body.vault, MAX_VAULT), updatedAt: now, updatedBy: name };
    const w = await store.write(baseRev, doc);
    if (!w.ok) throw new HttpError(409, 'conflict');
    return { rev: w.rev, updatedAt: now };
  },
});
