import { ranking } from '../lib/engine';
import { Crest } from './Crest';
import { useName, usePlayer, useT } from './ctx';
import { Icon } from './ui';

export function StandingsTab() {
  const { t, res } = useT();
  const name = useName();
  const player = usePlayer();
  const rows = ranking(t, res);
  const anyPlayed = rows.some((r) => r.st.played > 0);

  return (
    <div className="tab-body">
      {!anyPlayed && <p className="empty">Le classement se mettra à jour après le premier match.</p>}
      <div className="table-wrap">
        <table className="table rank">
          <thead>
            <tr><th className="l">#</th><th className="l">Joueur</th><th>J</th><th>G-N-P</th><th>Buts</th><th>Pts</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`tone-${r.tone}`}>
                <td className="l pos">{r.tone === 'gold' ? <span className="medal"><Icon name="trophy" size={16} /></span> : r.rank}</td>
                <td className="l name">
                  <b><Crest team={player(r.id)?.team} size={18} />{name(r.id)}</b>
                  {r.label && <small className={`status ${r.tone}`}>{r.label}</small>}
                </td>
                <td>{r.st.played}</td>
                <td className="nowrap">{r.st.w}-{r.st.d}-{r.st.l}</td>
                <td className="nowrap">{r.st.gf}:{r.st.ga}</td>
                <td className="pts">{r.st.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        {t.format === 'league'
          ? 'Victoire 3 pts, nul 1 pt. Départage : points, différence de buts, buts marqués, victoires.'
          : 'Classement selon le tour atteint, puis points (victoire 3, nul 1), différence de buts et buts marqués. Une victoire aux tirs au but compte comme une victoire.'}
      </p>
    </div>
  );
}
