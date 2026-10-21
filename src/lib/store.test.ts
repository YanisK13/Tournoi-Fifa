import { describe, expect, it } from 'vitest';
import { readyQueue, resolve } from './engine';
import { reducer } from './store';
import type { Tournament } from './types';

const create = (count = 6, format: Tournament['format'] = 'single') =>
  reducer(null, { type: 'create', name: 'Soirée', game: 'FC', format, matchMinutes: 15, count })!;

describe('reducer', () => {
  it('crée un tournoi avec des joueurs par défaut', () => {
    const t = create(6);
    expect(t.players.map((p) => p.name)).toEqual(['Joueur 1', 'Joueur 2', 'Joueur 3', 'Joueur 4', 'Joueur 5', 'Joueur 6']);
    expect(t.status).toBe('setup');
  });

  it('ajout, renommage, suppression avant tirage', () => {
    let t = create(4);
    t = reducer(t, { type: 'addPlayer', name: 'Yanis' })!;
    t = reducer(t, { type: 'renamePlayer', id: t.players[0].id, name: 'Momo' })!;
    t = reducer(t, { type: 'removePlayer', id: t.players[1].id })!;
    expect(t.players.map((p) => p.name)).toEqual(['Momo', 'Joueur 3', 'Joueur 4', 'Yanis']);
  });

  it('tirage : tous les joueurs sont placés une fois', () => {
    const t = reducer(create(9, 'groups'), { type: 'draw' })!;
    expect(t.status).toBe('running');
    expect([...t.seeds].sort()).toEqual(t.players.map((p) => p.id).sort());
    expect(t.groups.flat().sort()).toEqual([...t.seeds].sort());
  });

  it('supprimer un joueur en cours de tournoi annule le tirage et les scores', () => {
    let t = reducer(create(5), { type: 'draw' })!;
    const m = readyQueue(resolve(t))[0];
    t = reducer(t, { type: 'setResult', id: m.id, result: { a: m.pa!, b: m.pb!, sa: 1, sb: 0, winner: m.pa, method: 'normal', at: 1 } })!;
    expect(Object.keys(t.results)).toHaveLength(1);
    t = reducer(t, { type: 'removePlayer', id: t.players[0].id })!;
    expect(t.status).toBe('setup');
    expect(t.results).toEqual({});
    expect(t.players).toHaveLength(4);
  });

  it('recommencer garde les joueurs, réinitialiser supprime tout', () => {
    const t = reducer(create(4), { type: 'draw' })!;
    const r = reducer(t, { type: 'restart' })!;
    expect(r.status).toBe('setup');
    expect(r.players).toHaveLength(4);
    expect(reducer(t, { type: 'reset' })).toBeNull();
  });

  it('pas plus de 32 joueurs', () => {
    let t = create(32);
    t = reducer(t, { type: 'addPlayer', name: 'Trop' })!;
    expect(t.players).toHaveLength(32);
  });
});

describe('clubs', () => {
  it('choisir, changer et retirer le club d’un joueur', () => {
    let t = create(4);
    const id = t.players[0].id;
    t = reducer(t, { type: 'setTeam', id, team: { name: 'Olympique de Marseille', badge: 'https://r2.thesportsdb.com/images/media/team/badge/om.png' } })!;
    expect(t.players[0].team).toEqual({ name: 'Olympique de Marseille', badge: 'https://r2.thesportsdb.com/images/media/team/badge/om.png' });
    // Un logo qui n'est pas en https est ignoré (écusson généré à la place).
    t = reducer(t, { type: 'setTeam', id, team: { name: 'Mon club', badge: 'javascript:alert(1)' } })!;
    expect(t.players[0].team).toEqual({ name: 'Mon club' });
    t = reducer(t, { type: 'setTeam', id, team: null })!;
    expect(t.players[0].team).toBeUndefined();
    expect(t.players[0].name).toBe('Joueur 1');
  });
  it('changer de club pendant le tournoi ne touche pas aux scores', () => {
    let t = reducer(create(4), { type: 'draw' })!;
    t = reducer(t, { type: 'setTeam', id: t.players[1].id, team: { name: 'PSG' } })!;
    expect(t.status).toBe('running');
    expect(t.seeds).toHaveLength(4);
  });
});
