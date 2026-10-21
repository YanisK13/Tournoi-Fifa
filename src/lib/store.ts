import { makeGroups, pruneResults, shuffle } from './engine';
import type { Format, MatchResult, Player, Tournament } from './types';
import { MAX_PLAYERS } from './types';

export const uid = () => Math.random().toString(36).slice(2, 8);

export type Action =
  | { type: 'create'; name: string; game: string; format: Format; matchMinutes: number; count: number }
  | { type: 'update'; patch: Partial<Pick<Tournament, 'name' | 'game' | 'format' | 'matchMinutes'>> }
  | { type: 'addPlayer'; name: string }
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'draw' }
  | { type: 'setResult'; id: string; result: MatchResult }
  | { type: 'clearResult'; id: string }
  | { type: 'restart' }
  | { type: 'reset' }
  | { type: 'import'; t: Tournament };

function backToSetup(t: Tournament): Tournament {
  return { ...t, status: 'setup', seeds: [], groups: [], results: {} };
}

export function reducer(t: Tournament | null, a: Action): Tournament | null {
  if (a.type === 'create') {
    const players: Player[] = Array.from({ length: a.count }, (_, i) => ({ id: uid(), name: `Joueur ${i + 1}` }));
    return {
      id: uid(), name: a.name, game: a.game, format: a.format, matchMinutes: a.matchMinutes,
      players, status: 'setup', seeds: [], groups: [], results: {}, createdAt: Date.now(),
    };
  }
  if (a.type === 'import') return a.t;
  if (a.type === 'reset') return null;
  if (!t) return t;

  switch (a.type) {
    case 'update':
      // Changer de format en cours de tournoi impose un nouveau tirage.
      if (a.patch.format && a.patch.format !== t.format && t.status === 'running') return backToSetup({ ...t, ...a.patch });
      return { ...t, ...a.patch };
    case 'addPlayer':
      if (t.players.length >= MAX_PLAYERS || t.status !== 'setup') return t;
      return { ...t, players: [...t.players, { id: uid(), name: a.name }] };
    case 'renamePlayer':
      return { ...t, players: t.players.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)) };
    case 'removePlayer': {
      const next = { ...t, players: t.players.filter((p) => p.id !== a.id) };
      return t.status === 'running' ? backToSetup(next) : next;
    }
    case 'draw': {
      const seeds = shuffle(t.players.map((p) => p.id), secureRandom);
      return { ...t, status: 'running', seeds, groups: t.format === 'groups' ? makeGroups(seeds) : [], results: {} };
    }
    case 'setResult':
      return pruneResults({ ...t, results: { ...t.results, [a.id]: a.result } });
    case 'clearResult': {
      const results = { ...t.results };
      delete results[a.id];
      return pruneResults({ ...t, results });
    }
    case 'restart':
      return backToSetup(t);
  }
}

function secureRandom(): number {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  } catch {
    return Math.random();
  }
}

export function isTournament(x: unknown): x is Tournament {
  const t = x as Tournament;
  return !!t && typeof t === 'object' && typeof t.name === 'string' && Array.isArray(t.players)
    && ['single', 'double', 'league', 'groups'].includes(t.format) && typeof t.results === 'object'
    && Array.isArray(t.seeds) && Array.isArray(t.groups);
}
