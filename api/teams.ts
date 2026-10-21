/**
 * Recherche de clubs et sélections de football avec leur logo (fonction Vercel).
 *   GET /api/teams?q=marseille → 200 { teams: [{ name, badge, country, league }] }
 *
 * Source : TheSportsDB (clé publique gratuite). L'appel passe par le serveur pour
 * éviter les blocages du navigateur, et la réponse est mise en cache 1 jour.
 */

export interface TeamHit { name: string; badge: string | null; country: string | null; league: string | null }

const SOURCE = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=';

const json = (status: number, body: unknown, cache = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

type Raw = { strTeam?: string; strSport?: string; strBadge?: string; strTeamBadge?: string; strCountry?: string; strLeague?: string };

export function mapTeams(raw: unknown): TeamHit[] {
  const list = (raw as { teams?: Raw[] | null })?.teams ?? [];
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.strTeam && (!t.strSport || t.strSport === 'Soccer'))
    .map((t) => {
      const badge = t.strBadge || t.strTeamBadge || null;
      return {
        name: String(t.strTeam).slice(0, 40),
        badge: badge && /^https:\/\//.test(badge) ? badge : null,
        country: t.strCountry || null,
        league: t.strLeague || null,
      };
    })
    .filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
    .slice(0, 8);
}

export async function handle(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 40);
  if (q.length < 2) return json(400, { error: 'query_too_short' });
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetchFn(SOURCE + encodeURIComponent(q), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (r.status === 429) return json(503, { error: 'rate_limited' });
    if (!r.ok) return json(502, { error: 'source_error', status: r.status });
    return json(200, { teams: mapTeams(await r.json()) }, 'public, s-maxage=86400, max-age=3600');
  } catch {
    return json(502, { error: 'source_unreachable' });
  }
}

export default { fetch: (req: Request) => handle(req) };
