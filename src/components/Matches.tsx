import { matchTitle, playable, readyQueue, type RMatch } from '../lib/engine';
import { useName, useT } from './ctx';
import { Icon } from './ui';

function methodTag(m: RMatch) {
  if (!m.result || m.result.method === 'normal') return null;
  return <span className="method">{m.result.method === 'pens' ? 'TAB' : 'a.p.'}</span>;
}

/** Ligne de match : utilisée dans les listes et dans le tableau. */
export function MatchCard({ m, compact = false, caption }: { m: RMatch; compact?: boolean; caption?: string }) {
  const { openMatch } = useT();
  const name = useName();
  const clickable = m.state === 'ready' || m.state === 'done';
  const side = (id: typeof m.pa, score: number | undefined) => {
    const won = m.state === 'done' && m.winner === id;
    const lost = m.state === 'done' && m.winner !== null && m.winner !== id;
    return (
      <div className={`mc-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id ? '' : 'tbd'}`}>
        <span className="mc-name">{name(id)}</span>
        <span className="mc-score">{won && compact && m.result?.method !== 'normal' && <small className="method">{m.result?.method === 'pens' ? 'TAB' : 'a.p.'}</small>}{score ?? ''}</span>
      </div>
    );
  };
  const body = (
    <>
      {caption && <span className="mc-caption">{caption}{methodTag(m)}</span>}
      {side(m.pa, m.result?.sa)}
      {side(m.pb, m.result?.sb)}
      {m.state === 'ready' && !compact && <span className="mc-cta">Saisir <Icon name="play" size={12} /></span>}
    </>
  );
  const cls = `mc ${compact ? 'compact' : ''} st-${m.state}`;
  return clickable ? (
    <button className={cls} onClick={() => openMatch(m.id)} aria-label={`${caption ?? 'Match'} : ${name(m.pa)} contre ${name(m.pb)}${m.state === 'done' ? `, ${m.result!.sa} à ${m.result!.sb}` : ', à jouer'}`}>
      {body}
    </button>
  ) : <div className={cls}>{body}</div>;
}

export function MatchesTab({ onChampion }: { onChampion: () => void }) {
  const { t, res, openMatch } = useT();
  const name = useName();
  const all = playable(res);
  const queue = readyQueue(res);
  const [next, ...later] = queue;
  const pending = all.filter((m) => m.state === 'pending');
  const done = all.filter((m) => m.state === 'done').sort((a, b) => (b.result!.at ?? 0) - (a.result!.at ?? 0));
  const total = all.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;

  return (
    <div className="tab-body">
      <div className="progress" aria-label={`${done.length} matchs joués sur ${total}`}>
        <div className="progress-bar"><span style={{ width: `${pct}%` }} /></div>
        <span>{done.length}/{total} matchs</span>
      </div>

      {res.champion && (
        <button className="champion-banner" onClick={onChampion}>
          <Icon name="trophy" size={28} />
          <span><small>Champion</small><b>{name(res.champion)}</b></span>
          <span className="champion-banner-cta">Voir</span>
        </button>
      )}

      {next && (
        <section className="next-match">
          <p className="eyebrow">À la manette · {matchTitle(next, res, t.format)}</p>
          <div className="next-vs">
            <span>{name(next.pa)}</span>
            <i>VS</i>
            <span>{name(next.pb)}</span>
          </div>
          <button className="btn primary xl" onClick={() => openMatch(next.id)}><Icon name="play" />Saisir le score</button>
        </section>
      )}

      {later.length > 0 && (
        <section>
          <h2 className="list-title">Ensuite <span className="count">{later.length}</span></h2>
          <div className="match-list">
            {later.map((m) => <MatchCard key={m.id} m={m} caption={matchTitle(m, res, t.format)} />)}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <p className="muted pending-note">
          {pending.length} match{pending.length > 1 ? 's' : ''} en attente des résultats précédents
          {t.format === 'groups' && !res.groupComplete.every(Boolean) && ' (phase finale après les groupes)'}.
        </p>
      )}

      <section>
        <h2 className="list-title">Historique <span className="count">{done.length}</span></h2>
        {done.length === 0 ? (
          <p className="empty">Aucun match joué. Le premier score s’affichera ici.</p>
        ) : (
          <div className="match-list">
            {done.map((m) => <MatchCard key={m.id} m={m} caption={matchTitle(m, res, t.format)} />)}
          </div>
        )}
        {done.length > 0 && <p className="muted small center">Touchez un match joué pour corriger son score.</p>}
      </section>
    </div>
  );
}
