import { describe, expect, it } from 'vitest';
import {
  BYE, estimateMatches, impactOf, makeGroups, nextPow2, playable, pruneResults, ranking, readyQueue, resolve, roundName, roundRobin, seedOrder,
} from './engine';
import type { Format, MatchResult, Tournament } from './types';

function makeT(format: Format, n: number): Tournament {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Joueur ${i + 1}` }));
  const seeds = players.map((p) => p.id);
  return {
    id: 't', name: 'Test', game: 'FC', format, matchMinutes: 10, players, status: 'running', seeds,
    groups: format === 'groups' ? makeGroups(seeds) : [], results: {}, createdAt: 0,
  };
}

const res = (a: string, b: string, sa: number, sb: number, winner: string | null = sa > sb ? a : sb > sa ? b : null): MatchResult =>
  ({ a, b, sa, sb, winner, method: sa === sb && winner ? 'pens' : 'normal', at: Date.now() });

/** Joue tous les matchs disponibles jusqu'au bout avec une règle de vainqueur donnée. */
function playOut(t: Tournament, pick: (a: string, b: string) => string | null = (a) => a) {
  let cur = t;
  let played = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const r = resolve(cur);
    // Aucun match « fantôme » : un match à jouer oppose toujours deux vrais joueurs.
    for (const m of r.matches) {
      if (m.state === 'ready') {
        expect(m.pa).not.toBe(BYE);
        expect(m.pb).not.toBe(BYE);
        expect(m.pa).not.toBe(m.pb);
        expect(m.hidden).toBe(false);
      }
    }
    const next = readyQueue(r)[0];
    if (!next) return { t: cur, r, played };
    const w = pick(next.pa!, next.pb!);
    const result = w === null ? res(next.pa!, next.pb!, 1, 1, null) : w === next.pa ? res(next.pa!, next.pb!, 2, 1) : res(next.pa!, next.pb!, 0, 3);
    cur = { ...cur, results: { ...cur.results, [next.id]: result } };
    played++;
  }
  throw new Error('boucle infinie');
}

describe('outils', () => {
  it('nextPow2 et seedOrder', () => {
    expect(nextPow2(5)).toBe(8);
    expect(nextPow2(8)).toBe(8);
    expect(seedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });
  it('roundRobin : chaque paire une seule fois', () => {
    for (const n of [3, 4, 5, 8]) {
      const ids = Array.from({ length: n }, (_, i) => i);
      const pairs = roundRobin(ids).flat().map(([a, b]) => [a, b].sort().join('-'));
      expect(new Set(pairs).size).toBe((n * (n - 1)) / 2);
      expect(pairs.length).toBe((n * (n - 1)) / 2);
    }
  });
});

describe('élimination directe', () => {
  for (let n = 4; n <= 32; n++) {
    it(`${n} joueurs : n-1 matchs, un champion, pas de match fantôme`, () => {
      const { r, played } = playOut(makeT('single', n));
      expect(played).toBe(n - 1);
      expect(estimateMatches('single', n)).toBe(n - 1);
      expect(r.champion).toBe('p0');
      // Aucun match visible impliquant une exemption.
      expect(playable(r).every((m) => m.pa !== BYE && m.pb !== BYE)).toBe(true);
    });
  }

  it('6 joueurs : les têtes de série 1 et 2 sont exemptées, 2 matchs au 1er tour', () => {
    const r = resolve(makeT('single', 6));
    const r1 = playable(r).filter((m) => m.round === 1);
    expect(r1).toHaveLength(2);
    const r2 = r.matches.filter((m) => m.round === 2);
    expect(r2.map((m) => [m.pa, m.pb].includes('p0') || [m.pa, m.pb].includes('p1'))).toEqual([true, true]);
    expect(roundName(r2[0], r, 'single')).toBe('Demi-finales');
  });

  it('le vainqueur avance automatiquement au tour suivant', () => {
    const t = makeT('single', 4);
    const r0 = resolve(t);
    const first = readyQueue(r0)[0];
    const t1 = { ...t, results: { [first.id]: res(first.pa!, first.pb!, 0, 2) } };
    const final = resolve(t1).byId.get('W2-0')!;
    expect([final.pa, final.pb]).toContain(first.pb);
  });

  it('match nul impossible sans vainqueur désigné', () => {
    const t = makeT('single', 4);
    const m = readyQueue(resolve(t))[0];
    const bad = { ...t, results: { [m.id]: res(m.pa!, m.pb!, 1, 1, null) } };
    expect(resolve(bad).byId.get(m.id)!.state).toBe('ready');
    const good = { ...t, results: { [m.id]: res(m.pa!, m.pb!, 1, 1, m.pb) } };
    expect(resolve(good).byId.get(m.id)!.winner).toBe(m.pb);
  });

  it('un score incohérent avec le vainqueur est refusé', () => {
    const t = makeT('single', 4);
    const m = readyQueue(resolve(t))[0];
    const bad = { ...t, results: { [m.id]: res(m.pa!, m.pb!, 3, 0, m.pb) } };
    expect(resolve(bad).byId.get(m.id)!.state).toBe('ready');
  });

  it('changer un résultat en amont annule les matchs suivants concernés', () => {
    const { t } = playOut(makeT('single', 8));
    const first = resolve(t).byId.get('W1-0')!;
    const flipped = res(first.pa!, first.pb!, 0, 1);
    // Le vainqueur change : son quart, sa demie et la finale sont annulés.
    expect(impactOf(t, 'W1-0', flipped)).toBe(2);
    const after = pruneResults({ ...t, results: { ...t.results, 'W1-0': flipped } });
    const r = resolve(after);
    expect(r.champion).toBeNull();
    expect(r.byId.get('W2-0')!.state).toBe('ready');
    expect([r.byId.get('W2-0')!.pa, r.byId.get('W2-0')!.pb]).toContain(first.pb);
    // Même vainqueur avec un autre score : rien n'est annulé.
    expect(impactOf(t, 'W1-0', res(first.pa!, first.pb!, 5, 0))).toBe(0);
  });

  it('classement : champion, finaliste puis éliminés par tour', () => {
    const { t, r } = playOut(makeT('single', 8));
    const rows = ranking(t, r);
    expect(rows[0]).toMatchObject({ id: 'p0', label: 'Champion', rank: 1 });
    expect(rows[1].label).toBe('Finaliste');
    expect(rows.slice(2, 4).every((x) => x.rank === 3 && x.label.includes('Demi'))).toBe(true);
    expect(rows.slice(4).every((x) => x.rank === 5)).toBe(true);
  });
});

describe('double élimination', () => {
  for (let n = 4; n <= 32; n++) {
    it(`${n} joueurs : se termine, aucun match fantôme`, () => {
      const { r, played } = playOut(makeT('double', n));
      expect(r.champion).toBe('p0');
      // Le champion invaincu : 2n-2 matchs, pas de revanche.
      expect(played).toBe(2 * n - 2);
      expect(r.byId.get('GF2')!.state).toBe('void');
    });
  }

  it('chaque joueur sauf le champion perd exactement deux fois (ou une si invaincu jusque-là)', () => {
    const { r } = playOut(makeT('double', 11), (a, b) => (a < b ? a : b));
    const losses = new Map<string, number>();
    for (const m of r.matches) if (m.state === 'done' && m.loser) losses.set(m.loser, (losses.get(m.loser) ?? 0) + 1);
    for (const [id, l] of losses) if (id !== r.champion) expect(l).toBe(2);
    expect(losses.get(r.champion!) ?? 0).toBe(0);
  });

  it('revanche de grande finale si le vainqueur du repêchage gagne', () => {
    let t = makeT('double', 4);
    // Le vainqueur du tableau principal perd la grande finale.
    let guard = 0;
    while (guard++ < 50) {
      const r = resolve(t);
      const m = readyQueue(r)[0];
      if (!m) break;
      const winner = m.id === 'GF1' ? m.pb! : m.pa!;
      t = { ...t, results: { ...t.results, [m.id]: res(m.pa!, m.pb!, winner === m.pa ? 1 : 0, winner === m.pb ? 1 : 0) } };
    }
    const r = resolve(t);
    expect(r.byId.get('GF2')!.state).toBe('done');
    expect(r.champion).toBe(r.byId.get('GF2')!.winner);
    const rows = ranking(t, r);
    expect(rows[0].label).toBe('Champion');
    expect(rows[1].label).toBe('Finaliste');
  });
});

describe('championnat', () => {
  it('toutes rondes, nuls autorisés, champion = 1er du classement', () => {
    const t = makeT('league', 5);
    const { r, played, t: done } = playOut(t, (a, b) => (a === 'p2' || b === 'p2' ? 'p2' : null));
    expect(played).toBe(10);
    expect(r.champion).toBe('p2');
    const rows = ranking(done, r);
    expect(rows[0].st).toMatchObject({ id: 'p2', w: 4, pts: 12 });
    expect(rows[1].st.d).toBe(3);
  });
  it('pas de champion tant que tout n\'est pas joué', () => {
    const r = resolve(makeT('league', 4));
    expect(r.champion).toBeNull();
    expect(readyQueue(r)).toHaveLength(6);
  });
});

describe('groupes + phase finale', () => {
  for (const n of [6, 7, 8, 9, 10, 12, 13, 16, 20, 24, 32]) {
    it(`${n} joueurs : groupes puis tableau final`, () => {
      const t = makeT('groups', n);
      const r0 = resolve(t);
      // Aucun match à élimination prêt avant la fin des groupes.
      expect(readyQueue(r0).every((m) => m.stage === 'group')).toBe(true);
      const { r } = playOut(t, (a, b) => (Number(a.slice(1)) < Number(b.slice(1)) ? a : b));
      expect(r.groupComplete.every(Boolean)).toBe(true);
      expect(r.champion).toBe('p0');
    });
  }

  it('deux joueurs du même groupe ne se croisent pas au premier tour du tableau (4 groupes)', () => {
    const { r } = playOut(makeT('groups', 16));
    const groupOf = new Map<string, number>();
    r.groupTables.forEach((tab, g) => tab.forEach((s) => groupOf.set(s.id, g)));
    for (const m of r.matches.filter((x) => x.stage === 'W' && x.round === 1 && !x.hidden)) {
      expect(groupOf.get(m.pa!)).not.toBe(groupOf.get(m.pb!));
    }
  });

  it('changer un score de groupe après coup recalcule les qualifiés', () => {
    const { t } = playOut(makeT('groups', 8), (a, b) => (Number(a.slice(1)) < Number(b.slice(1)) ? a : b));
    const r = resolve(t);
    const gm = r.matches.find((m) => m.stage === 'group' && m.result)!;
    const flipped = res(gm.pa!, gm.pb!, gm.result!.sb, gm.result!.sa);
    const after = pruneResults({ ...t, results: { ...t.results, [gm.id]: flipped } });
    // Les résultats de groupe restent, la cohérence du tableau est garantie.
    const r2 = resolve(after);
    expect(r2.matches.filter((m) => m.stage === 'group').every((m) => m.state === 'done')).toBe(true);
    for (const id of Object.keys(after.results)) expect(r2.byId.get(id)!.state).toBe('done');
  });
});

describe('robustesse', () => {
  it('résoudre un tournoi sans tirage ne plante dans aucun format', () => {
    for (const format of ['single', 'double', 'league', 'groups'] as Format[]) {
      for (const n of [0, 1, 2, 3]) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        expect(() => resolve({ format, seeds: ids, groups: [], results: {} })).not.toThrow();
      }
    }
  });
});
