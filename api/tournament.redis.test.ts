/**
 * Tests d'intégration contre un vrai Redis (ignorés par défaut).
 *   REDIS_TEST_URL=redis://localhost:6379        → mode « Redis » (REDIS_URL)
 *   UPSTASH_TEST_URL / UPSTASH_TEST_TOKEN         → mode Upstash REST
 */
import { describe, expect, it } from 'vitest';
import { redisStore, tcpRedisStore, type Store } from './tournament';

const e = process.env;
const targets: [string, () => Store][] = [];
if (e.REDIS_TEST_URL) targets.push(['Redis (REDIS_URL)', () => tcpRedisStore(e.REDIS_TEST_URL!)]);
if (e.UPSTASH_TEST_URL && e.UPSTASH_TEST_TOKEN) targets.push(['Upstash REST', () => redisStore(e.UPSTASH_TEST_URL!, e.UPSTASH_TEST_TOKEN!)]);

describe.skipIf(!targets.length)('stockage réel', () => {
  for (const [name, make] of targets) {
    it(`${name} : création, lecture, version, conflit`, async () => {
      const s = make();
      const id = `test${Math.random().toString(36).slice(2, 10)}`;
      const t = { name: 'Test', players: [{ id: 'a', name: 'Été « ok »' }], results: {} };
      expect(await s.get(id)).toBeNull();
      expect(await s.create(id, JSON.stringify(t))).toBe(true);
      expect(await s.create(id, JSON.stringify(t))).toBe(false);
      expect(await s.get(id)).toEqual({ v: 1, t });
      const t2 = { ...t, name: 'Deux' };
      expect(await s.cas(id, 1, JSON.stringify(t2))).toEqual({ status: 'ok', v: 2 });
      expect(await s.cas(id, 1, JSON.stringify(t))).toEqual({ status: 'conflict', doc: { v: 2, t: t2 } });
      expect(await s.cas('inconnu' + id, 1, '{}')).toEqual({ status: 'missing' });
      expect(await s.get(id)).toEqual({ v: 2, t: t2 });
    });
  }
});
