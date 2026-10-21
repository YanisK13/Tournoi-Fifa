import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BracketTab } from './components/Bracket';
import { ChampionScreen } from './components/Champion';
import { formatLabel, TournamentCtx, type Ctx } from './components/ctx';
import { MatchesTab } from './components/Matches';
import { ScoreSheet } from './components/ScoreSheet';
import { CreateScreen, Home, PlayersScreen, TournamentForm } from './components/Setup';
import { StandingsTab } from './components/Standings';
import { Icon, Sheet, useConfirm, useToast } from './components/ui';
import { playable, resolve } from './lib/engine';
import { clearHash, decodeTournament, readSharedCode, shareLink, shareOrCopy } from './lib/share';
import { useTournament, type Action } from './lib/store';
import type { Tournament } from './lib/types';

type Tab = 'matches' | 'bracket' | 'standings';

export default function App() {
  const [t, dispatch] = useTournament();
  const [creating, setCreating] = useState(false);
  const [incoming, setIncoming] = useState<Tournament | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  // Ouverture d'un lien de partage.
  useEffect(() => {
    const code = readSharedCode();
    if (!code) return;
    clearHash();
    decodeTournament(code).then((shared) => {
      if (!shared) return toast('Ce lien de partage est invalide ou incomplet.');
      if (!t) {
        dispatch({ type: 'import', t: shared });
        toast(`Tournoi « ${shared.name} » ouvert`);
      } else setIncoming(shared);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!incoming) return;
    confirm({
      title: `Ouvrir « ${incoming.name} » ?`,
      message: `Le tournoi partagé remplacera « ${t?.name} » sur cet appareil.`,
      confirm: 'Ouvrir le tournoi partagé',
    }).then((ok) => {
      if (ok) dispatch({ type: 'import', t: incoming });
      setIncoming(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  useEffect(() => { if (!t) setCreating(false); }, [t]);

  if (!t) return creating ? <CreateScreen dispatch={dispatch} onCancel={() => setCreating(false)} /> : <Home onCreate={() => setCreating(true)} />;
  return <TournamentView t={t} dispatch={dispatch} />;
}

function TournamentView({ t, dispatch }: { t: Tournament; dispatch: (a: Action) => void }) {
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

  useEffect(() => {
    if (res.champion && res.champion !== prevChamp.current) setShowChamp(true);
    if (!res.champion) setShowChamp(false);
    prevChamp.current = res.champion;
  }, [res.champion]);

  useEffect(() => { if (t.status === 'setup') { setPlayers(false); setTab('matches'); } }, [t.status]);

  const openMatch = useCallback((id: string) => setOpenId(id), []);
  const ctx: Ctx = { t, res, dispatch, openMatch };
  const nameOf = (id: string) => t.players.find((p) => p.id === id)?.name ?? '?';

  const share = async () => {
    setMenu(false);
    try {
      const url = await shareLink(t);
      const all = playable(res);
      const done = all.filter((m) => m.state === 'done').length;
      const text = res.champion
        ? `🏆 ${nameOf(res.champion)} remporte « ${t.name} » (${t.game}) !`
        : `« ${t.name} » sur ${t.game} : ${done}/${all.length} matchs joués. Voici le tableau :`;
      const out = await shareOrCopy(t.name, text, url);
      if (out === 'copied') toast('Lien copié : envoie-le à tes potes');
      if (out === 'failed') toast('Impossible de partager depuis ce navigateur.');
    } catch {
      toast('Impossible de générer le lien de partage.');
    }
  };

  const restart = async () => {
    setMenu(false);
    const ok = await confirm({
      title: 'Recommencer le tournoi ?',
      message: 'Les mêmes joueurs sont conservés, mais le tirage et tous les scores seront effacés.',
      confirm: 'Recommencer', danger: true,
    });
    if (ok) { setShowChamp(false); dispatch({ type: 'restart' }); }
  };

  const newTournament = async () => {
    setMenu(false);
    const ok = await confirm({
      title: 'Nouveau tournoi ?',
      message: `« ${t.name} », ses joueurs et ses scores seront définitivement supprimés de cet appareil.`,
      confirm: 'Tout supprimer', danger: true,
    });
    if (ok) dispatch({ type: 'reset' });
  };

  const saveSettings = async (v: { name: string; game: string; format: Tournament['format']; matchMinutes: number }) => {
    if (t.status === 'running' && v.format !== t.format) {
      const ok = await confirm({
        title: 'Changer de format ?',
        message: 'Le tirage et tous les scores seront effacés. Il faudra relancer le tirage.',
        confirm: 'Changer de format', danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'update', patch: v });
    setSettings(false);
  };

  const openMatchObj = openId ? res.byId.get(openId) : undefined;
  const canEdit = openMatchObj && (openMatchObj.state === 'ready' || openMatchObj.state === 'done');

  const sheets = (
    <>
      <Sheet open={menu} onClose={() => setMenu(false)} title="Tournoi">
        <div className="menu">
          {t.status === 'running' && <button className="menu-item" onClick={share}><Icon name="share" />Partager le tournoi</button>}
          {t.status === 'running' && <button className="menu-item" onClick={() => { setMenu(false); setPlayers(true); }}><Icon name="users" />Joueurs</button>}
          <button className="menu-item" onClick={() => { setMenu(false); setSettings(true); }}><Icon name="settings" />Paramètres</button>
          {t.status === 'running' && <button className="menu-item" onClick={restart}><Icon name="reset" />Recommencer (mêmes joueurs)</button>}
          <button className="menu-item danger" onClick={newTournament}><Icon name="trash" />Supprimer et créer un nouveau tournoi</button>
        </div>
      </Sheet>
      <Sheet open={settings} onClose={() => setSettings(false)} title="Paramètres">
        <TournamentForm
          initial={t} playerCount={t.players.length} submitLabel="Enregistrer"
          onSubmit={saveSettings} onCancel={() => setSettings(false)}
        />
      </Sheet>
    </>
  );

  if (t.status === 'setup' || players) {
    return (
      <TournamentCtx.Provider value={ctx}>
        <PlayersScreen t={t} dispatch={dispatch} onSettings={() => setSettings(true)} onMenu={() => setMenu(true)}
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
            <small>{t.game} · {formatLabel(t.format)} · {t.players.length} joueurs</small>
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
          onReplay={restart}
          onNew={newTournament}
        />
      )}
      {sheets}
    </TournamentCtx.Provider>
  );
}
