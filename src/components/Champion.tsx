import { useMemo } from 'react';
import { ranking } from '../lib/engine';
import { useName, useT } from './ctx';
import { Icon } from './ui';

export function ChampionScreen({ onClose, onShare, onReplay, onNew }: { onClose: () => void; onShare: () => void; onReplay: () => void; onNew: () => void }) {
  const { t, res } = useT();
  const name = useName();
  const rows = ranking(t, res);
  const champ = res.champion!;
  const final = t.format === 'league' ? null
    : t.format === 'double'
      ? (res.byId.get('GF2')?.state === 'done' ? res.byId.get('GF2') : res.byId.get('GF1'))
      : res.byId.get(`W${res.wRounds}-0`);
  const champStats = rows.find((r) => r.id === champ)!.st;
  const confetti = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 1.2, dur: 2.4 + Math.random() * 1.8, hue: i % 3,
  })), []);

  return (
    <div className="champion-screen" role="dialog" aria-modal="true" aria-label="Champion du tournoi">
      <div className="confetti" aria-hidden="true">
        {confetti.map((c, i) => (
          <span key={i} className={`c${c.hue}`} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }} />
        ))}
      </div>
      <button className="icon-btn champion-close" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
      <div className="champion-body">
        <div className="trophy-ring"><Icon name="trophy" size={64} /></div>
        <p className="eyebrow">{t.name} · Champion</p>
        <h1 className="champion-name">{name(champ)}</h1>
        {final?.result ? (
          <p className="champion-final">
            Finale : {name(final.pa)} <b>{final.result.sa} – {final.result.sb}</b> {name(final.pb)}
            {final.result.method === 'pens' && ' (TAB)'}{final.result.method === 'et' && ' (a.p.)'}
          </p>
        ) : (
          <p className="champion-final">{champStats.pts} pts · {champStats.w} V {champStats.d} N {champStats.l} D</p>
        )}
        <ol className="podium">
          {rows.slice(1, 3).map((r) => (
            <li key={r.id}><span>{r.rank}</span>{name(r.id)}<small>{r.label}</small></li>
          ))}
        </ol>
      </div>
      <div className="champion-actions">
        <button className="btn primary xl" onClick={onShare}><Icon name="share" />Partager le résultat</button>
        <div className="row-2">
          <button className="btn ghost" onClick={onReplay}><Icon name="reset" />Rejouer</button>
          <button className="btn ghost" onClick={onNew}><Icon name="plus" />Nouveau</button>
        </div>
        <button className="btn link" onClick={onClose}>Voir le tableau</button>
      </div>
    </div>
  );
}
