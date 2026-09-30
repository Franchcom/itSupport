import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upstashEnv } from '../api/_lib/storage.js';

test('Upstash-Zugangsdaten werden unter allen ueblichen Namen gefunden', () => {
  assert.deepEqual(upstashEnv({ KV_REST_API_URL: 'u', KV_REST_API_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.deepEqual(upstashEnv({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.deepEqual(upstashEnv({ STORAGE_KV_REST_API_URL: 'u', STORAGE_KV_REST_API_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.equal(upstashEnv({ KV_REST_API_URL: 'u' }), null);
  assert.equal(upstashEnv({}), null);
});
