// Verschluesselte Datenbloecke: Bilder und alte Versionen von Kunden.
// Der Browser verschluesselt vorher mit dem Datenschluessel; der Server
// speichert und liefert nur Chiffretext.
import { handler, authenticate, checkBox, HttpError } from './_lib/server.js';

const MAX_BLOB = 4 * 1024 * 1024;

function blobId(req) {
  const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
  if (!/^[a-z0-9]{8,32}$/.test(id)) throw new HttpError(400, 'invalid_id');
  return id;
}

export default handler({
  async GET({ req, store }) {
    await authenticate(req, store);
    const box = await store.getBlob(blobId(req));
    if (!box) throw new HttpError(404, 'not_found');
    return { box };
  },
  async PUT({ req, body, store }) {
    await authenticate(req, store);
    await store.putBlob(blobId(req), checkBox(body.box, MAX_BLOB));
    return { ok: true };
  },
  async DELETE({ req, store }) {
    await authenticate(req, store);
    await store.delBlob(blobId(req));
    return { ok: true };
  },
});
