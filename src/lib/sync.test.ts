import { beforeEach, describe, expect, it } from 'vitest';
import { handle, memoryStore, setStore } from '../../api/tournament';
import { readyQueue, resolve } from './engine';
import type { Action } from './store';
import { httpApi, LiveTournament, NotConfiguredError, type Api } from './sync';
import type { MatchResult, Tournament } from './types';

/** fetch branché directement sur le handler de l'API (comme en production, sans réseau). */
const apiFetch: typeof fetch = async (input, init) => handle(new Request(new URL(String(input), 'http://test'), init as RequestInit));

const create: Extract<Action, { type: 'create' }> = { type: 'create', name: 'Soirée', game: 'FC', format: 'single', matchMinutes: 15, count: 8 };
const resultFor = (t: Tournament, i = 0): { id: string; result: MatchResult } => {
  const m = readyQueue(resolve(t))[i];
  return { id: m.id, result: { a: m.pa!, b: m.pb!, sa: 2, sb: 0, winner: m.pa, method: 'normal', at: Date.now() } };
};
const settle = async (...cs: LiveTournament[]) => {
  for (let i = 0; i < 5; i++) await Promise.all(cs.flatMap((c) => [c.flush(), c.poll()]));
};

beforeEach(() => setStore(memoryStore()));

describe('API', () => {
  it('création, lecture, version inchangée, mise à jour, conflit', async () => {
    const api = httpApi('/api/tournament', apiFetch);
    const t0 = (await import('./store')).reducer(null, create)!;
    const { id, v } = await api.create(t0);
    expect(v).toBe(1);
    expect(await api.get(id)).toEqual({ v: 1, t: t0 });
    expect(await api.get(id, 1)).toBe('unchanged');
    const t1 = { ...t0, name: 'Renommé' };
    expect(await api.put(id, 1, t1)).toEqual({ status: 'ok', v: 2 });
    // Écriture basée sur une version périmée : refusée avec la version actuelle.
    expect(await api.put(id, 1, { ...t0, name: 'Trop tard' })).toEqual({ status: 'conflict', v: 2, t: t1 });
    expect(await api.get('inconnu123')).toBeNull();
  });

  it('refuse les données invalides', async () => {
    const r = await apiFetch('/api/tournament', { method: 'POST', body: JSON.stringify({ t: { hack: 1 } }) });
    expect(r.status).toBe(400);
    const big = await apiFetch('/api/tournament', { method: 'POST', body: 'x'.repeat(500_000) });
    expect(big.status).toBe(400);
  });

  it('signale clairement un stockage non configuré', async () => {
    setStore(null);
    const api = httpApi('/api/tournament', apiFetch);
    await expect(api.get('abcdefgh')).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

describe('synchronisation entre téléphones', () => {
  it('un tournoi créé sur un téléphone s’ouvre sur un autre avec le lien', async () => {
    const api = httpApi('/api/tournament', apiFetch);
    const a = new LiveTournament(api);
    expect(await a.create(create)).toBe(true);
    const id = a.getSnapshot().id!;
    const b = new LiveTournament(api);
    await b.open(id);
    expect(b.getSnapshot()).toMatchObject({ id, status: 'live' });
    expect(b.getSnapshot().t).toEqual(a.getSnapshot().t);
  });

  it('les scores saisis en même temps sur deux téléphones sont tous conservés', async () => {
    const api = httpApi('/api/tournament', apiFetch);
    const a = new LiveTournament(api);
    await a.create(create);
    a.dispatch({ type: 'draw' });
    await settle(a);
    const b = new LiveTournament(api);
    await b.open(a.getSnapshot().id!);
    const t = b.getSnapshot().t!;
    // A et B saisissent chacun un match différent, au même moment.
    const r0 = resultFor(t, 0);
    const r1 = resultFor(t, 1);
    a.dispatch({ type: 'setResult', ...r0 });
    b.dispatch({ type: 'setResult', ...r1 });
    await settle(a, b);
    for (const c of [a, b]) {
      const res = c.getSnapshot().t!.results;
      expect(Object.keys(res).sort()).toEqual([r0.id, r1.id].sort());
      expect(c.getSnapshot().status).toBe('live');
    }
    expect(a.getSnapshot().t).toEqual(b.getSnapshot().t);
  });

  it('hors ligne : la saisie est gardée puis envoyée au retour du réseau', async () => {
    const real = httpApi('/api/tournament', apiFetch);
    let online = true;
    const flaky: Api = {
      create: (t) => real.create(t),
      get: (id, v) => (online ? real.get(id, v) : Promise.reject(new Error('réseau'))),
      put: (id, b, t) => (online ? real.put(id, b, t) : Promise.reject(new Error('réseau'))),
    };
    const a = new LiveTournament(flaky);
    await a.create(create);
    a.dispatch({ type: 'draw' });
    await settle(a);
    online = false;
    const r = resultFor(a.getSnapshot().t!);
    a.dispatch({ type: 'setResult', ...r });
    await a.flush();
    expect(a.getSnapshot()).toMatchObject({ status: 'offline', pending: 1 });
    // Affiché localement malgré la coupure.
    expect(a.getSnapshot().t!.results[r.id]).toBeTruthy();
    online = true;
    await settle(a);
    expect(a.getSnapshot()).toMatchObject({ status: 'live', pending: 0 });
    const b = new LiveTournament(real);
    await b.open(a.getSnapshot().id!);
    expect(b.getSnapshot().t!.results[r.id]).toBeTruthy();
  });

  it('sans stockage en ligne, le tournoi fonctionne en local sur le téléphone', async () => {
    setStore(null);
    const a = new LiveTournament(httpApi('/api/tournament', apiFetch));
    expect(await a.create(create)).toBe(false);
    a.dispatch({ type: 'draw' });
    expect(a.getSnapshot()).toMatchObject({ id: null, status: 'local' });
    expect(a.getSnapshot().t!.status).toBe('running');
    // Le stockage revient : on peut publier le tournoi tel quel.
    setStore(memoryStore());
    expect(await a.publish()).toBe(true);
    expect(a.getSnapshot().status).toBe('live');
  });

  it('lien inconnu : statut introuvable', async () => {
    const a = new LiveTournament(httpApi('/api/tournament', apiFetch));
    await a.open('inconnu123');
    expect(a.getSnapshot().status).toBe('missing');
  });
});
