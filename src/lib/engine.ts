import type { Format, MatchDef, MatchResult, Source, Tournament } from './types';
import { MIN_PLAYERS, MIN_PLAYERS_GROUPS, MAX_PLAYERS } from './types';

export const BYE = '__bye__';

/** player id, BYE, ou null (pas encore connu). */
export type Slot = string | null;
export type MatchState = 'pending' | 'ready' | 'done' | 'bye' | 'void';

export interface RMatch extends MatchDef {
  pa: Slot;
  pb: Slot;
  state: MatchState;
  result?: MatchResult;
  winner: Slot;
  loser: Slot;
  /** Match d'exemption ou revanche inutile : jamais affiché comme un match à jouer. */
  hidden: boolean;
}

export interface Standing {
  id: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

export interface Resolved {
  matches: RMatch[];
  byId: Map<string, RMatch>;
  groupTables: Standing[][];
  groupComplete: boolean[];
  champion: string | null;
  /** Nombre de tours du tableau principal / repêchage (pour nommer les tours). */
  wRounds: number;
  lRounds: number;
}

/* ---------------------------------------------------------------- helpers */

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Placement standard des têtes de série : 1 contre N, 2 contre N-1… et 1/2 dans des moitiés opposées. */
export function seedOrder(size: number): number[] {
  let order = [0];
  while (order.length < size) {
    const m = order.length * 2;
    order = order.flatMap((x) => [x, m - 1 - x]);
  }
  return order;
}

/** Méthode du cercle : chaque joueur rencontre tous les autres une fois. */
export function roundRobin<T>(ids: T[]): [T, T][][] {
  const arr: (T | null)[] = [...ids];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds: [T, T][][] = [];
  let cur = arr;
  for (let r = 0; r < n - 1; r++) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = cur[i];
      const b = cur[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    cur = [cur[0], cur[n - 1], ...cur.slice(1, n - 1)];
  }
  return rounds;
}

export function groupCount(n: number): number {
  return Math.max(2, Math.min(8, Math.floor(n / 4)));
}

export const GROUP_LETTERS = 'ABCDEFGH';

/* ---------------------------------------------------------- structure */

const W = (r: number, i: number) => `W${r}-${i}`;
const L = (r: number, i: number) => `L${r}-${i}`;
const win = (match: string): Source => ({ kind: 'winner', match });
const lose = (match: string): Source => ({ kind: 'loser', match });

function knockout(slots: Source[], double: boolean, baseKey: number): MatchDef[] {
  const n = slots.length;
  // La double élimination a besoin d'au moins 4 places (sinon pas de repêchage).
  const N = nextPow2(Math.max(double ? 4 : 2, n));
  const k = Math.log2(N);
  const order = seedOrder(N);
  const slot = (i: number): Source => (i < n ? slots[i] : { kind: 'bye' });
  const defs: MatchDef[] = [];

  for (let r = 1; r <= k; r++) {
    const cnt = N >> r;
    for (let i = 0; i < cnt; i++) {
      defs.push({
        id: W(r, i),
        stage: 'W',
        round: r,
        order: i,
        a: r === 1 ? slot(order[2 * i]) : win(W(r - 1, 2 * i)),
        b: r === 1 ? slot(order[2 * i + 1]) : win(W(r - 1, 2 * i + 1)),
        knockout: true,
        key: baseKey + (double ? 2 * r - 2 : r),
      });
    }
  }
  if (!double) return defs;

  const lKey = (m: number) => baseKey + m + (m % 2 === 0 ? 0.5 : 0);
  const lb = (m: number, i: number, a: Source, b: Source): MatchDef => ({
    id: L(m, i), stage: 'L', round: m, order: i, a, b, knockout: true, key: lKey(m),
  });
  // Repêchage tour 1 : les perdants du 1er tour s'affrontent.
  for (let i = 0; i < N / 4; i++) defs.push(lb(1, i, lose(W(1, 2 * i)), lose(W(1, 2 * i + 1))));
  for (let j = 1; j <= k - 1; j++) {
    const cnt = N >> (j + 1);
    // Tours pairs : survivants du repêchage contre perdants du tableau principal (ordre inversé pour éviter les revanches immédiates).
    for (let i = 0; i < cnt; i++) {
      const idx = j % 2 === 1 ? cnt - 1 - i : i;
      defs.push(lb(2 * j, i, win(L(2 * j - 1, i)), lose(W(j + 1, idx))));
    }
    if (j < k - 1) {
      for (let i = 0; i < cnt / 2; i++) {
        defs.push(lb(2 * j + 1, i, win(L(2 * j, 2 * i)), win(L(2 * j, 2 * i + 1))));
      }
    }
  }
  const lbFinal = L(2 * (k - 1), 0);
  defs.push({ id: 'GF1', stage: 'GF', round: 1, order: 0, a: win(W(k, 0)), b: win(lbFinal), knockout: true, key: baseKey + 1000 });
  defs.push({ id: 'GF2', stage: 'GF', round: 2, order: 0, a: win('GF1'), b: lose('GF1'), knockout: true, key: baseKey + 1001, reset: true });
  return defs;
}

function leagueDefs(ids: string[]): MatchDef[] {
  return roundRobin(ids).flatMap((pairs, r) =>
    pairs.map(([a, b], i): MatchDef => ({
      id: `R${r + 1}-${i}`, stage: 'league', round: r + 1, order: i,
      a: { kind: 'player', id: a }, b: { kind: 'player', id: b }, knockout: false, key: r + 1,
    })),
  );
}

function groupsDefs(groups: string[][]): MatchDef[] {
  const defs: MatchDef[] = [];
  groups.forEach((ids, g) => {
    roundRobin(ids).forEach((pairs, r) =>
      pairs.forEach(([a, b], i) =>
        defs.push({
          id: `G${g}-${r + 1}-${i}`, stage: 'group', group: g, round: r + 1, order: i,
          a: { kind: 'player', id: a }, b: { kind: 'player', id: b }, knockout: false, key: r + 1 + g / 100,
        }),
      ),
    );
  });
  const G = groups.length;
  // Têtes de série : premiers de groupe d'abord, puis deuxièmes placés pour éviter un duel entre membres du même groupe.
  const slots: Source[] = [];
  for (let i = 0; i < G; i++) slots.push({ kind: 'group', group: i, rank: 0 });
  for (let r = 0; r < G; r++) slots.push({ kind: 'group', group: (G - r) % G, rank: 1 });
  return defs.concat(knockout(slots, false, 100));
}

export function buildDefs(t: Pick<Tournament, 'format' | 'seeds' | 'groups'>): MatchDef[] {
  const players = (ids: string[]): Source[] => ids.map((id) => ({ kind: 'player', id }));
  switch (t.format) {
    case 'single': return knockout(players(t.seeds), false, 0);
    case 'double': return knockout(players(t.seeds), true, 0);
    case 'league': return leagueDefs(t.seeds);
    case 'groups': return groupsDefs(t.groups);
  }
}

/* ---------------------------------------------------------- résolution */

export function standings(ids: string[], matches: RMatch[]): Standing[] {
  const map = new Map<string, Standing>();
  ids.forEach((id) => map.set(id, { id, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
  for (const m of matches) {
    if (m.state !== 'done' || !m.result) continue;
    const A = map.get(m.result.a);
    const B = map.get(m.result.b);
    if (!A || !B) continue;
    const { sa, sb, winner } = m.result;
    A.played++; B.played++;
    A.gf += sa; A.ga += sb; B.gf += sb; B.ga += sa;
    if (winner === null) { A.d++; B.d++; A.pts++; B.pts++; }
    else if (winner === A.id) { A.w++; B.l++; A.pts += 3; }
    else { B.w++; A.l++; B.pts += 3; }
  }
  const idx = new Map(ids.map((id, i) => [id, i]));
  return [...map.values()]
    .map((s) => ({ ...s, gd: s.gf - s.ga }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.w - x.w || idx.get(x.id)! - idx.get(y.id)!);
}

export function resolve(t: Pick<Tournament, 'format' | 'seeds' | 'groups' | 'results'>): Resolved {
  const defs = buildDefs(t);
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const memo = new Map<string, RMatch>();
  let groupTables: Standing[][] = [];
  let groupComplete: boolean[] = [];

  const slotOf = (s: Source): Slot => {
    switch (s.kind) {
      case 'player': return s.id;
      case 'bye': return BYE;
      case 'winner':
      case 'loser': {
        const m = get(s.match);
        if (m.state === 'void') return BYE;
        if (m.state === 'done' || m.state === 'bye') return s.kind === 'winner' ? m.winner : m.loser;
        return null;
      }
      case 'group':
        if (!groupComplete[s.group]) return null;
        return groupTables[s.group]?.[s.rank]?.id ?? BYE;
    }
  };

  const compute = (d: MatchDef): RMatch => {
    const base = { ...d, winner: null, loser: null } as RMatch;
    let pa: Slot;
    let pb: Slot;
    if (d.reset && d.a.kind === 'winner') {
      const gf = get(d.a.match);
      if (gf.state !== 'done') return { ...base, pa: null, pb: null, state: 'pending', hidden: true };
      // Le vainqueur du tableau principal gagne la grande finale : pas de revanche.
      if (gf.winner === gf.pa) return { ...base, pa: null, pb: null, state: 'void', hidden: true };
      pa = gf.winner; pb = gf.loser;
    } else {
      pa = slotOf(d.a); pb = slotOf(d.b);
    }
    const hidden = pa === BYE || pb === BYE;
    if (pa === BYE && pb === BYE) return { ...base, pa, pb, hidden, state: 'bye', winner: BYE, loser: BYE };
    if (pa === BYE && pb !== null) return { ...base, pa, pb, hidden, state: 'bye', winner: pb, loser: BYE };
    if (pb === BYE && pa !== null) return { ...base, pa, pb, hidden, state: 'bye', winner: pa, loser: BYE };
    if (pa === null || pb === null) return { ...base, pa, pb, hidden, state: 'pending' };
    const r = t.results[d.id];
    if (r && r.a === pa && r.b === pb && isValidResult(r, d.knockout)) {
      const loser = r.winner === null ? null : r.winner === pa ? pb : pa;
      return { ...base, pa, pb, hidden, state: 'done', result: r, winner: r.winner, loser };
    }
    return { ...base, pa, pb, hidden, state: 'ready' };
  };

  function get(id: string): RMatch {
    const hit = memo.get(id);
    if (hit) return hit;
    const m = compute(defMap.get(id)!);
    memo.set(id, m);
    return m;
  }

  if (t.format === 'groups') {
    const groupMatches = defs.filter((d) => d.stage === 'group').map((d) => get(d.id));
    groupTables = t.groups.map((ids, g) => standings(ids, groupMatches.filter((m) => m.group === g)));
    groupComplete = t.groups.map((_, g) => groupMatches.filter((m) => m.group === g).every((m) => m.state === 'done'));
  }

  const matches = defs.map((d) => get(d.id));
  const byId = new Map(matches.map((m) => [m.id, m]));
  const wRounds = Math.max(0, ...matches.filter((m) => m.stage === 'W').map((m) => m.round));
  const lRounds = Math.max(0, ...matches.filter((m) => m.stage === 'L').map((m) => m.round));

  let champion: string | null = null;
  if (t.format === 'league') {
    if (matches.length && matches.every((m) => m.state === 'done')) champion = standings(t.seeds, matches)[0]?.id ?? null;
  } else if (t.format === 'double') {
    const gf1 = byId.get('GF1');
    const gf2 = byId.get('GF2');
    if (gf2?.state === 'done') champion = gf2.winner;
    else if (gf1?.state === 'done' && gf2?.state === 'void') champion = gf1.winner;
  } else {
    const final = byId.get(W(wRounds, 0));
    if (final && (final.state === 'done' || final.state === 'bye') && final.winner !== BYE) champion = final.winner;
  }

  return { matches, byId, groupTables, groupComplete, champion, wRounds, lRounds };
}

export function isValidResult(r: MatchResult, knockout: boolean): boolean {
  if (!Number.isInteger(r.sa) || !Number.isInteger(r.sb) || r.sa < 0 || r.sb < 0) return false;
  if (r.sa > r.sb) return r.winner === r.a;
  if (r.sb > r.sa) return r.winner === r.b;
  return knockout ? r.winner === r.a || r.winner === r.b : r.winner === null || r.winner === r.a || r.winner === r.b;
}

/** Supprime les résultats devenus incohérents (ex. un vainqueur a changé en amont). */
export function pruneResults<T extends Pick<Tournament, 'format' | 'seeds' | 'groups' | 'results'>>(t: T): T {
  let cur = t;
  for (let guard = 0; guard < 100; guard++) {
    const res = resolve(cur);
    const stale = Object.keys(cur.results).filter((id) => res.byId.get(id)?.state !== 'done');
    if (!stale.length) return cur;
    const results = { ...cur.results };
    stale.forEach((id) => delete results[id]);
    cur = { ...cur, results };
  }
  return cur;
}

/** Nombre de résultats déjà saisis qui seraient annulés si on applique ce changement. */
export function impactOf(t: Tournament, matchId: string, next: MatchResult | null): number {
  const results = { ...t.results };
  if (next) results[matchId] = next;
  else delete results[matchId];
  const after = pruneResults({ ...t, results });
  return Object.keys(t.results).filter((id) => id !== matchId && !after.results[id]).length;
}

export function playable(res: Resolved): RMatch[] {
  return res.matches.filter((m) => !m.hidden && m.state !== 'void');
}

export function readyQueue(res: Resolved): RMatch[] {
  return res.matches
    .filter((m) => m.state === 'ready')
    .sort((x, y) => x.key - y.key || x.round - y.round || x.order - y.order);
}

/* ---------------------------------------------------------- tirage */

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeGroups(seeds: string[]): string[][] {
  const G = groupCount(seeds.length);
  const groups: string[][] = Array.from({ length: G }, () => []);
  seeds.forEach((id, i) => groups[i % G].push(id));
  return groups;
}

export function formatError(format: Format, n: number): string | null {
  if (n < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs.`;
  if (n > MAX_PLAYERS) return `${MAX_PLAYERS} joueurs maximum.`;
  if (format === 'groups' && n < MIN_PLAYERS_GROUPS) return `Le format groupes demande au moins ${MIN_PLAYERS_GROUPS} joueurs.`;
  return null;
}

/** Nombre de matchs réellement joués (sans exemptions), revanche éventuelle de double élimination exclue. */
export function estimateMatches(format: Format, n: number): number {
  if (n < 2) return 0;
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  const res = resolve({ format, seeds: ids, groups: format === 'groups' ? makeGroups(ids) : [], results: {} });
  return res.matches.filter((m) => !m.hidden && !m.reset).length;
}

/* ---------------------------------------------------------- libellés */

const PLURAL: Record<number, string> = { 2: 'Finale', 4: 'Demi-finales', 8: 'Quarts de finale', 16: 'Huitièmes de finale', 32: 'Seizièmes de finale' };
const SINGULAR: Record<number, string> = { 2: 'Finale', 4: 'Demi-finale', 8: 'Quart de finale', 16: 'Huitième de finale', 32: 'Seizième de finale' };

export function roundName(m: Pick<MatchDef, 'stage' | 'round' | 'group'>, res: Pick<Resolved, 'wRounds' | 'lRounds'>, format: Format): string {
  switch (m.stage) {
    case 'W': {
      const left = 2 ** (res.wRounds - m.round + 1);
      if (format === 'double') return left === 2 ? 'Finale principale' : PLURAL[left];
      return PLURAL[left] ?? `Tour ${m.round}`;
    }
    case 'L': return m.round === res.lRounds ? 'Finale du repêchage' : `Repêchage · tour ${m.round}`;
    case 'GF': return m.round === 1 ? 'Grande finale' : 'Grande finale · revanche';
    case 'league': return `Journée ${m.round}`;
    case 'group': return `Groupe ${GROUP_LETTERS[m.group ?? 0]} · J${m.round}`;
  }
}

export function matchTitle(m: RMatch, res: Resolved, format: Format): string {
  if (m.stage === 'W') {
    const left = 2 ** (res.wRounds - m.round + 1);
    if (left === 2) return format === 'double' ? 'Finale principale' : 'Finale';
    const visible = res.matches.filter((x) => x.stage === 'W' && x.round === m.round && !x.hidden);
    const idx = visible.findIndex((x) => x.id === m.id);
    return `${SINGULAR[left]}${visible.length > 1 && idx >= 0 ? ` ${idx + 1}` : ''}`;
  }
  return roundName(m, res, format);
}

/* ---------------------------------------------------------- classement */

export interface RankRow {
  id: string;
  rank: number;
  label: string;
  st: Standing;
  tone: 'gold' | 'silver' | 'alive' | 'out' | 'neutral';
}

export function ranking(t: Tournament, res: Resolved): RankRow[] {
  const ids = t.players.map((p) => p.id);
  const stats = new Map(standings(ids, res.matches).map((s) => [s.id, s]));

  if (t.format === 'league') {
    return standings(ids, res.matches).map((st, i) => ({
      id: st.id, rank: i + 1, st,
      label: res.champion === st.id ? 'Champion' : '',
      tone: res.champion === st.id ? 'gold' : 'neutral',
    }));
  }

  const ko = res.matches.filter((m) => m.knockout && !m.hidden && m.state !== 'void');
  // Le perdant d'un match est éliminé si sa défaite ne le renvoie nulle part (ou seulement vers une revanche annulée).
  const loserFeeds = new Map<string, RMatch[]>();
  for (const m of res.matches) {
    for (const s of [m.a, m.b]) if (s.kind === 'loser') loserFeeds.set(s.match, [...(loserFeeds.get(s.match) ?? []), m]);
  }
  const elimAt = new Map<string, RMatch>();
  for (const m of ko) {
    if (m.state !== 'done' || !m.loser || m.loser === BYE) continue;
    const feeds = loserFeeds.get(m.id) ?? [];
    if (feeds.every((f) => f.state === 'void')) elimAt.set(m.loser, m);
  }
  const lastKey = new Map<string, number>();
  for (const m of ko) for (const p of [m.pa, m.pb]) if (p && p !== BYE) lastKey.set(p, Math.max(lastKey.get(p) ?? -1, m.key));

  const groupRank = new Map<string, { g: number; r: number }>();
  res.groupTables.forEach((tab, g) => tab.forEach((s, r) => groupRank.set(s.id, { g, r })));

  type Row = { id: string; tier: number[]; label: string; tone: RankRow['tone'] };
  const rows: Row[] = ids.map((id) => {
    const out = elimAt.get(id);
    if (res.champion === id) return { id, tier: [0], label: 'Champion', tone: 'gold' };
    if (lastKey.has(id)) {
      if (!out) return { id, tier: [1, -lastKey.get(id)!], label: 'En lice', tone: 'alive' };
      const finalist = res.champion !== null && (out.id === 'GF1' || out.id === 'GF2' || (out.stage === 'W' && out.round === res.wRounds && t.format !== 'double'));
      if (finalist) return { id, tier: [1, -99999], label: 'Finaliste', tone: 'silver' };
      return { id, tier: [2, -out.key], label: `Éliminé · ${roundName(out, res, t.format)}`, tone: 'out' };
    }
    const gr = groupRank.get(id);
    if (t.format === 'groups' && gr) {
      const done = res.groupComplete[gr.g];
      if (!done) return { id, tier: [3, 0], label: `Groupe ${GROUP_LETTERS[gr.g]}`, tone: 'alive' };
      return { id, tier: [4, gr.r], label: `Éliminé · Groupe ${GROUP_LETTERS[gr.g]}`, tone: 'out' };
    }
    return { id, tier: [3, 0], label: 'En attente', tone: 'neutral' };
  });

  const cmpTier = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  const cmpStats = (a: Standing, b: Standing) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf;
  rows.sort((x, y) => cmpTier(x.tier, y.tier) || cmpStats(stats.get(x.id)!, stats.get(y.id)!));

  // Les joueurs éliminés au même tour partagent la même place.
  let rank = 0;
  return rows.map((row, i) => {
    const prev = rows[i - 1];
    const shared = prev && row.tone === 'out' && prev.tone === 'out' && cmpTier(prev.tier, row.tier) === 0 && row.tier[0] === 2;
    if (!shared) rank = i + 1;
    return { id: row.id, rank, label: row.label, tone: row.tone, st: stats.get(row.id)! };
  });
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/* ---------------------------------------------------------- consoles */

export const consoleCount = (t: Pick<Tournament, 'consoles'>) => Math.max(1, Math.floor(t.consoles ?? 1));

/** Au plus une console par paire de joueurs, sinon des consoles resteraient toujours vides. */
export const maxUsefulConsoles = (players: number) => Math.max(1, Math.floor(players / 2));

/**
 * Répartit les matchs prêts sur les consoles libres.
 * Un match déjà sur une console y reste tant qu'il n'est pas joué ; une console libérée prend
 * le prochain match de la file dont aucun joueur n'est déjà en train de jouer.
 * Déterministe : tous les téléphones obtiennent la même répartition.
 */
export function assignConsoles(t: Pick<Tournament, 'format' | 'seeds' | 'groups' | 'results' | 'consoles' | 'live'>, res: Resolved = resolve(t)): Record<string, number> {
  const C = consoleCount(t);
  const live: Record<string, number> = {};
  const busy = new Set<string>();
  const used = new Set<number>();
  for (const [id, c] of Object.entries(t.live ?? {})) {
    const m = res.byId.get(id);
    if (!m || m.state !== 'ready' || c < 1 || c > C || used.has(c) || busy.has(m.pa!) || busy.has(m.pb!)) continue;
    live[id] = c;
    used.add(c);
    busy.add(m.pa!); busy.add(m.pb!);
  }
  for (const m of readyQueue(res)) {
    if (used.size >= C) break;
    if (live[m.id] || busy.has(m.pa!) || busy.has(m.pb!)) continue;
    let c = 1;
    while (used.has(c)) c++;
    live[m.id] = c;
    used.add(c);
    busy.add(m.pa!); busy.add(m.pb!);
  }
  return live;
}

/** Nombre de « créneaux » (tours de consoles) pour finir le tournoi, en jouant en parallèle. */
export function estimateSlots(format: Format, n: number, consoles: number): number {
  if (n < 2) return 0;
  const ids = Array.from({ length: n }, (_, i) => `p${i}`);
  let t = { format, seeds: ids, groups: format === 'groups' ? makeGroups(ids) : [], results: {} as Record<string, MatchResult>, consoles, live: {} as Record<string, number> };
  let slots = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const res = resolve(t);
    const live = assignConsoles(t, res);
    const ids2 = Object.keys(live);
    if (!ids2.length) break;
    const results = { ...t.results };
    for (const id of ids2) {
      const m = res.byId.get(id)!;
      results[id] = { a: m.pa!, b: m.pb!, sa: 1, sb: 0, winner: m.pa, method: 'normal', at: 0 };
    }
    t = { ...t, results, live: {} };
    slots++;
  }
  return slots;
}
