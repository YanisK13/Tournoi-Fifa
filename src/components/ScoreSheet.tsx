import { useState } from 'react';
import { impactOf, matchTitle, type RMatch } from '../lib/engine';
import type { MatchResult, Method } from '../lib/types';
import { useName, useT } from './ctx';
import { Icon, Sheet, useConfirm } from './ui';

function ScoreInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="score-input">
      <span className="score-player" title={label}>{label}</span>
      <div className="score-ctrl">
        <button type="button" className="score-btn" aria-label={`Retirer un but à ${label}`}
          onClick={() => onChange(value === null ? 0 : Math.max(0, value - 1))}><Icon name="minus" size={26} /></button>
        <input
          className="score-value" inputMode="numeric" pattern="[0-9]*" aria-label={`Buts de ${label}`}
          value={value ?? ''} placeholder="–"
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
            onChange(digits === '' ? null : Number(digits));
          }}
        />
        <button type="button" className="score-btn plus" aria-label={`Ajouter un but à ${label}`}
          onClick={() => onChange(value === null ? 1 : Math.min(99, value + 1))}><Icon name="plus" size={26} /></button>
      </div>
    </div>
  );
}

export function ScoreSheet({ match, onClose }: { match: RMatch; onClose: () => void }) {
  const { t, res, dispatch } = useT();
  const name = useName();
  const confirm = useConfirm();
  const prev = match.state === 'done' ? match.result : undefined;
  const [sa, setSa] = useState<number | null>(prev?.sa ?? null);
  const [sb, setSb] = useState<number | null>(prev?.sb ?? null);
  const [tieWinner, setTieWinner] = useState<string | null>(prev && prev.sa === prev.sb ? prev.winner : null);
  const [method, setMethod] = useState<Method>(prev?.method === 'et' ? 'et' : 'pens');

  const pa = match.pa!;
  const pb = match.pb!;
  const bothSet = sa !== null && sb !== null;
  const isDraw = bothSet && sa === sb;
  const needsWinner = match.knockout && isDraw;
  const canSave = bothSet && (!needsWinner || !!tieWinner);

  const build = (): MatchResult | null => {
    if (!canSave) return null;
    const winner = sa! > sb! ? pa : sb! > sa! ? pb : match.knockout ? tieWinner : null;
    return { a: pa, b: pb, sa: sa!, sb: sb!, winner, method: needsWinner ? method : 'normal', at: prev?.at ?? Date.now() };
  };
  const draft = build();
  const impact = draft ? impactOf(t, match.id, draft) : 0;

  const save = async () => {
    if (!draft) return;
    if (impact > 0) {
      const ok = await confirm({
        title: 'Modifier ce résultat ?',
        message: `Le vainqueur change : ${impact} match${impact > 1 ? 's' : ''} déjà joué${impact > 1 ? 's' : ''} ensuite ${impact > 1 ? 'seront annulés' : 'sera annulé'}.`,
        confirm: 'Modifier', danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'setResult', id: match.id, result: draft });
    onClose();
  };

  const clear = async () => {
    const n = impactOf(t, match.id, null);
    const ok = await confirm({
      title: 'Effacer ce résultat ?',
      message: n ? `${n} match${n > 1 ? 's' : ''} joué${n > 1 ? 's' : ''} ensuite ${n > 1 ? 'seront' : 'sera'} aussi annulé${n > 1 ? 's' : ''}.` : 'Le match repassera en « à jouer ».',
      confirm: 'Effacer', danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'clearResult', id: match.id });
    onClose();
  };

  const hint = !bothSet
    ? 'Saisis le score des deux joueurs.'
    : needsWinner && !tieWinner
      ? 'Égalité : qui gagne après prolongations ou tirs au but ?'
      : null;

  return (
    <Sheet open onClose={onClose} title={matchTitle(match, res, t.format)}>
      <div className="score-sheet">
        <div className="score-grid">
          <ScoreInput label={name(pa)} value={sa} onChange={setSa} />
          <span className="score-vs">VS</span>
          <ScoreInput label={name(pb)} value={sb} onChange={setSb} />
        </div>

        {isDraw && !match.knockout && <p className="note">Match nul : 1 point chacun.</p>}

        {needsWinner && (
          <div className="tiebreak">
            <div className="seg" role="radiogroup" aria-label="Décidé aux">
              <button type="button" role="radio" aria-checked={method === 'et'} className={method === 'et' ? 'on' : ''} onClick={() => setMethod('et')}>Prolongations</button>
              <button type="button" role="radio" aria-checked={method === 'pens'} className={method === 'pens' ? 'on' : ''} onClick={() => setMethod('pens')}>Tirs au but</button>
            </div>
            <div className="tie-pick" role="radiogroup" aria-label="Vainqueur">
              {[pa, pb].map((id) => (
                <button type="button" key={id} role="radio" aria-checked={tieWinner === id} className={tieWinner === id ? 'on' : ''} onClick={() => setTieWinner(id)}>
                  {tieWinner === id && <Icon name="trophy" size={18} />}{name(id)}
                </button>
              ))}
            </div>
          </div>
        )}

        {draft && !hint && (
          <p className="verdict">
            {draft.winner ? <><b>{name(draft.winner)}</b> l’emporte{needsWinner ? (method === 'pens' ? ' aux tirs au but' : ' en prolongations') : ''}</> : 'Match nul'}
          </p>
        )}
        {hint && <p className="hint">{hint}</p>}
        {impact > 0 && <p className="warn-box">⚠ Modifier ce vainqueur annulera {impact} match{impact > 1 ? 's' : ''} déjà joué{impact > 1 ? 's' : ''}.</p>}

        <div className="sheet-actions">
          {prev && <button className="btn ghost danger-text" onClick={clear}><Icon name="trash" size={18} />Effacer</button>}
          <button className="btn primary xl" onClick={save} disabled={!canSave}><Icon name="check" />{prev ? 'Valider' : 'Valider le score'}</button>
        </div>
      </div>
    </Sheet>
  );
}
