// Eigenes Master-Passwort aendern: neues Salt, neuer Nachweis, Datenschluessel
// neu verpackt. Die Daten selbst bleiben unveraendert.
import { handler, authenticate, checkCredentials, HttpError, meOf } from './_lib/server.js';

export default handler({
  async POST({ req, body, store }) {
    const { name, cur } = await authenticate(req, store);
    const creds = checkCredentials(body);
    const doc = structuredClone(cur.doc);
    doc.users[name] = { ...doc.users[name], ...creds, passwordChangedAt: new Date().toISOString() };
    const w = await store.write(cur.rev, doc);
    if (!w.ok) throw new HttpError(409, 'conflict');
    return { rev: w.rev, me: meOf(name, doc.users[name]) };
  },
});
