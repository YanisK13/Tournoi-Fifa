import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { Resolved } from '../lib/engine';
import { BYE } from '../lib/engine';
import type { Action } from '../lib/store';
import type { Format, Tournament } from '../lib/types';

export interface Ctx {
  t: Tournament;
  res: Resolved;
  dispatch: Dispatch<Action>;
  openMatch: (id: string) => void;
}

export const TournamentCtx = createContext<Ctx>(null as unknown as Ctx);
export const useT = () => useContext(TournamentCtx);

export function useName() {
  const { t } = useT();
  return (id: string | null | undefined) => {
    if (!id) return 'À déterminer';
    if (id === BYE) return 'Exempt';
    return t.players.find((p) => p.id === id)?.name ?? '?';
  };
}

export function usePlayer() {
  const { t } = useT();
  return (id: string | null | undefined) => (id && id !== BYE ? t.players.find((p) => p.id === id) : undefined);
}

export const FORMATS: { id: Format; label: string; desc: string }[] = [
  { id: 'single', label: 'Élimination directe', desc: 'Une défaite et c’est fini. Le plus rapide.' },
  { id: 'double', label: 'Double élimination', desc: 'Droit à une erreur : les perdants passent au repêchage.' },
  { id: 'league', label: 'Championnat', desc: 'Tout le monde affronte tout le monde.' },
  { id: 'groups', label: 'Groupes + phase finale', desc: 'Poules, puis les 2 premiers de chaque groupe en tableau.' },
];

export const formatLabel = (f: Format) => FORMATS.find((x) => x.id === f)!.label;
