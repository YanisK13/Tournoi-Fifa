export type Format = 'single' | 'double' | 'league' | 'groups';

export interface Team {
  name: string;
  /** Logo du club (https), absent si on utilise l'écusson généré. */
  badge?: string;
}

export interface Player {
  id: string;
  name: string;
  team?: Team;
}

/** Where a match participant comes from. */
export type Source =
  | { kind: 'player'; id: string }
  | { kind: 'bye' }
  | { kind: 'winner'; match: string }
  | { kind: 'loser'; match: string }
  | { kind: 'group'; group: number; rank: number };

/** W = tableau principal, L = repêchage, GF = grande finale. */
export type Stage = 'W' | 'L' | 'GF' | 'league' | 'group';

export interface MatchDef {
  id: string;
  stage: Stage;
  round: number;
  order: number;
  a: Source;
  b: Source;
  /** Un vainqueur est obligatoire (pas de match nul possible). */
  knockout: boolean;
  group?: number;
  /** Ordre de jeu naturel (plus petit = plus tôt). */
  key: number;
  /** Revanche de grande finale (double élimination), jouée seulement si nécessaire. */
  reset?: boolean;
}

export type Method = 'normal' | 'et' | 'pens';

export interface MatchResult {
  /** Joueurs au moment de la saisie : si le tableau change, le résultat devient caduc. */
  a: string;
  b: string;
  sa: number;
  sb: number;
  winner: string | null;
  method: Method;
  at: number;
}

export interface Tournament {
  id: string;
  name: string;
  game: string;
  format: Format;
  matchMinutes: number;
  players: Player[];
  status: 'setup' | 'running';
  /** Ordre issu du tirage (tête de série 1 = index 0). */
  seeds: string[];
  /** Composition des groupes (format groupes uniquement). */
  groups: string[][];
  results: Record<string, MatchResult>;
  createdAt: number;
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 32;
export const MIN_PLAYERS_GROUPS = 6;
