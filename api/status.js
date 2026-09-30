import { handler } from './_lib/server.js';

export default handler({
  async GET({ store }) {
    const cur = await store.read();
    return { initialized: !!cur, rev: cur ? cur.rev : 0 };
  },
});
