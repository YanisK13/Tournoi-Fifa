export type Format = 'single' | 'double' | 'league' | 'groups';

/** 1v1 : chaque joueur joue seul · 2v2 : les joueurs sont regroupés en duos, ce sont les duos qui s'affrontent. */
export type Mode = '1v1' | '2v2';

export interface Duo {
  /** Identifiant tiré des deux membres (même duo = même identifiant, quel que soit l'ordre). */
  id: string;
  a: string;
  b: string;
  team?: Team;
}

/** Ce qui s'affronte dans le tableau : un joueur (1v1) ou un duo (2v2). */
export interface Participant {
  id: string;
  name: string;
  team?: Team;
  members?: [string, string];
}

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
  /** 1v1 par défaut. */
  mode?: Mode;
  /** 2v2 uniquement : les duos, formés à partir de l'ordre des joueurs (1+2, 3+4…). */
  duos?: Duo[];
  /** Nombre de consoles disponibles (1 par défaut). */
  consoles?: number;
  /** Match en cours sur chaque console : id du match → numéro de console (1, 2…). */
  live?: Record<string, number>;
}

export const MAX_CONSOLES = 8;
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 32;
export const MIN_PLAYERS_GROUPS = 6;
