// Legt den Tresor einmalig an. Geschuetzt durch KZ_SETUP_TOKEN, damit niemand
// Fremdes ihn vor dir anlegen kann.
import { timingSafeEqual } from 'node:crypto';
import { handler, checkName, checkCredentials, checkBox, sha256, HttpError, MAX_VAULT, meOf } from './_lib/server.js';

export default handler({
  async POST({ body, store }) {
    const token = process.env.KZ_SETUP_TOKEN || '';
    if (token.length < 16) throw new HttpError(503, 'setup_disabled');
    const given = Buffer.from(sha256(String(body.setupToken || '')), 'hex');
    if (!timingSafeEqual(given, Buffer.from(sha256(token), 'hex'))) throw new HttpError(403, 'bad_setup_token');
    if (await store.read()) throw new HttpError(409, 'already_initialized');
    const name = checkName(body.user);
    const now = new Date().toISOString();
    const user = { role: 'admin', createdAt: now, ...checkCredentials(body) };
    const doc = { users: { [name]: user }, vault: checkBox(body.vault, MAX_VAULT), updatedAt: now, updatedBy: name };
    const w = await store.write(0, doc);
    if (!w.ok) throw new HttpError(409, 'already_initialized');
    return { rev: w.rev, me: meOf(name, user) };
  },
});
