// Benutzerverwaltung (nur Admin): Mitarbeiter anlegen und entfernen.
// Den Datenschluessel fuer den neuen Benutzer verschluesselt der Browser des
// Admins; der Server sieht ihn nie im Klartext.
import { handler, authenticate, checkName, checkCredentials, HttpError, publicUsers } from './_lib/server.js';

async function update(store, cur, mutate) {
  const doc = structuredClone(cur.doc);
  mutate(doc);
  const w = await store.write(cur.rev, doc);
  if (!w.ok) throw new HttpError(409, 'conflict');
  return { rev: w.rev, users: publicUsers(doc) };
}

export default handler({
  async POST({ req, body, store }) {
    const { name: me, user, cur } = await authenticate(req, store);
    if (user.role !== 'admin') throw new HttpError(403, 'forbidden');
    const name = checkName(body.name);
    if (body.action === 'add') {
      if (cur.doc.users[name]) throw new HttpError(409, 'user_exists');
      const role = body.role === 'admin' ? 'admin' : 'member';
      const creds = checkCredentials(body);
      return update(store, cur, (doc) => {
        doc.users[name] = { role, createdAt: new Date().toISOString(), createdBy: me, ...creds };
      });
    }
    if (body.action === 'remove') {
      if (name === me) throw new HttpError(400, 'cannot_remove_self');
      if (!cur.doc.users[name]) throw new HttpError(404, 'unknown_user');
      return update(store, cur, (doc) => {
        delete doc.users[name];
      });
    }
    throw new HttpError(400, 'invalid_action');
  },
});
