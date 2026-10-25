import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BracketTab } from './components/Bracket';
import { ChampionScreen } from './components/Champion';
import { formatLabel, TournamentCtx, type Ctx } from './components/ctx';
import { MatchesTab } from './components/Matches';
import { ScoreSheet } from './components/ScoreSheet';
import { CreateScreen, Home, PlayersScreen, TournamentForm } from './components/Setup';
import { StandingsTab } from './components/Standings';
import { Icon, Logo, Sheet, useConfirm, useToast } from './components/ui';
import { consoleCount, participants, playable, resolve } from './lib/engine';
import { liveLink, organizerLink, readAdminKey, readTournamentParam, setTournamentParam, shareOrCopy } from './lib/share';
import type { Action } from './lib/store';
import { browserPersistence, httpApi, LiveTournament, type Snapshot } from './lib/sync';
import type { Tournament } from './lib/types';

type Tab = 'matches' | 'bracket' | 'standings';

const live = new LiveTournament(httpApi(), browserPersistence);
const POLL_MS = 2000;

function useLive(): Snapshot {
  const snap = useSyncExternalStore(live.subscribe, live.getSnapshot);
  useEffect(() => {
    const param = readTournamentParam();
    const adminKey = readAdminKey();
    const current = live.getSnapshot().id;
    if (param) void live.open(param, adminKey);
    else if (current) void live.open(current);
    // Rafraîchissement régulier : chaque saisie apparaît sur tous les téléphones en ~2 s.
    const iv = setInterval(() => { if (!document.hidden) void live.poll(); }, POLL_MS);
    const wake = () => { if (!document.hidden) { void live.poll(); void live.flush(); } };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, []);
  useEffect(() => setTournamentParam(snap.id), [snap.id]);
  return snap;
}

const OFFLINE_CREATE_MSG = 'Mise en ligne impossible pour l’instant : le tournoi est seulement sur ce téléphone. Réessaie avec « Partager ».';

export default function App() {
  const snap = useLive();
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const { t } = snap;

  useEffect(() => { if (!t) setCreating(false); }, [t]);
  // Messages de la synchro (action refusée, annulation…).
  useEffect(() => { if (snap.notice) toast(snap.notice.msg); }, [snap.notice?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t && snap.status === 'loading') {
    return (
      <main className="home center-screen">
        <Logo size={30} />
        <div className="spinner" aria-hidden="true" />
        <p className="muted">Chargement du tournoi…</p>
      </main>
    );
  }

  if (snap.status === 'missing') {
    return (
      <main className="home center-screen">
        <Logo size={30} />
        <h1 className="display small-display">Tournoi introuvable</h1>
        <p className="muted">Ce lien ne correspond à aucun tournoi. Il a peut-être expiré (30 jours sans activité).</p>
        <button className="btn primary xl grow-0" onClick={() => { live.leave(); setCreating(true); }}><Icon name="plus" />Créer un tournoi</button>
      </main>
    );
  }

  if (!t && !snap.id) {
    const dispatch = (a: Action) => {
      if (a.type === 'create') void live.create(a).then((ok) => { if (!ok) toast(`${OFFLINE_CREATE_MSG} ${live.lastError ?? ''}`); });
      else live.dispatch(a);
    };
    return creating ? <CreateScreen dispatch={dispatch} onCancel={() => setCreating(false)} /> : <Home onCreate={() => setCreating(true)} />;
  }

  if (!t) {
    return (
      <main className="home center-screen">
        <Logo size={30} />
        <p className="muted">Connexion impossible. Vérifie ta connexion internet.</p>
        <button className="btn ghost grow-0" onClick={() => live.leave()}>Retour à l’accueil</button>
      </main>
    );
  }

  return <TournamentView t={t} snap={snap} dispatch={live.dispatch} />;
}

function LiveBadge({ snap, onPublish }: { snap: Snapshot; onPublish: () => void }) {
  if (snap.status === 'local') {
    return <button className="live-badge local" onClick={onPublish} title="Mettre le tournoi en ligne">Non partagé</button>;
  }
  const label = { live: 'En direct', syncing: 'Envoi…', offline: 'Hors ligne', loading: 'Connexion…', missing: 'Introuvable' }[snap.status];
  const title = snap.status === 'offline' ? 'Tes saisies seront envoyées dès le retour du réseau.' : 'Les scores sont partagés en temps réel avec tous ceux qui ont le lien.';
  return (
    <>
      <span className={`live-badge ${snap.status}`} title={title} role="status"><i />{label}</span>
      {snap.protected && <span className={`role-chip ${snap.role}`}>{snap.role === 'player' ? 'Participant' : 'Organisateur'}</span>}
    </>
  );
}

function TournamentView({ t, snap, dispatch }: { t: Tournament; snap: Snapshot; dispatch: (a: Action) => void }) {
  const res = useMemo(() => resolve(t.status === 'running' ? t : { ...t, seeds: [], groups: [], results: {} }), [t]);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('matches');
  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [players, setPlayers] = useState(false);
  const [showChamp, setShowChamp] = useState(false);
  const prevChamp = useRef(res.champion);
  const shared = !!snap.id;
  const canManage = snap.role !== 'player';
  const everyone = shared ? ' Ce changement s’applique pour tous les participants.' : '';

  useEffect(() => {
    if (res.champion && res.champion !== prevChamp.current) setShowChamp(true);
    if (!res.champion) setShowChamp(false);
    prevChamp.current = res.champion;
  }, [res.champion]);

  useEffect(() => { if (t.status === 'setup') { setPlayers(false); setTab('matches'); } }, [t.status]);

  const openMatch = useCallback((id: string) => setOpenId(id), []);
  const ctx: Ctx = { t, res, dispatch, openMatch };
  const nameOf = (id: string) => participants(t).find((p) => p.id === id)?.name ?? '?';

  const publish = async () => {
    const ok = await live.publish();
    toast(ok ? 'Tournoi en ligne : partage le lien !' : `Mise en ligne impossible. ${live.lastError ?? ''}`);
    return ok;
  };

  const share = async () => {
    setMenu(false);
    if (!live.getSnapshot().id && !(await publish())) return;
    const id = live.getSnapshot().id!;
    const all = playable(res);
    const done = all.filter((m) => m.state === 'done').length;
    const text = res.champion
      ? `🏆 ${nameOf(res.champion)} remporte « ${t.name} » !`
      : t.status === 'setup'
        ? `Rejoins « ${t.name} » et suis le tournoi en direct :`
        : `« ${t.name} » en direct (${done}/${all.length} matchs joués). Suis les scores et saisis tes résultats ici :`;
    const out = await shareOrCopy(t.name, text, liveLink(id));
    if (out === 'copied') toast('Lien copié : colle-le dans WhatsApp');
    if (out === 'failed') toast('Impossible de partager depuis ce navigateur.');
  };

  const restart = async () => {
    setMenu(false);
    const ok = await confirm({
      title: 'Recommencer le tournoi ?',
      message: `Les mêmes joueurs sont conservés, mais le tirage et tous les scores seront effacés.${everyone}`,
      confirm: 'Recommencer', danger: true,
    });
    if (ok) { setShowChamp(false); dispatch({ type: 'restart' }); }
  };

  const newTournament = async () => {
    setMenu(false);
    const ok = await confirm(shared ? {
      title: 'Quitter ce tournoi ?',
      message: `« ${t.name} » disparaît de ce téléphone, mais reste accessible aux autres avec le lien.`,
      confirm: 'Quitter',
    } : {
      title: 'Nouveau tournoi ?',
      message: `« ${t.name} », ses joueurs et ses scores seront définitivement supprimés de cet appareil.`,
      confirm: 'Tout supprimer', danger: true,
    });
    if (ok) dispatch({ type: 'reset' });
  };

  const undo = async () => {
    setMenu(false);
    const ok = await confirm({
      title: 'Annuler la dernière action ?',
      message: 'Le tournoi revient à l’état d’avant la dernière modification (score, tirage, recommencer…), pour tout le monde.',
      confirm: 'Annuler l’action',
    });
    if (ok) await live.undo();
  };

  const copyOrganizerLink = async () => {
    setMenu(false);
    const key = live.adminKey();
    if (!snap.id || !key) return;
    const ok = await confirm({
      title: 'Lien organisateur',
      message: 'Ce lien donne tous les droits sur le tournoi. Ouvre-le sur ton autre téléphone, mais ne l’envoie pas dans le groupe.',
      confirm: 'Copier le lien',
    });
    if (!ok) return;
    try {
      await navigator.clipboard.writeText(organizerLink(snap.id, key));
      toast('Lien organisateur copié');
    } catch {
      const out = await shareOrCopy(t.name, 'Lien organisateur (ne pas partager) :', organizerLink(snap.id, key));
      if (out === 'failed') toast('Copie impossible depuis ce navigateur.');
    }
  };

  const claim = async () => {
    setMenu(false);
    const ok = await confirm({
      title: 'Devenir organisateur ?',
      message: 'Ce tournoi a été créé avant le mode organisateur : tout le monde peut tout modifier. Si tu le protèges, toi seul pourras tirer au sort, recommencer ou changer les joueurs. Les autres pourront toujours saisir les scores.',
      confirm: 'Protéger le tournoi',
    });
    if (ok) await live.claim();
  };

  const saveSettings = async (v: { name: string; game: string; format: Tournament['format']; matchMinutes: number; consoles: number; mode: Tournament['mode'] }) => {
    if (t.status === 'running' && (v.format !== t.format || (v.mode ?? '1v1') !== (t.mode ?? '1v1'))) {
      const ok = await confirm({
        title: v.format !== t.format ? 'Changer de format ?' : 'Changer de mode de jeu ?',
        message: `Le tirage et tous les scores seront effacés. Il faudra relancer le tirage.${everyone}`,
        confirm: 'Changer de format', danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'update', patch: v });
    setSettings(false);
  };

  const openMatchObj = openId ? res.byId.get(openId) : undefined;
  const canEdit = openMatchObj && (openMatchObj.state === 'ready' || openMatchObj.state === 'done');
  const badge = <LiveBadge snap={snap} onPublish={() => void publish()} />;

  const sheets = (
    <>
      <Sheet open={menu} onClose={() => setMenu(false)} title="Tournoi">
        <div className="menu">
          <button className="menu-item" onClick={share}><Icon name="share" />Partager le lien du tournoi</button>
          {t.status === 'running' && <button className="menu-item" onClick={() => { setMenu(false); setPlayers(true); }}><Icon name="users" />{canManage ? 'Joueurs' : 'Joueurs et clubs'}</button>}
          {canManage && <button className="menu-item" onClick={() => { setMenu(false); setSettings(true); }}><Icon name="settings" />Paramètres</button>}
          {canManage && shared && <button className="menu-item" onClick={undo}><Icon name="back" />Annuler la dernière action</button>}
          {canManage && t.status === 'running' && <button className="menu-item" onClick={restart}><Icon name="reset" />Recommencer (mêmes joueurs)</button>}
          {canManage && shared && snap.protected && live.adminKey() && <button className="menu-item" onClick={copyOrganizerLink}><Icon name="users" />Lien organisateur (2e téléphone)</button>}
          {shared && !snap.protected && <button className="menu-item" onClick={claim}><Icon name="settings" />Devenir organisateur (protéger le tournoi)</button>}
          {!canManage && <p className="menu-note">Tu es participant : tu peux saisir les scores et choisir ton club. Le reste est géré par l’organisateur.</p>}
          <button className="menu-item danger" onClick={newTournament}>
            <Icon name={shared ? 'back' : 'trash'} />{shared ? 'Quitter ce tournoi' : 'Supprimer et créer un nouveau tournoi'}
          </button>
        </div>
      </Sheet>
      <Sheet open={settings} onClose={() => setSettings(false)} title="Paramètres">
        <TournamentForm
          initial={{ ...t, consoles: consoleCount(t), mode: t.mode ?? '1v1' }} playerCount={t.players.length} submitLabel="Enregistrer"
          onSubmit={saveSettings} onCancel={() => setSettings(false)}
        />
      </Sheet>
    </>
  );

  if (t.status === 'setup' || players) {
    return (
      <TournamentCtx.Provider value={ctx}>
        <PlayersScreen t={t} dispatch={dispatch} onSettings={() => setSettings(true)} onMenu={() => setMenu(true)}
          onShare={share} badge={badge} shared={shared} canManage={canManage}
          onBack={players ? () => setPlayers(false) : undefined} />
        {sheets}
      </TournamentCtx.Provider>
    );
  }

  return (
    <TournamentCtx.Provider value={ctx}>
      <main className="screen running">
        <header className="topbar">
          <div className="topbar-title stack">
            <h1>{t.name}</h1>
            <small>{badge}{t.mode === '2v2' ? `2v2 · ${participants(t).length} duos` : `${formatLabel(t.format)} · ${t.players.length} joueurs`}{consoleCount(t) > 1 ? ` · ${consoleCount(t)} consoles` : ''}</small>
          </div>
          <button className="icon-btn" onClick={share} aria-label="Partager"><Icon name="share" /></button>
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu du tournoi"><Icon name="dots" /></button>
        </header>

        {tab === 'matches' && <MatchesTab onChampion={() => setShowChamp(true)} />}
        {tab === 'bracket' && <BracketTab />}
        {tab === 'standings' && <StandingsTab />}

        <nav className="tabbar" aria-label="Sections">
          {([
            ['matches', 'Matchs', 'list'],
            ['bracket', t.format === 'league' ? 'Journées' : 'Tableau', 'bracket'],
            ['standings', 'Classement', 'chart'],
          ] as const).map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); window.scrollTo(0, 0); }}>
              <Icon name={icon} size={22} /><span>{label}</span>
            </button>
          ))}
        </nav>
      </main>

      {openMatchObj && canEdit && <ScoreSheet key={openMatchObj.id} match={openMatchObj} onClose={() => setOpenId(null)} />}
      {showChamp && res.champion && (
        <ChampionScreen
          onClose={() => { setShowChamp(false); setTab('bracket'); }}
          onShare={share}
          onReplay={canManage ? restart : undefined}
          onNew={newTournament}
        />
      )}
      {sheets}
    </TournamentCtx.Provider>
  );
}
