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
    const { id, v, key } = await api.create(t0);
    expect(v).toBe(1);
    expect(await api.get(id)).toEqual({ v: 1, t: t0, protected: true, admin: false });
    expect(await api.get(id, undefined, key)).toEqual({ v: 1, t: t0, protected: true, admin: true });
    expect(await api.get(id, 1)).toBe('unchanged');
    const t1 = { ...t0, name: 'Renommé' };
    expect(await api.put(id, 1, t1)).toEqual({ status: 'forbidden' });
    expect(await api.put(id, 1, t1, key)).toEqual({ status: 'ok', v: 2 });
    // Écriture basée sur une version périmée : refusée avec la version actuelle.
    expect(await api.put(id, 1, { ...t0, name: 'Trop tard' }, key)).toEqual({ status: 'conflict', v: 2, t: t1 });
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

describe('organisateur et participants', () => {
  const setup = async () => {
    const api = httpApi('/api/tournament', apiFetch);
    const admin = new LiveTournament(api);
    await admin.create(create);
    const player = new LiveTournament(api);
    await player.open(admin.getSnapshot().id!);
    return { api, admin, player };
  };

  it('le créateur est organisateur, les autres sont participants', async () => {
    const { admin, player } = await setup();
    expect(admin.getSnapshot()).toMatchObject({ role: 'admin', protected: true });
    expect(player.getSnapshot()).toMatchObject({ role: 'player', protected: true });
  });

  it('un participant ne peut pas lancer le tirage ni recommencer, mais peut saisir un score', async () => {
    const { admin, player } = await setup();
    player.dispatch({ type: 'draw' });
    expect(player.getSnapshot().notice?.msg).toContain('organisateur');
    expect(player.getSnapshot().pending).toBe(0);
    admin.dispatch({ type: 'draw' });
    await settle(admin, player);
    expect(player.getSnapshot().t!.status).toBe('running');
    player.dispatch({ type: 'restart' });
    await settle(admin, player);
    expect(admin.getSnapshot().t!.status).toBe('running');
    const r = resultFor(player.getSnapshot().t!);
    player.dispatch({ type: 'setResult', ...r });
    player.dispatch({ type: 'setTeam', id: player.getSnapshot().t!.players[0].id, team: { name: 'OM' } });
    await settle(admin, player);
    expect(admin.getSnapshot().t!.results[r.id]).toBeTruthy();
    expect(admin.getSnapshot().t!.players[0].team).toEqual({ name: 'OM' });
  });

  it('le serveur refuse même si un participant contourne l’interface', async () => {
    const { api, admin } = await setup();
    const id = admin.getSnapshot().id!;
    const doc = await api.get(id);
    if (!doc || doc === 'unchanged') throw new Error('doc');
    expect(await api.put(id, doc.v, { ...doc.t, status: 'running', seeds: doc.t.players.map((p) => p.id) })).toEqual({ status: 'forbidden' });
  });

  it('l’organisateur annule la dernière action, même faite par un autre', async () => {
    const { admin, player } = await setup();
    admin.dispatch({ type: 'draw' });
    await settle(admin, player);
    const r = resultFor(player.getSnapshot().t!);
    player.dispatch({ type: 'setResult', ...r });
    await settle(admin, player);
    expect(admin.getSnapshot().t!.results[r.id]).toBeTruthy();
    await admin.undo();
    expect(admin.getSnapshot().notice?.msg).toBe('Dernière action annulée.');
    await settle(admin, player);
    expect(player.getSnapshot().t!.results[r.id]).toBeUndefined();
    // Annuler aussi un « Recommencer » malencontreux.
    admin.dispatch({ type: 'restart' });
    await settle(admin);
    expect(admin.getSnapshot().t!.status).toBe('setup');
    await admin.undo();
    expect(admin.getSnapshot().t!.status).toBe('running');
    await player.undo();
    expect(player.getSnapshot().notice?.msg).toContain('organisateur');
  });

  it('lien organisateur : un second téléphone devient organisateur avec la clé', async () => {
    const { api, admin } = await setup();
    const other = new LiveTournament(api);
    await other.open(admin.getSnapshot().id!, admin.adminKey());
    expect(other.getSnapshot().role).toBe('admin');
  });

  it('ancien tournoi sans clé : ouvert, puis un téléphone peut le protéger', async () => {
    const store = memoryStore();
    setStore(store);
    const t0 = (await import('./store')).reducer(null, create)!;
    await store.create('ancien12', JSON.stringify(t0), '');
    const api = httpApi('/api/tournament', apiFetch);
    const a = new LiveTournament(api);
    const b = new LiveTournament(api);
    await a.open('ancien12');
    await b.open('ancien12');
    expect(a.getSnapshot()).toMatchObject({ role: 'admin', protected: false });
    expect(await a.claim()).toBe(true);
    expect(a.getSnapshot()).toMatchObject({ role: 'admin', protected: true });
    b.dispatch({ type: 'draw' });
    await settle(b);
    expect(b.getSnapshot()).toMatchObject({ role: 'player' });
    expect(b.getSnapshot().t!.status).toBe('setup');
    expect(await b.claim()).toBe(false);
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
      get: (id, v, k) => (online ? real.get(id, v, k) : Promise.reject(new Error('réseau'))),
      put: (id, b, t, k) => (online ? real.put(id, b, t, k) : Promise.reject(new Error('réseau'))),
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
