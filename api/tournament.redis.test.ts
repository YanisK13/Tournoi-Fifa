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
    it(`${name} : création, lecture, version, conflit, annulation, clé`, async () => {
      const s = make();
      const id = `test${Math.random().toString(36).slice(2, 10)}`;
      const t = { name: 'Test', players: [{ id: 'a', name: 'Été « ok »' }], results: {} };
      expect(await s.get(id)).toBeNull();
      expect(await s.create(id, JSON.stringify(t), 'cle-secrete')).toBe(true);
      expect(await s.create(id, JSON.stringify(t), 'autre')).toBe(false);
      expect(await s.get(id)).toEqual({ v: 1, t, k: 'cle-secrete' });
      const t2 = { ...t, name: 'Deux' };
      const t3 = { ...t, name: 'Trois' };
      expect(await s.cas(id, 1, JSON.stringify(t2))).toEqual({ status: 'ok', v: 2 });
      expect(await s.cas(id, 1, JSON.stringify(t))).toEqual({ status: 'conflict', doc: { v: 2, t: t2 } });
      expect(await s.cas(id, 2, JSON.stringify(t3))).toEqual({ status: 'ok', v: 3 });
      expect(await s.cas('inconnu' + id, 1, '{}')).toEqual({ status: 'missing' });
      // Annulation : on remonte l'historique version par version.
      expect(await s.undo(id, 2)).toMatchObject({ status: 'conflict' });
      expect(await s.undo(id, 3)).toEqual({ status: 'ok', v: 4, t: t2 });
      expect(await s.undo(id, 4)).toEqual({ status: 'ok', v: 5, t });
      expect(await s.undo(id, 5)).toEqual({ status: 'empty' });
      expect(await s.get(id)).toEqual({ v: 5, t, k: 'cle-secrete' });
      expect(await s.claim(id, 'pirate')).toBe('taken');
    });

    it(`${name} : l'historique est limité aux 30 dernières versions`, async () => {
      const s = make();
      const id = `test${Math.random().toString(36).slice(2, 10)}`;
      const t = (n: number) => ({ name: `v${n}`, players: [], results: {} });
      await s.create(id, JSON.stringify(t(1)), 'k');
      for (let n = 2; n <= 40; n++) expect(await s.cas(id, n - 1, JSON.stringify(t(n)))).toEqual({ status: 'ok', v: n });
      let v = 40;
      let undone = 0;
      for (;;) {
        const r = await s.undo(id, v);
        if (r.status !== 'ok') break;
        v = r.v;
        undone++;
      }
      expect(undone).toBe(30);
      expect((await s.get(id))!.t).toEqual(t(10));
    });
  }
});
