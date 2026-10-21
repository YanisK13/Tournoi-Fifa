import { describe, expect, it } from 'vitest';
import { handle, mapTeams } from './teams';

const sample = {
  teams: [
    { strTeam: 'Marseille', strSport: 'Soccer', strBadge: 'https://r2.thesportsdb.com/images/media/team/badge/om.png', strCountry: 'France', strLeague: 'French Ligue 1' },
    { strTeam: 'Marseille Basket', strSport: 'Basketball', strBadge: 'https://x/b.png' },
    { strTeam: 'Old Club', strSport: 'Soccer', strTeamBadge: 'https://r2.thesportsdb.com/old.png' },
    { strTeam: 'No Badge FC', strSport: 'Soccer', strBadge: null },
    { strTeam: 'Marseille', strSport: 'Soccer', strBadge: 'https://dup.png' },
  ],
};

describe('recherche de clubs', () => {
  it('garde le foot, gère les anciens champs, enlève les doublons', () => {
    expect(mapTeams(sample)).toEqual([
      { name: 'Marseille', badge: 'https://r2.thesportsdb.com/images/media/team/badge/om.png', country: 'France', league: 'French Ligue 1' },
      { name: 'Old Club', badge: 'https://r2.thesportsdb.com/old.png', country: null, league: null },
      { name: 'No Badge FC', badge: null, country: null, league: null },
    ]);
    expect(mapTeams({ teams: null })).toEqual([]);
  });
  it('appelle la source et renvoie les clubs', async () => {
    let called = '';
    const r = await handle(new Request('http://x/api/teams?q=marseille'), (async (u: string) => { called = u; return new Response(JSON.stringify(sample)); }) as typeof fetch);
    expect(called).toContain('searchteams.php?t=marseille');
    expect((await r.json()).teams[0].name).toBe('Marseille');
  });
  it('erreurs : requête trop courte, source en panne, limite atteinte', async () => {
    expect((await handle(new Request('http://x/api/teams?q=m'))).status).toBe(400);
    const down = await handle(new Request('http://x/api/teams?q=psg'), (async () => { throw new Error('down'); }) as typeof fetch);
    expect(down.status).toBe(502);
    const limited = await handle(new Request('http://x/api/teams?q=psg'), (async () => new Response('', { status: 429 })) as typeof fetch);
    expect(limited.status).toBe(503);
  });
});
