import { useEffect, useRef, useState } from 'react';
import type { Team } from '../lib/types';
import { Icon, Sheet } from './ui';

const STOP = new Set(['fc', 'cf', 'ac', 'as', 'sc', 'ssc', 'afc', 'de', 'du', 'des', 'la', 'le', 'les', 'of', 'the', 'club', 'and', 'et', 'y', 'cd', 'sv', 'fk', 'vfl', '1.']);

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').split(/[\s-]+/).filter(Boolean);
  const main = words.filter((w) => !STOP.has(w.toLowerCase()));
  const pick = main.length ? main : words;
  if (pick.length === 1) return pick[0].slice(0, 3).toUpperCase();
  return pick.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Logo du club, ou écusson généré (couleur + initiales) si pas de logo ou si l'image ne charge pas. */
export function Crest({ team, size = 24 }: { team?: Team; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team?.badge]);
  if (!team) return null;
  if (team.badge && !failed) {
    return (
      <img className="crest" src={team.badge} width={size} height={size} alt={team.name} title={team.name}
        loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    );
  }
  const h = hue(team.name);
  const txt = initials(team.name);
  return (
    <svg className="crest" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={team.name}>
      <title>{team.name}</title>
      <path d="M20 2 L36 7 V19 C36 29 29 35 20 38 C11 35 4 29 4 19 V7 Z" fill={`hsl(${h} 70% 42%)`} stroke={`hsl(${h} 80% 72%)`} strokeWidth="2" />
      <path d="M4 15 H36" stroke={`hsl(${h} 80% 72% / .45)`} strokeWidth="2" />
      <text x="20" y={txt.length > 2 ? 27 : 28} textAnchor="middle" fill="#fff"
        style={{ font: `800 ${txt.length > 2 ? 11 : 13}px 'Barlow Condensed', system-ui, sans-serif` }}>{txt}</text>
    </svg>
  );
}

/* ------------------------------------------------------------ choix du club */

interface Hit { name: string; badge: string | null; country: string | null; league: string | null }
const cache = new Map<string, Hit[]>();

export function TeamPicker({ playerName, current, onPick, onClose }: {
  playerName: string; current?: Team; onPick: (team: Team | null) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const seq = useRef(0);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) { setHits(null); setState('idle'); return; }
    const key = query.toLowerCase();
    if (cache.has(key)) { setHits(cache.get(key)!); setState('idle'); return; }
    const n = ++seq.current;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/teams?q=${encodeURIComponent(query)}`);
        if (!r.ok) throw new Error(String(r.status));
        const { teams } = (await r.json()) as { teams: Hit[] };
        cache.set(key, teams);
        if (n === seq.current) { setHits(teams); setState('idle'); }
      } catch {
        if (n === seq.current) { setHits(null); setState('error'); }
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Sheet open onClose={onClose} title={`Club de ${playerName}`}>
      <div className="team-picker">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} maxLength={40}
          placeholder="Rechercher un club (ex. Marseille)" aria-label="Nom du club" enterKeyHint="search" />

        {state === 'loading' && <p className="muted small center"><span className="spinner tiny" /> Recherche…</p>}
        {state === 'error' && <p className="hint">Recherche de logos indisponible pour l’instant. Tu peux quand même garder le nom tapé.</p>}
        {hits && hits.length === 0 && state === 'idle' && <p className="hint">Aucun club trouvé. Essaie le nom complet ou en anglais (ex. « Bayern Munich »).</p>}

        <div className="team-results">
          {hits?.map((h) => (
            <button key={h.name} className="team-hit" onClick={() => onPick({ name: h.name, ...(h.badge ? { badge: h.badge } : {}) })}>
              <Crest team={{ name: h.name, ...(h.badge ? { badge: h.badge } : {}) }} size={36} />
              <span><b>{h.name}</b><small>{[h.league, h.country].filter(Boolean).join(' · ')}</small></span>
            </button>
          ))}
          {query.length >= 2 && (
            <button className="team-hit ghost" onClick={() => onPick({ name: query })}>
              <Crest team={{ name: query }} size={36} />
              <span><b>Utiliser « {query} »</b><small>avec un écusson généré</small></span>
            </button>
          )}
        </div>

        {query.length < 2 && !current && <p className="muted small center">Tape au moins 2 lettres. Les logos viennent de TheSportsDB.</p>}

        {current && (
          <div className="team-current">
            <Crest team={current} size={32} />
            <span>Actuellement : <b>{current.name}</b></span>
            <button className="btn ghost danger-text" onClick={() => onPick(null)}><Icon name="trash" size={16} />Retirer</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
