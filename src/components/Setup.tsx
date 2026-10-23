import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { consoleCount, estimateMatches, estimateSlots, formatDuration, formatError, maxUsefulConsoles } from '../lib/engine';
import type { Action } from '../lib/store';
import type { Format, Tournament } from '../lib/types';
import { MAX_PLAYERS, MIN_PLAYERS, MIN_PLAYERS_GROUPS, MAX_CONSOLES } from '../lib/types';
import { Crest, TeamPicker } from './Crest';
import { FORMATS, formatLabel } from './ctx';
import { Icon, Logo, Stepper, useConfirm } from './ui';

/** Durée réelle d'un match FC avec des mi-temps de 4 min (présentation et mi-temps comprises). */
export const MATCH_MINUTES = 12;
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

interface FormValues { name: string; game: string; format: Format; matchMinutes: number; count: number; consoles: number }

export function TournamentForm({ initial, playerCount, submitLabel, onSubmit, onCancel }: {
  initial?: Partial<FormValues>;
  /** Défini en édition : le nombre de joueurs vient de la liste. */
  playerCount?: number;
  submitLabel: string;
  onSubmit: (v: FormValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const game = initial?.game ?? DEFAULT_GAME;
  const [format, setFormat] = useState<Format>(initial?.format ?? 'single');
  const matchMinutes = MATCH_MINUTES;
  const [count, setCount] = useState(initial?.count ?? 8);
  const [consoles, setConsoles] = useState(initial?.consoles ?? 1);
  const [error, setError] = useState<string | null>(null);

  const n = playerCount ?? count;
  const maxConsoles = Math.min(MAX_CONSOLES, maxUsefulConsoles(n));
  const usedConsoles = Math.min(consoles, maxConsoles);
  const matches = useMemo(() => estimateMatches(format, Math.max(n, 2)), [format, n]);
  const slots = useMemo(() => estimateSlots(format, Math.max(n, 2), usedConsoles), [format, n, usedConsoles]);
  const fmtErr = formatError(format, n);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim() || 'Soirée FC';
    if (clean.length > 40) return setError('Le nom doit faire 40 caractères maximum.');
    if (playerCount === undefined && fmtErr) return setError(fmtErr);
    onSubmit({ name: clean, game: game.trim() || DEFAULT_GAME, format, matchMinutes, count, consoles: usedConsoles });
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span>Nom du tournoi</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} placeholder="Soirée FC" maxLength={40} enterKeyHint="next" />
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

      <div className="field row">
        <span>Consoles <small className="muted">(matchs en même temps)</small></span>
        <Stepper value={usedConsoles} min={1} max={maxConsoles} onChange={setConsoles} label="Nombre de consoles" />
      </div>

      <div className="field row">
        <span>Durée d’un match</span>
        <span className="fixed-duration"><b>{MATCH_MINUTES} min</b><small>mi-temps de 4 min</small></span>
      </div>

      <div className="estimate">
        <Icon name="play" size={16} />
        {fmtErr ? <span className="warn">{fmtErr}</span> : (
          <span><b>{matches} matchs</b>{format === 'double' && ' (+1 si revanche)'} · environ <b>{formatDuration(slots * matchMinutes)}</b> sur {usedConsoles > 1 ? `${usedConsoles} consoles` : 'une console'}</span>
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

export function PlayersScreen({ t, dispatch, onSettings, onMenu, onBack, onShare, badge, shared = false, canManage = true }: {
  t: Tournament; dispatch: (a: Action) => void; onSettings: () => void; onMenu: () => void; onBack?: () => void;
  onShare?: () => void; badge?: ReactNode; shared?: boolean;
  /** Faux pour un participant : il voit les joueurs et choisit son club, l'organisateur gère le reste. */
  canManage?: boolean;
}) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const pickingPlayer = t.players.find((p) => p.id === picking);
  const addRef = useRef<HTMLInputElement>(null);
  const running = t.status === 'running';
  const n = t.players.length;
  const fmtErr = formatError(t.format, n);
  const consoles = Math.min(consoleCount(t), maxUsefulConsoles(n));
  const matches = useMemo(() => estimateMatches(t.format, Math.max(n, 2)), [t.format, n]);
  const slots = useMemo(() => estimateSlots(t.format, Math.max(n, 2), consoles), [t.format, n, consoles]);

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
        message: `Le tournoi est en cours : retirer un joueur annule le tirage et efface tous les scores. Il faudra relancer le tirage.${shared ? ' Ce changement s’applique pour tous les participants.' : ''}`,
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
          {!running && <small>{badge}{formatLabel(t.format)}</small>}
        </div>
        {!running && onShare && <button className="icon-btn" onClick={onShare} aria-label="Partager"><Icon name="share" /></button>}
        {!running && canManage && <button className="icon-btn" onClick={onSettings} aria-label="Paramètres du tournoi"><Icon name="settings" /></button>}
        {!running && <button className="icon-btn" onClick={onMenu} aria-label="Plus d’actions"><Icon name="dots" /></button>}
      </header>

      <div className="section-head">
        <h2>Joueurs <span className={`count ${n < MIN_PLAYERS ? 'warn' : ''}`}>{n}/{MAX_PLAYERS}</span></h2>
        {running && canManage && <p className="muted">Renommer un joueur ne change rien au tournoi.</p>}
        {!canManage && <p className="muted">Choisis ton club en touchant le + à côté de ton nom. L’organisateur gère la liste et le tirage.</p>}
        {!running && shared && onShare && canManage && (
          <button className="invite" onClick={onShare}><Icon name="share" size={18} />Envoie le lien sur WhatsApp : chacun pourra suivre et saisir les scores.</button>
        )}
      </div>

      {n === 0 && canManage && <p className="empty">Aucun joueur pour l’instant. Ajoute au moins {MIN_PLAYERS} prénoms ou pseudos.</p>}

      <ul className="player-list">
        {t.players.map((p, i) => (
          <li key={p.id} className="player-row">
            <span className="player-num">{i + 1}</span>
            <button className={`crest-btn ${p.team ? '' : 'empty'}`} onClick={() => setPicking(p.id)} aria-label={p.team ? `Changer le club de ${p.name} (${p.team.name})` : `Choisir le club de ${p.name}`}>
              {p.team ? <Crest team={p.team} size={34} /> : <Icon name="plus" size={18} />}
            </button>
            {editing === p.id ? (
              <form className="player-edit" onSubmit={(e) => { e.preventDefault(); saveEdit(); }}>
                <input autoFocus value={editVal} maxLength={20} onChange={(e) => { setEditVal(e.target.value); setEditErr(null); }}
                  onFocus={(e) => e.target.select()} aria-label={`Nouveau nom pour ${p.name}`} aria-invalid={!!editErr} enterKeyHint="done" />
                <button type="submit" className="icon-btn accent" aria-label="Valider"><Icon name="check" /></button>
                <button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="Annuler"><Icon name="x" /></button>
                {editErr && <p className="error small">{editErr}</p>}
              </form>
            ) : canManage ? (
              <>
                <button className="player-name" onClick={() => startEdit(p.id, p.name)} aria-label={`Renommer ${p.name}`}>
                  {p.name}
                  <small className={p.team ? '' : 'add-club'}>{p.team ? p.team.name : 'Choisir son club'}</small>
                </button>
                <button className="icon-btn" onClick={() => startEdit(p.id, p.name)} aria-label={`Modifier ${p.name}`}><Icon name="edit" size={18} /></button>
                <button className="icon-btn danger" onClick={() => remove(p.id, p.name)} aria-label={`Supprimer ${p.name}`}><Icon name="trash" size={18} /></button>
              </>
            ) : (
              <button className="player-name" onClick={() => setPicking(p.id)} aria-label={`Choisir le club de ${p.name}`}>
                {p.name}
                <small className={p.team ? '' : 'add-club'}>{p.team ? p.team.name : 'Choisir son club'}</small>
              </button>
            )}
          </li>
        ))}
      </ul>

      {!running && canManage && (
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
            {fmtErr ?? <>{matches} matchs · ≈ {formatDuration(slots * MATCH_MINUTES)}{consoles > 1 ? ` sur ${consoles} consoles` : ''}</>}
          </p>
          {canManage
            ? <button className="btn primary xl" onClick={draw} disabled={!!fmtErr}><Icon name="shuffle" />Lancer le tirage</button>
            : <p className="waiting"><span className="spinner tiny" />En attente du tirage par l’organisateur…</p>}
        </div>
      )}
      {pickingPlayer && (
        <TeamPicker playerName={pickingPlayer.name} current={pickingPlayer.team}
          onPick={(team) => { dispatch({ type: 'setTeam', id: pickingPlayer.id, team }); setPicking(null); }}
          onClose={() => setPicking(null)} />
      )}
    </main>
  );
}
