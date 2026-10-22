import { consoleCount, matchTitle, playable, readyQueue, type RMatch } from '../lib/engine';
import { Crest } from './Crest';
import { useName, usePlayer, useT } from './ctx';
import { Icon } from './ui';

function methodTag(m: RMatch) {
  if (!m.result || m.result.method === 'normal') return null;
  return <span className="method">{m.result.method === 'pens' ? 'TAB' : 'a.p.'}</span>;
}

/** Ligne de match : utilisée dans les listes et dans le tableau. */
export function MatchCard({ m, compact = false, caption }: { m: RMatch; compact?: boolean; caption?: string }) {
  const { t, openMatch } = useT();
  const name = useName();
  const player = usePlayer();
  const onConsole = m.state === 'ready' && consoleCount(t) > 1 ? t.live?.[m.id] : undefined;
  const clickable = m.state === 'ready' || m.state === 'done';
  const side = (id: typeof m.pa, score: number | undefined) => {
    const won = m.state === 'done' && m.winner === id;
    const lost = m.state === 'done' && m.winner !== null && m.winner !== id;
    return (
      <div className={`mc-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${id ? '' : 'tbd'}`}>
        <span className="mc-name"><Crest team={player(id)?.team} size={compact ? 18 : 20} />{name(id)}</span>
        <span className="mc-score">{won && compact && m.result?.method !== 'normal' && <small className="method">{m.result?.method === 'pens' ? 'TAB' : 'a.p.'}</small>}{score ?? ''}</span>
      </div>
    );
  };
  const body = (
    <>
      {caption && <span className="mc-caption">{caption}{methodTag(m)}</span>}
      {onConsole && <span className="mc-console">Console {onConsole}</span>}
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
  const player = usePlayer();
  const all = playable(res);
  const queue = readyQueue(res);
  const C = consoleCount(t);
  const live = t.live ?? {};
  // Matchs en cours : ceux affectés à une console (repli sur la file si l'affectation manque).
  const onConsole = Array.from({ length: C }, (_, i) => {
    const id = Object.keys(live).find((k) => live[k] === i + 1);
    const m = id ? res.byId.get(id) : undefined;
    return m && m.state === 'ready' ? m : undefined;
  });
  if (!onConsole.some(Boolean) && queue[0]) onConsole[0] = queue[0];
  const playing = new Set(onConsole.filter(Boolean).map((m) => m!.id));
  const later = queue.filter((m) => !playing.has(m.id));
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

      {playing.size > 0 && (
        <section className={`consoles ${C > 1 ? 'multi' : ''}`}>
          {onConsole.map((m, i) => m ? (
            <div key={m.id} className="next-match">
              <p className="eyebrow">{C > 1 ? `Console ${i + 1}` : 'À la manette'} · {matchTitle(m, res, t.format)}</p>
              <div className="next-vs">
                {[m.pa, m.pb].map((id, k) => (
                  <div key={k} className={`next-side ${k ? 'b' : 'a'}`}>
                    <Crest team={player(id)?.team} size={C > 1 ? 40 : 52} />
                    <span>{name(id)}</span>
                    {player(id)?.team && <small>{player(id)!.team!.name}</small>}
                  </div>
                ))}
                <i>VS</i>
              </div>
              <button className="btn primary xl" onClick={() => openMatch(m.id)}><Icon name="play" />Saisir le score</button>
            </div>
          ) : (
            <div key={`free-${i}`} className="console-free">
              <p className="eyebrow">Console {i + 1}</p>
              <span>Libre · en attente des résultats en cours</span>
            </div>
          ))}
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
