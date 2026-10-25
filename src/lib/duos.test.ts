import { describe, expect, it } from 'vitest';
import { handle, memoryStore, playerMayChange, setStore } from '../../api/tournament';
import { duoId, formatError, participants, ranking, readyQueue, resolve } from './engine';
import { reducer } from './store';
import type { Format, Tournament } from './types';

const make = (count: number, format: Format = 'single') =>
  reducer(null, { type: 'create', name: 'T', game: 'FC', format, matchMinutes: 12, count, mode: '2v2' })!;

const playAll = (t: Tournament) => {
  for (let i = 0; i < 500; i++) {
    const m = readyQueue(resolve(t))[0];
    if (!m) break;
    t = reducer(t, { type: 'setResult', id: m.id, result: { a: m.pa!, b: m.pb!, sa: 2, sb: 1, winner: m.pa, method: 'normal', at: 1 } })!;
  }
  return t;
};

describe('2 contre 2', () => {
  it('les duos se forment dans l’ordre de la liste : 1+2, 3+4…', () => {
    const t = make(6);
    expect(t.duos).toHaveLength(3);
    const names = participants(t).map((p) => p.name);
    expect(names).toEqual(['Joueur 1 & Joueur 2', 'Joueur 3 & Joueur 4', 'Joueur 5 & Joueur 6']);
  });

  it('nombre impair : le dernier joueur attend un partenaire, le tirage est bloqué', () => {
    let t = make(6);
    t = reducer(t, { type: 'addPlayer', name: 'Yanis' })!;
    expect(t.duos).toHaveLength(3);
    expect(formatError('single', 7, '2v2')).toContain('pair');
    expect(formatError('single', 4, '2v2')).toContain('3 duos');
    expect(formatError('single', 6, '2v2')).toBeNull();
    expect(formatError('groups', 10, '2v2')).toContain('6 duos');
    expect(formatError('groups', 12, '2v2')).toBeNull();
  });

  it('échanger deux joueurs recompose les duos ; mélanger aussi', () => {
    let t = make(4 * 2);
    const [p1, , p3] = t.players;
    t = reducer(t, { type: 'swapPlayers', a: t.players[1].id, b: p3.id })!;
    expect(t.duos![0].id).toBe(duoId(p1.id, p3.id));
    const before = t.duos!.map((d) => d.id).join();
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) {
      t = reducer(t, { type: 'shuffleDuos' })!;
      changed = t.duos!.map((d) => d.id).join() !== before;
    }
    expect(changed).toBe(true);
  });

  it('le club appartient au duo et suit le duo', () => {
    let t = make(6);
    const d0 = t.duos![0];
    t = reducer(t, { type: 'setTeam', id: d0.id, team: { name: 'PSG' } })!;
    expect(participants(t)[0].team).toEqual({ name: 'PSG' });
    // Échanger les deux membres du même duo : même duo, même club.
    t = reducer(t, { type: 'swapPlayers', a: d0.a, b: d0.b })!;
    expect(t.duos![0]).toMatchObject({ id: d0.id, team: { name: 'PSG' } });
    // Casser le duo : le club disparaît.
    t = reducer(t, { type: 'swapPlayers', a: d0.b, b: t.players[2].id })!;
    expect(t.duos![0].team).toBeUndefined();
  });

  for (const format of ['single', 'double', 'league'] as Format[]) {
    for (const people of [6, 8, 10, 16, 32]) {
      it(`${format}, ${people} joueurs (${people / 2} duos) : tournoi complet, champion = un duo`, () => {
        let t = reducer(make(people, format), { type: 'draw' })!;
        expect(t.seeds.sort()).toEqual(t.duos!.map((d) => d.id).sort());
        t = playAll(t);
        const res = resolve(t);
        expect(t.duos!.map((d) => d.id)).toContain(res.champion);
        expect(ranking(t, res)).toHaveLength(people / 2);
      });
    }
  }

  it('groupes en 2v2 (12 joueurs = 6 duos)', () => {
    let t = reducer(make(12, 'groups'), { type: 'draw' })!;
    t = playAll(t);
    expect(resolve(t).champion).toMatch(/^d_/);
  });

  it('pendant le tournoi, impossible de recomposer les duos', () => {
    const t = reducer(make(6), { type: 'draw' })!;
    expect(reducer(t, { type: 'shuffleDuos' })).toBe(t);
    expect(reducer(t, { type: 'swapPlayers', a: t.players[0].id, b: t.players[2].id })).toBe(t);
  });

  it('passer de 1v1 à 2v2 en cours de tournoi relance le tirage', () => {
    let t = reducer(reducer(null, { type: 'create', name: 'T', game: 'FC', format: 'single', matchMinutes: 12, count: 8 }), { type: 'draw' })!;
    expect(t.duos).toBeUndefined();
    t = reducer(t, { type: 'update', patch: { mode: '2v2' } })!;
    expect(t.status).toBe('setup');
    expect(t.duos).toHaveLength(4);
    t = reducer(t, { type: 'update', patch: { mode: '1v1' } })!;
    expect(t.duos).toBeUndefined();
  });

  it('serveur : un participant peut choisir le club d’un duo, pas recomposer les duos', async () => {
    const t = reducer(make(6), { type: 'draw' })!;
    const withClub = reducer(t, { type: 'setTeam', id: t.duos![0].id, team: { name: 'OM' } })!;
    expect(playerMayChange(t, withClub)).toBe(true);
    const recomposed = { ...t, duos: [{ ...t.duos![0], b: t.duos![1].a }, ...t.duos!.slice(1)] };
    expect(playerMayChange(t, recomposed)).toBe(false);
    setStore(memoryStore());
    const created = await handle(new Request('http://x/api/tournament', { method: 'POST', body: JSON.stringify({ t }) }));
    const { id } = await created.json();
    const put = await handle(new Request(`http://x/api/tournament?id=${id}`, { method: 'PUT', body: JSON.stringify({ base: 1, t: withClub }) }));
    expect(put.status).toBe(200);
  });
});
