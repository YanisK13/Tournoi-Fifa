import { assignConsoles, buildDuos, isDuoMode, makeGroups, participants, pruneResults, shuffle } from './engine';
import type { Format, MatchResult, Mode, Player, Team, Tournament } from './types';
import { MAX_CONSOLES, MAX_PLAYERS } from './types';

export const uid = () => Math.random().toString(36).slice(2, 8);

export type Action =
  | { type: 'create'; name: string; game: string; format: Format; matchMinutes: number; count: number; consoles?: number; mode?: Mode }
  | { type: 'update'; patch: Partial<Pick<Tournament, 'name' | 'game' | 'format' | 'matchMinutes' | 'consoles' | 'mode'>> }
  | { type: 'swapPlayers'; a: string; b: string }
  | { type: 'shuffleDuos' }
  | { type: 'addPlayer'; name: string }
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'setTeam'; id: string; team: Team | null }
  | { type: 'removePlayer'; id: string }
  | { type: 'draw' }
  | { type: 'setResult'; id: string; result: MatchResult }
  | { type: 'clearResult'; id: string }
  | { type: 'restart' }
  | { type: 'reset' }
  | { type: 'import'; t: Tournament };

function backToSetup(t: Tournament): Tournament {
  return { ...t, status: 'setup', seeds: [], groups: [], results: {}, live: {} };
}

const clampConsoles = (n: unknown) => Math.min(MAX_CONSOLES, Math.max(1, Math.floor(Number(n) || 1)));

/** Applique l'action puis met à jour la répartition des matchs sur les consoles. */
export function reducer(t: Tournament | null, a: Action): Tournament | null {
  let next = baseReducer(t, a);
  if (!next || next === t) return next;
  // 2v2 : les duos suivent toujours l'ordre des joueurs.
  if (isDuoMode(next)) {
    const duos = buildDuos(next.players, next.duos);
    if (JSON.stringify(duos) !== JSON.stringify(next.duos)) next = { ...next, duos };
  } else if (next.duos) {
    const { duos: _drop, ...rest } = next; // eslint-disable-line @typescript-eslint/no-unused-vars
    next = rest;
  }
  if (next.status !== 'running') return next.live && Object.keys(next.live).length ? { ...next, live: {} } : next;
  return { ...next, live: assignConsoles(next) };
}

function baseReducer(t: Tournament | null, a: Action): Tournament | null {
  if (a.type === 'create') {
    const players: Player[] = Array.from({ length: a.count }, (_, i) => ({ id: uid(), name: `Joueur ${i + 1}` }));
    return {
      id: uid(), name: a.name, game: a.game, format: a.format, matchMinutes: a.matchMinutes, consoles: clampConsoles(a.consoles),
      ...(a.mode === '2v2' ? { mode: '2v2' as const } : {}),
      players, status: 'setup', seeds: [], groups: [], results: {}, createdAt: Date.now(),
    };
  }
  if (a.type === 'import') return a.t;
  if (a.type === 'reset') return null;
  if (!t) return t;

  switch (a.type) {
    case 'update': {
      const patch = a.patch.consoles !== undefined ? { ...a.patch, consoles: clampConsoles(a.patch.consoles) } : a.patch;
      // Changer de format ou de mode (1v1 / 2v2) en cours de tournoi impose un nouveau tirage.
      const modeChanged = patch.mode !== undefined && (patch.mode ?? '1v1') !== (t.mode ?? '1v1');
      if (((patch.format && patch.format !== t.format) || modeChanged) && t.status === 'running') return backToSetup({ ...t, ...patch });
      return { ...t, ...patch };
    }
    case 'addPlayer':
      if (t.players.length >= MAX_PLAYERS || t.status !== 'setup') return t;
      return { ...t, players: [...t.players, { id: uid(), name: a.name }] };
    case 'setTeam': {
      const team = cleanTeam(a.team);
      if (isDuoMode(t)) {
        return { ...t, duos: (t.duos ?? []).map((d) => (d.id === a.id ? { id: d.id, a: d.a, b: d.b, ...(team ? { team } : {}) } : d)) };
      }
      return { ...t, players: t.players.map((p) => (p.id === a.id ? { id: p.id, name: p.name, ...(team ? { team } : {}) } : p)) };
    }
    case 'swapPlayers': {
      // Composer les duos à la main : échange la place de deux joueurs (avant le tirage seulement).
      if (t.status !== 'setup') return t;
      const i = t.players.findIndex((p) => p.id === a.a);
      const j = t.players.findIndex((p) => p.id === a.b);
      if (i < 0 || j < 0 || i === j) return t;
      const players = [...t.players];
      [players[i], players[j]] = [players[j], players[i]];
      return { ...t, players };
    }
    case 'shuffleDuos':
      if (t.status !== 'setup') return t;
      return { ...t, players: shuffle(t.players, secureRandom) };
    case 'renamePlayer':
      return { ...t, players: t.players.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)) };
    case 'removePlayer': {
      const next = { ...t, players: t.players.filter((p) => p.id !== a.id) };
      return t.status === 'running' ? backToSetup(next) : next;
    }
    case 'draw': {
      const seeds = shuffle(participants(t).map((p) => p.id), secureRandom);
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

/** N'accepte qu'un nom raisonnable et un logo en https. */
export function cleanTeam(team: Team | null): Team | null {
  if (!team) return null;
  const name = String(team.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const badge = typeof team.badge === 'string' && /^https:\/\/[^\s"'<>]+$/.test(team.badge) ? team.badge : undefined;
  return badge ? { name, badge } : { name };
}
