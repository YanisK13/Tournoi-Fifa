import { describe, expect, it } from 'vitest';
import { assignConsoles, estimateMatches, estimateSlots, readyQueue, resolve } from './engine';
import { reducer } from './store';
import type { Format, MatchResult, Tournament } from './types';

const make = (format: Format, count: number, consoles: number) =>
  reducer(reducer(null, { type: 'create', name: 'T', game: 'FC', format, matchMinutes: 12, count, consoles }), { type: 'draw' })!;

const win = (t: Tournament, id: string): MatchResult => {
  const m = resolve(t).byId.get(id)!;
  return { a: m.pa!, b: m.pb!, sa: 1, sb: 0, winner: m.pa, method: 'normal', at: 1 };
};

const playersOnConsoles = (t: Tournament) => {
  const res = resolve(t);
  return Object.keys(t.live ?? {}).flatMap((id) => [res.byId.get(id)!.pa!, res.byId.get(id)!.pb!]);
};

describe('consoles', () => {
  it('1 console : un seul match en cours, le premier de la file', () => {
    const t = make('single', 8, 1);
    expect(Object.values(t.live!)).toEqual([1]);
    expect(Object.keys(t.live!)[0]).toBe(readyQueue(resolve(t))[0].id);
  });

  it('2 consoles : deux matchs en parallèle, jamais le même joueur deux fois', () => {
    const t = make('single', 8, 2);
    expect(Object.values(t.live!).sort()).toEqual([1, 2]);
    const ps = playersOnConsoles(t);
    expect(new Set(ps).size).toBe(ps.length);
  });

  it('un match reste sur sa console ; la console libérée prend le match suivant', () => {
    let t = make('single', 8, 2);
    const [[onC1], [onC2]] = [1, 2].map((c) => Object.entries(t.live!).filter(([, k]) => k === c).map(([id]) => id));
    t = reducer(t, { type: 'setResult', id: onC2, result: win(t, onC2) })!;
    expect(t.live![onC1]).toBe(1);
    const newOnC2 = Object.entries(t.live!).find(([, k]) => k === 2)![0];
    expect(newOnC2).not.toBe(onC2);
    expect(resolve(t).byId.get(newOnC2)!.state).toBe('ready');
  });

  it('championnat : un joueur n’est jamais sur deux consoles à la fois', () => {
    let t = make('league', 6, 3);
    for (let i = 0; i < 15; i++) {
      const ps = playersOnConsoles(t);
      expect(new Set(ps).size).toBe(ps.length);
      const id = Object.keys(t.live!)[0];
      if (!id) break;
      t = reducer(t, { type: 'setResult', id, result: win(t, id) })!;
    }
    expect(resolve(t).champion).not.toBeNull();
    expect(t.live).toEqual({});
  });

  it('plus de consoles que de matchs possibles : les consoles en trop restent libres', () => {
    const t = make('single', 4, 4);
    expect(Object.keys(t.live!)).toHaveLength(2);
  });

  it('changer le nombre de consoles en cours de tournoi garde les scores', () => {
    let t = make('single', 8, 1);
    const first = Object.keys(t.live!)[0];
    t = reducer(t, { type: 'setResult', id: first, result: win(t, first) })!;
    t = reducer(t, { type: 'update', patch: { consoles: 3 } })!;
    expect(Object.keys(t.results)).toEqual([first]);
    expect(Object.keys(t.live!)).toHaveLength(3);
    t = reducer(t, { type: 'update', patch: { consoles: 1 } })!;
    expect(Object.keys(t.live!)).toHaveLength(1);
  });

  it('nombre de consoles borné', () => {
    expect(make('single', 8, 0).consoles).toBe(1);
    expect(make('single', 8, 50).consoles).toBe(8);
  });

  it('la répartition est la même sur tous les téléphones', () => {
    const t = make('groups', 12, 3);
    expect(assignConsoles({ ...t, live: {} })).toEqual(assignConsoles({ ...t, live: {} }));
  });

  it('estimation : 1 console = un match par créneau ; plus de consoles = moins de temps', () => {
    for (const f of ['single', 'double', 'league', 'groups'] as Format[]) {
      expect(estimateSlots(f, 8, 1)).toBe(estimateMatches(f, 8));
      expect(estimateSlots(f, 8, 2)).toBeLessThan(estimateSlots(f, 8, 1));
    }
    // 8 joueurs, élimination directe, 2 consoles : quarts (2 créneaux), demies (1), finale (1).
    expect(estimateSlots('single', 8, 2)).toBe(4);
    expect(estimateSlots('single', 8, 4)).toBe(3);
  });
});
