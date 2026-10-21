/**
 * Recherche de clubs et sélections de football avec leur logo (fonction Vercel).
 *   GET /api/teams?q=marseille → 200 { teams: [{ name, badge, country, league }] }
 *
 * Source : listes d'équipes publiques d'ESPN (sans clé), chargées une fois puis gardées
 * en mémoire 12 h. La recherche se fait ici, sans accents, avec les surnoms courants (PSG, OM, Barça…)
 * et les noms de pays en français.
 */

export interface TeamHit { name: string; badge: string | null; country: string | null; league: string | null }

const LEAGUES: [string, string][] = [
  ['fra.1', 'Ligue 1'], ['fra.2', 'Ligue 2'], ['eng.1', 'Premier League'], ['eng.2', 'Championship'],
  ['esp.1', 'LaLiga'], ['ita.1', 'Serie A'], ['ger.1', 'Bundesliga'], ['por.1', 'Liga Portugal'],
  ['ned.1', 'Eredivisie'], ['bel.1', 'Pro League'], ['tur.1', 'Süper Lig'], ['sco.1', 'Scottish Premiership'],
  ['ksa.1', 'Saudi Pro League'], ['usa.1', 'MLS'], ['bra.1', 'Brasileirão'], ['arg.1', 'Liga Argentina'],
  ['mex.1', 'Liga MX'], ['uefa.champions', 'Ligue des champions'], ['uefa.europa', 'Ligue Europa'],
  ['fifa.world', 'Sélection nationale'],
];
const SOURCE = (league: string) => `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams`;

/** Surnoms et noms français → termes présents dans les noms anglais d'ESPN. */
const ALIASES: Record<string, string> = {
  psg: 'paris saint germain', paris: 'paris saint germain', om: 'marseille', ol: 'lyon', losc: 'lille', asse: 'saint etienne',
  barca: 'barcelona', barcelone: 'barcelona', real: 'real madrid', atletico: 'atletico madrid', juve: 'juventus',
  inter: 'internazionale', milan: 'ac milan', naples: 'napoli', rome: 'roma', bayern: 'bayern munich', munich: 'bayern munich',
  bvb: 'dortmund', city: 'manchester city', united: 'manchester united', manu: 'manchester united', spurs: 'tottenham',
  lisbonne: 'sporting', benfica: 'benfica', porto: 'porto', ajax: 'ajax',
  allemagne: 'germany', espagne: 'spain', angleterre: 'england', maroc: 'morocco', algerie: 'algeria', bresil: 'brazil',
  argentine: 'argentina', italie: 'italy', 'pays bas': 'netherlands', hollande: 'netherlands', belgique: 'belgium',
  tunisie: 'tunisia', 'etats unis': 'united states', usa: 'united states', mexique: 'mexico', 'cote d ivoire': 'ivory coast',
  croatie: 'croatia', suisse: 'switzerland', japon: 'japan', coree: 'korea', egypte: 'egypt', cameroun: 'cameroon',
  turquie: 'turkey', ecosse: 'scotland', 'pays de galles': 'wales', irlande: 'ireland', colombie: 'colombia',
  'arabie saoudite': 'saudi arabia', australie: 'australia', norvege: 'norway', suede: 'sweden', danemark: 'denmark',
  pologne: 'poland', autriche: 'austria', 'republique tcheque': 'czechia', grece: 'greece', serbie: 'serbia',
};

interface Entry extends TeamHit { keys: string[] }

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type Raw = { team?: { displayName?: string; shortDisplayName?: string; abbreviation?: string; location?: string; name?: string; logos?: { href?: string }[] } };

export function parseLeague(raw: unknown, league: string): TeamHit[] {
  const teams = (raw as { sports?: { leagues?: { teams?: Raw[] }[] }[] })?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return (Array.isArray(teams) ? teams : [])
    .map((x) => x?.team)
    .filter((t): t is NonNullable<Raw['team']> => !!t?.displayName)
    .map((t) => {
      const href = t.logos?.[0]?.href ?? null;
      return { name: String(t.displayName).slice(0, 40), badge: href && /^https:\/\//.test(href) ? href : null, country: null, league };
    });
}

let cache: { at: number; entries: Entry[] } | null = null;
const TTL_MS = 12 * 3600 * 1000;
export function resetCache() { cache = null; }

async function loadAll(fetchFn: typeof fetch): Promise<Entry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries;
  const results = await Promise.allSettled(LEAGUES.map(async ([id, label]) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetchFn(SOURCE(id), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      return { raw: await r.json(), label };
    } finally {
      clearTimeout(timer);
    }
  }));
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const raw = res.value.raw as { sports?: { leagues?: { teams?: Raw[] }[] }[] };
    const teams = raw?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    parseLeague(raw, res.value.label).forEach((hit, i) => {
      const id = hit.badge ?? norm(hit.name);
      if (seen.has(id)) return; // même équipe dans plusieurs compétitions : on garde le championnat national
      seen.add(id);
      const t = teams[i]?.team ?? {};
      const keys = [hit.name, t.shortDisplayName, t.abbreviation, t.location, t.name].filter(Boolean).map((k) => norm(String(k)));
      entries.push({ ...hit, keys });
    });
  }
  if (!entries.length) throw new Error('aucune équipe chargée');
  cache = { at: Date.now(), entries };
  return entries;
}

function score(e: Entry, q: string): number {
  let best = 0;
  for (const k of e.keys) {
    if (k === q) best = Math.max(best, 100);
    else if (k.startsWith(q)) best = Math.max(best, 80);
    else if (k.split(' ').some((w) => w.startsWith(q))) best = Math.max(best, 60);
    else if (q.length >= 3 && k.includes(q)) best = Math.max(best, 40);
  }
  return best;
}

export function search(entries: Entry[], query: string): TeamHit[] {
  const q = norm(query);
  if (!q) return [];
  const terms = [q, ALIASES[q]].filter(Boolean) as string[];
  return entries
    .map((e) => ({ e, s: Math.max(...terms.map((t) => { const sc = score(e, t); return sc && t !== q ? sc + 5 : sc; })) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
    .slice(0, 8)
    .map(({ e }) => ({ name: e.name, badge: e.badge, country: e.country, league: e.league }));
}

const json = (status: number, body: unknown, cacheHeader = 'no-store') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheHeader } });

export async function handle(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 40);
  if (norm(q).length < 2) return json(400, { error: 'query_too_short' });
  try {
    const entries = await loadAll(fetchFn);
    return json(200, { teams: search(entries, q) }, 'public, s-maxage=43200, max-age=3600');
  } catch {
    return json(502, { error: 'source_unreachable' });
  }
}

export default { fetch: (req: Request) => handle(req) };
