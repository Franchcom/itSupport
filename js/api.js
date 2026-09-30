// Duenne Schicht ueber fetch fuer die eigene API.

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
  get offline() {
    return this.status === 0;
  }
}

async function call(method, path, { body, auth } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    headers['X-KZ-User'] = encodeURIComponent(auth.user);
    headers['X-KZ-Key'] = auth.key;
  }
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'offline');
  } finally {
    clearTimeout(timer);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* leere oder fehlerhafte Antwort */
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `http_${res.status}`);
  return data;
}

export const api = {
  status: () => call('GET', 'status'),
  prelogin: (user) => call('POST', 'prelogin', { body: { user } }),
  setup: (body) => call('POST', 'setup', { body }),
  getVault: (auth) => call('GET', 'vault', { auth }),
  putVault: (auth, baseRev, vault) => call('PUT', 'vault', { auth, body: { baseRev, vault } }),
  users: (auth, body) => call('POST', 'users', { auth, body }),
  password: (auth, body) => call('POST', 'password', { auth, body }),
};
