import { useRef, useState, type FormEvent } from 'react';
import { estimateMatches, formatDuration, formatError } from '../lib/engine';
import type { Action } from '../lib/store';
import type { Format, Tournament } from '../lib/types';
import { MAX_PLAYERS, MIN_PLAYERS, MIN_PLAYERS_GROUPS } from '../lib/types';
import { FORMATS, formatLabel } from './ctx';
import { Icon, Logo, Stepper, useConfirm } from './ui';

const DURATIONS = [10, 12, 15, 20];
const DEFAULT_GAME = 'EA Sports FC 26';

/* ------------------------------------------------------------ accueil */

export function Home({ onCreate }: { onCreate: () => void }) {
  return (
    <main className="home">
      <div className="home-hero">
        <Logo size={30} />
        <h1 className="display">Une manette.<br /><em>Un seul champion.</em></h1>
        <p className="lead">Organise ton tournoi FC entre potes en moins d’une minute : tirage, tableau, scores et vainqueur, tout se fait ici.</p>
      </div>
      <ol className="home-steps">
        <li><span>1</span>Crée le tournoi</li>
        <li><span>2</span>Ajoute les joueurs</li>
        <li><span>3</span>Lance le tirage</li>
        <li><span>4</span>Saisis les scores</li>
      </ol>
      <div className="bottom-bar">
        <button className="btn primary xl" onClick={onCreate}><Icon name="plus" />Créer un tournoi</button>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ paramètres (création + édition) */

interface FormValues { name: string; game: string; format: Format; matchMinutes: number; count: number }

export function TournamentForm({ initial, playerCount, submitLabel, onSubmit, onCancel }: {
  initial?: Partial<FormValues>;
  /** Défini en édition : le nombre de joueurs vient de la liste. */
  playerCount?: number;
  submitLabel: string;
  onSubmit: (v: FormValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [game, setGame] = useState(initial?.game ?? DEFAULT_GAME);
  const [format, setFormat] = useState<Format>(initial?.format ?? 'single');
  const [matchMinutes, setMinutes] = useState(initial?.matchMinutes ?? 15);
  const [count, setCount] = useState(initial?.count ?? 8);
  const [error, setError] = useState<string | null>(null);

  const n = playerCount ?? count;
  const matches = estimateMatches(format, Math.max(n, 2));
  const fmtErr = formatError(format, n);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim() || 'Soirée FC';
    if (clean.length > 40) return setError('Le nom doit faire 40 caractères maximum.');
    if (playerCount === undefined && fmtErr) return setError(fmtErr);
    onSubmit({ name: clean, game: game.trim() || DEFAULT_GAME, format, matchMinutes, count });
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Nom du tournoi</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Soirée FC" maxLength={40} enterKeyHint="next" />
      </label>
      <label className="field">
        <span>Jeu</span>
        <input value={game} onChange={(e) => setGame(e.target.value)} maxLength={40} />
      </label>

      <fieldset className="field">
        <legend>Format</legend>
        <div className="format-grid">
          {FORMATS.map((f) => {
            const disabled = f.id === 'groups' && n < MIN_PLAYERS_GROUPS;
            return (
              <button type="button" key={f.id} className={`format-card ${format === f.id ? 'on' : ''}`} aria-pressed={format === f.id}
                onClick={() => { setFormat(f.id); setError(null); }}>
                <strong>{f.label}{f.id === 'single' && <i className="tag">Par défaut</i>}</strong>
                <small>{disabled ? `${MIN_PLAYERS_GROUPS} joueurs minimum` : f.desc}</small>
              </button>
            );
          })}
        </div>
      </fieldset>

      {playerCount === undefined && (
        <div className="field row">
          <span>Participants <small className="muted">({MIN_PLAYERS} à {MAX_PLAYERS})</small></span>
          <Stepper value={count} min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={(v) => { setCount(v); setError(null); }} label="Nombre de participants" />
        </div>
      )}

      <fieldset className="field">
        <legend>Durée d’un match</legend>
        <div className="chips">
          {DURATIONS.map((d) => (
            <button type="button" key={d} className={`chip ${matchMinutes === d ? 'on' : ''}`} aria-pressed={matchMinutes === d} onClick={() => setMinutes(d)}>{d} min</button>
          ))}
        </div>
      </fieldset>

      <div className="estimate">
        <Icon name="play" size={16} />
        {fmtErr ? <span className="warn">{fmtErr}</span> : (
          <span><b>{matches} matchs</b>{format === 'double' && ' (+1 si revanche)'} · environ <b>{formatDuration(matches * matchMinutes)}</b> sur une console</span>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="bottom-bar">
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn primary xl">{submitLabel}</button>
      </div>
    </form>
  );
}

export function CreateScreen({ dispatch, onCancel }: { dispatch: (a: Action) => void; onCancel: () => void }) {
  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={onCancel} aria-label="Retour"><Icon name="back" /></button>
        <h1 className="topbar-title">Nouveau tournoi</h1>
      </header>
      <TournamentForm submitLabel="Continuer" onSubmit={(v) => dispatch({ type: 'create', ...v })} />
    </main>
  );
}

/* ------------------------------------------------------------ joueurs */

export function validateName(name: string, t: Tournament, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Le nom ne peut pas être vide.';
  if (n.length > 20) return '20 caractères maximum.';
  if (t.players.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n.toLowerCase())) return `« ${n} » est déjà dans la liste.`;
  return null;
}

export function PlayersScreen({ t, dispatch, onSettings, onMenu, onBack }: {
  t: Tournament; dispatch: (a: Action) => void; onSettings: () => void; onMenu: () => void; onBack?: () => void;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const running = t.status === 'running';
  const n = t.players.length;
  const fmtErr = formatError(t.format, n);
  const matches = estimateMatches(t.format, Math.max(n, 2));

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (n >= MAX_PLAYERS) return setError(`${MAX_PLAYERS} joueurs maximum.`);
    const err = validateName(draft, t);
    if (err) return setError(err);
    dispatch({ type: 'addPlayer', name: draft.trim() });
    setDraft('');
    setError(null);
    addRef.current?.focus();
  };

  const startEdit = (id: string, name: string) => { setEditing(id); setEditVal(name); setEditErr(null); };
  const saveEdit = () => {
    if (!editing) return;
    const err = validateName(editVal, t, editing);
    if (err) return setEditErr(err);
    dispatch({ type: 'renamePlayer', id: editing, name: editVal.trim() });
    setEditing(null);
  };

  const remove = async (id: string, name: string) => {
    if (running) {
      const ok = await confirm({
        title: `Retirer ${name} ?`,
        message: 'Le tournoi est en cours : retirer un joueur annule le tirage et efface tous les scores. Vous devrez relancer le tirage.',
        confirm: 'Retirer et annuler le tirage', danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'removePlayer', id });
  };

  const draw = () => {
    if (fmtErr) return;
    dispatch({ type: 'draw' });
  };

  return (
    <main className="screen">
      <header className="topbar">
        {onBack && <button className="icon-btn" onClick={onBack} aria-label="Retour"><Icon name="back" /></button>}
        <div className="topbar-title stack">
          <h1>{running ? 'Joueurs' : t.name}</h1>
          {!running && <small>{t.game} · {formatLabel(t.format)}</small>}
        </div>
        {!running && <button className="icon-btn" onClick={onSettings} aria-label="Paramètres du tournoi"><Icon name="settings" /></button>}
        {!running && <button className="icon-btn" onClick={onMenu} aria-label="Plus d’actions"><Icon name="dots" /></button>}
      </header>

      <div className="section-head">
        <h2>Joueurs <span className={`count ${n < MIN_PLAYERS ? 'warn' : ''}`}>{n}/{MAX_PLAYERS}</span></h2>
        {running && <p className="muted">Renommer un joueur ne change rien au tournoi.</p>}
      </div>

      {n === 0 && <p className="empty">Aucun joueur pour l’instant. Ajoute au moins {MIN_PLAYERS} prénoms ou pseudos.</p>}

      <ul className="player-list">
        {t.players.map((p, i) => (
          <li key={p.id} className="player-row">
            <span className="player-num">{i + 1}</span>
            {editing === p.id ? (
              <form className="player-edit" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
                <input autoFocus value={editVal} maxLength={20} onChange={(e) => { setEditVal(e.target.value); setEditErr(null); }}
                  onFocus={(e) => e.target.select()} aria-label={`Nouveau nom pour ${p.name}`} aria-invalid={!!editErr} enterKeyHint="done" />
                <button type="submit" className="icon-btn accent" aria-label="Valider"><Icon name="check" /></button>
                <button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Annuler"><Icon name="x" /></button>
                {editErr && <p className="error small">{editErr}</p>}
              </form>
            ) : (
              <>
                <button className="player-name" onClick={() => startEdit(p.id, p.name)} aria-label={`Renommer ${p.name}`}>{p.name}</button>
                <button className="icon-btn" onClick={() => startEdit(p.id, p.name)} aria-label={`Modifier ${p.name}`}><Icon name="edit" size={18} /></button>
                <button className="icon-btn danger" onClick={() => remove(p.id, p.name)} aria-label={`Supprimer ${p.name}`}><Icon name="trash" size={18} /></button>
              </>
            )}
          </li>
        ))}
      </ul>

      {!running && (
        <form className="add-player" onSubmit={add}>
          <input ref={addRef} value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }}
            placeholder={n >= MAX_PLAYERS ? 'Tournoi complet' : 'Prénom ou pseudo'} maxLength={20} disabled={n >= MAX_PLAYERS}
            aria-label="Nom du joueur à ajouter" enterKeyHint="send" aria-invalid={!!error} />
          <button type="submit" className="btn primary" disabled={n >= MAX_PLAYERS || !draft.trim()}><Icon name="plus" />Ajouter</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {!running && (
        <div className="bottom-bar">
          <p className="bottom-hint">
            {fmtErr ?? <>{matches} matchs · ≈ {formatDuration(matches * t.matchMinutes)}</>}
          </p>
          <button className="btn primary xl" onClick={draw} disabled={!!fmtErr}><Icon name="shuffle" />Lancer le tirage</button>
        </div>
      )}
    </main>
  );
}
