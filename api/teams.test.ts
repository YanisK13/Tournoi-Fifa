import { beforeEach, describe, expect, it } from 'vitest';
import { handle, norm, resetCache } from './teams';

const team = (displayName: string, id: string, extra: Record<string, string> = {}) =>
  ({ team: { displayName, logos: [{ href: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` }], ...extra } });
const league = (...teams: unknown[]) => ({ sports: [{ leagues: [{ teams }] }] });

const FIXTURES: Record<string, unknown> = {
  'fra.1': league(
    team('Marseille', '176', { shortDisplayName: 'Marseille', abbreviation: 'MAR', location: 'Marseille' }),
    team('Paris Saint-Germain', '160', { shortDisplayName: 'PSG', abbreviation: 'PSG' }),
    team('Paris FC', '6851', { abbreviation: 'PFC' }),
    team('Lyon', '167', { abbreviation: 'LYON' }),
  ),
  'esp.1': league(team('Real Madrid', '86', { abbreviation: 'RMA' }), team('Atlético Madrid', '1068'), team('Barcelona', '83')),
  'uefa.champions': league(team('Real Madrid', '86'), team('Bayern Munich', '132')),
  'fifa.world': league({ team: { displayName: 'Morocco', abbreviation: 'MAR', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/countries/500/mar.png' }] } }),
};

let calls = 0;
const fakeFetch = (async (url: string) => {
  calls++;
  const id = url.split('/soccer/')[1]?.split('/')[0];
  return FIXTURES[id] ? new Response(JSON.stringify(FIXTURES[id])) : new Response('', { status: 404 });
}) as typeof fetch;

const find = async (q: string, f = fakeFetch) => {
  const r = await handle(new Request(`http://x/api/teams?q=${encodeURIComponent(q)}`), f);
  return { status: r.status, teams: r.status === 200 ? ((await r.json()).teams as { name: string; badge: string; league: string }[]) : [] };
};

beforeEach(() => { resetCache(); calls = 0; });

describe('recherche de clubs', () => {
  it('trouve un club avec son logo', async () => {
    const { teams } = await find('marseille');
    expect(teams[0]).toEqual({ name: 'Marseille', badge: 'https://a.espncdn.com/i/teamlogos/soccer/500/176.png', country: null, league: 'Ligue 1' });
  });
  it('comprend les surnoms et les accents', async () => {
    expect((await find('PSG')).teams[0].name).toBe('Paris Saint-Germain');
    expect((await find('om')).teams[0].name).toBe('Marseille');
    expect((await find('barça')).teams[0].name).toBe('Barcelona');
    expect((await find('atletico')).teams[0].name).toBe('Atlético Madrid');
    expect((await find('bayern')).teams[0].name).toBe('Bayern Munich');
  });
  it('ne renvoie que des équipes qui correspondent', async () => {
    expect((await find('psg')).teams.map((t) => t.name)).toEqual(['Paris Saint-Germain']);
    expect((await find('zzzz')).teams).toEqual([]);
  });
  it('trouve les sélections avec leur nom français', async () => {
    const { teams } = await find('Maroc');
    expect(teams[0]).toMatchObject({ name: 'Morocco', league: 'Sélection nationale' });
  });
  it('une équipe présente dans plusieurs compétitions n’apparaît qu’une fois', async () => {
    const { teams } = await find('real');
    expect(teams.filter((t) => t.name === 'Real Madrid')).toHaveLength(1);
    expect(teams[0].league).toBe('LaLiga');
  });
  it('« paris » propose le PSG et le Paris FC', async () => {
    const names = (await find('paris')).teams.map((t) => t.name);
    expect(names).toContain('Paris Saint-Germain');
    expect(names).toContain('Paris FC');
  });
  it('les listes sont chargées une seule fois puis gardées en mémoire', async () => {
    await find('lyon');
    const first = calls;
    await find('marseille');
    expect(calls).toBe(first);
  });
  it('erreurs : requête trop courte, source injoignable', async () => {
    expect((await find('m')).status).toBe(400);
    expect((await find('psg', (async () => { throw new Error('down'); }) as typeof fetch)).status).toBe(502);
  });
  it('normalisation', () => expect(norm('  Atlético-Madrid ')).toBe('atletico madrid'));
});
