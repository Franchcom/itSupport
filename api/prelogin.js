// Liefert Salt und Iterationszahl, damit der Browser seine Schluessel ableiten kann.
import { handler, checkName, fakeSalt, HttpError } from './_lib/server.js';

const DEFAULT_ITER = 600000;

export default handler({
  async POST({ body, store }) {
    const name = checkName(body.user);
    const cur = await store.read();
    if (!cur) throw new HttpError(409, 'not_initialized');
    const u = cur.doc.users[name];
    return u ? { salt: u.salt, iter: u.iter } : { salt: fakeSalt(name), iter: DEFAULT_ITER };
  },
});
