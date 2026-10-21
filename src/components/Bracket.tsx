import { BYE, GROUP_LETTERS, roundName, type RMatch, type Standing } from '../lib/engine';
import type { Stage } from '../lib/types';
import { useName, useT } from './ctx';
import { MatchCard } from './Matches';

function Placeholder({ m }: { m: RMatch }) {
  const name = useName();
  const real = [m.pa, m.pb].find((p) => p && p !== BYE);
  if (!real && m.state === 'bye') return <div className="mc-ghost" aria-hidden="true" />;
  return (
    <div className="mc-ghost bye">
      <small>Exempté</small>
      <span>{real ? name(real) : 'Qualifié d’office'}</span>
    </div>
  );
}

function Tree({ stage, title }: { stage: Stage; title?: string }) {
  const { t, res } = useT();
  const matches = res.matches.filter((m) => m.stage === stage && !(m.reset && m.hidden));
  if (!matches.length) return null;
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  // Un tour entièrement composé d'exemptions n'apporte rien visuellement.
  const visibleRounds = rounds.filter((r) => matches.some((m) => m.round === r && !m.hidden) || stage === 'W');
  return (
    <section className="tree-section">
      {title && <h2 className="list-title">{title}</h2>}
      <div className="tree-scroll">
        <div className="tree">
          {visibleRounds.map((r) => {
            const col = matches.filter((m) => m.round === r).sort((a, b) => a.order - b.order);
            const allHidden = col.every((m) => m.hidden);
            return (
              <div className="tree-col" key={r}>
                {roundName(col[0], res, t.format) !== title && <h3 className="tree-col-title">{roundName(col[0], res, t.format)}</h3>}
                <div className={`tree-col-body ${stage === 'W' ? 'aligned' : ''}`}>
                  {col.map((m) =>
                    m.hidden ? (allHidden ? null : <Placeholder key={m.id} m={m} />) : <MatchCard key={m.id} m={m} compact />,
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function MiniTable({ rows, qualify = 0, title }: { rows: Standing[]; qualify?: number; title?: string }) {
  const name = useName();
  return (
    <div className="table-wrap">
      {title && <h3 className="table-title">{title}</h3>}
      <table className="table">
        <thead>
          <tr><th className="l">#</th><th className="l">Joueur</th><th>J</th><th>G</th><th>N</th><th>P</th><th>Diff</th><th>Pts</th></tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id} className={i < qualify ? 'q' : ''}>
              <td className="l pos">{i + 1}</td>
              <td className="l name">{name(s.id)}</td>
              <td>{s.played}</td><td>{s.w}</td><td>{s.d}</td><td>{s.l}</td>
              <td>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
              <td className="pts">{s.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoundsList({ matches }: { matches: RMatch[] }) {
  const { t, res } = useT();
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="rounds">
      {rounds.map((r) => {
        const col = matches.filter((m) => m.round === r);
        return (
          <div key={r} className="round-block">
            <h3 className="tree-col-title">{roundName(col[0], res, t.format)}</h3>
            <div className="match-list">{col.map((m) => <MatchCard key={m.id} m={m} compact />)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function BracketTab() {
  const { t, res } = useT();

  if (t.format === 'league') {
    return <div className="tab-body"><RoundsList matches={res.matches.filter((m) => m.stage === 'league')} /></div>;
  }

  if (t.format === 'groups') {
    const groupsDone = res.groupComplete.every(Boolean);
    return (
      <div className="tab-body">
        <p className="muted small">Les 2 premiers de chaque groupe (en surbrillance) vont en phase finale.</p>
        {res.groupTables.map((rows, g) => (
          <details key={g} className="group-block" open={!res.groupComplete[g]}>
            <summary>
              <span>Groupe {GROUP_LETTERS[g]}</span>
              <small>{res.groupComplete[g] ? 'Terminé' : 'En cours'}</small>
            </summary>
            <MiniTable rows={rows} qualify={2} />
            <RoundsList matches={res.matches.filter((m) => m.stage === 'group' && m.group === g)} />
          </details>
        ))}
        <Tree stage="W" title={groupsDone ? 'Phase finale' : 'Phase finale (après les groupes)'} />
      </div>
    );
  }

  return (
    <div className="tab-body">
      <p className="muted small swipe-hint">Fais glisser le tableau horizontalement · touche un match pour saisir le score.</p>
      <Tree stage="W" title={t.format === 'double' ? 'Tableau principal' : undefined} />
      {t.format === 'double' && (
        <>
          <Tree stage="L" title="Repêchage" />
          <Tree stage="GF" title="Grande finale" />
        </>
      )}
    </div>
  );
}
