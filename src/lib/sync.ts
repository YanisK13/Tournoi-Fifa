import { reducer, type Action } from './store';
import { isTournament } from './store';
import type { Tournament } from './types';

/* ------------------------------------------------------------ accès API */

export type PutResult = { status: 'ok'; v: number } | { status: 'conflict'; v: number; t: Tournament } | { status: 'forbidden' } | { status: 'missing' };
export type UndoResult = { status: 'ok'; v: number; t: Tournament } | { status: 'conflict'; v: number; t: Tournament } | { status: 'forbidden' } | { status: 'empty' } | { status: 'missing' };
export interface Fetched { v: number; t: Tournament; protected?: boolean; admin?: boolean }

export interface Api {
  create(t: Tournament): Promise<{ id: string; v: number; key?: string }>;
  get(id: string, since?: number, key?: string): Promise<Fetched | 'unchanged' | null>;
  put(id: string, base: number, t: Tournament, key?: string): Promise<PutResult>;
  undo?(id: string, base: number, key?: string): Promise<UndoResult>;
  claim?(id: string): Promise<string | null>;
}

/** Actions réservées à l'organisateur (le serveur les refuse aussi). */
const ADMIN_ONLY = new Set<Action['type']>(['update', 'addPlayer', 'renamePlayer', 'removePlayer', 'draw', 'restart']);
export const isAdminOnly = (a: Action) => ADMIN_ONLY.has(a.type);

/** Le serveur répond mais le stockage n'est pas branché (Vercel sans base Redis). */
export class NotConfiguredError extends Error {}

export function httpApi(base = '/api/tournament', fetchFn: typeof fetch = (...a) => fetch(...a)): Api {
  const call = async (path: string, init?: RequestInit, key?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['X-Admin-Key'] = key;
    const r = await fetchFn(base + path, { ...init, cache: 'no-store', headers });
    if (r.status === 503) throw new NotConfiguredError('storage_not_configured');
    if (r.status >= 500) {
      const body = await r.json().catch(() => null) as { detail?: string; error?: string } | null;
      throw new Error(`Erreur serveur ${r.status}${body?.detail ? ` : ${body.detail}` : body?.error ? ` : ${body.error}` : ''}`);
    }
    return r;
  };
  const doc = (x: unknown): Fetched => {
    const d = x as { v: number; t: unknown; protected?: boolean; admin?: boolean };
    if (!d || typeof d.v !== 'number' || !isTournament(d.t)) throw new Error('Réponse invalide');
    const out: Fetched = { v: d.v, t: d.t };
    if (typeof d.protected === 'boolean') out.protected = d.protected;
    if (typeof d.admin === 'boolean') out.admin = d.admin;
    return out;
  };
  return {
    async create(t) {
      const r = await call('', { method: 'POST', body: JSON.stringify({ t }) });
      if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    async get(id, since, key) {
      const r = await call(`?id=${encodeURIComponent(id)}${since ? `&v=${since}` : ''}`, undefined, key);
      if (r.status === 204) return 'unchanged';
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return doc(await r.json());
    },
    async put(id, b, t, key) {
      const r = await call(`?id=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ base: b, t }) }, key);
      if (r.status === 200) return { status: 'ok', v: (await r.json()).v };
      if (r.status === 409) { const d = doc(await r.json()); return { status: 'conflict', v: d.v, t: d.t }; }
      if (r.status === 403) return { status: 'forbidden' };
      if (r.status === 404) return { status: 'missing' };
      throw new Error(`HTTP ${r.status}`);
    },
    async undo(id, b, key) {
      const r = await call(`?id=${encodeURIComponent(id)}&op=undo`, { method: 'POST', body: JSON.stringify({ base: b }) }, key);
      if (r.status === 200 || r.status === 409) { const d = doc(await r.json()); return { status: r.status === 200 ? 'ok' : 'conflict', v: d.v, t: d.t }; }
      if (r.status === 403) return { status: 'forbidden' };
      if (r.status === 410) return { status: 'empty' };
      if (r.status === 404) return { status: 'missing' };
      throw new Error(`HTTP ${r.status}`);
    },
    async claim(id) {
      const r = await call(`?id=${encodeURIComponent(id)}&op=claim`, { method: 'POST', body: '{}' });
      if (r.status === 200) return (await r.json()).key as string;
      return null;
    },
  };
}

/* ------------------------------------------------------------ client temps réel */

/**
 * local   : tournoi uniquement sur cet appareil (stockage en ligne indisponible)
 * loading : ouverture d'un lien en cours
 * live    : synchronisé
 * syncing : envoi de modifications en cours
 * offline : connexion perdue, les modifications seront envoyées au retour du réseau
 * missing : lien inconnu ou expiré
 */
export type SyncStatus = 'local' | 'loading' | 'live' | 'syncing' | 'offline' | 'missing';

/** local : tournoi sur ce téléphone · admin : organisateur · player : participant (scores et club seulement) */
export type Role = 'local' | 'admin' | 'player';

export interface Snapshot {
  id: string | null;
  t: Tournament | null;
  status: SyncStatus;
  pending: number;
  role: Role;
  /** Faux pour un tournoi créé avant les clés organisateur (tout le monde peut tout faire). */
  protected: boolean;
  /** Message à afficher (le numéro change à chaque nouveau message). */
  notice: { n: number; msg: string } | null;
}

interface Persisted {
  id: string | null;
  server: { v: number; t: Tournament } | null;
  pending: Action[];
  local: Tournament | null;
  /** Clés organisateur des tournois créés (ou ouverts avec le lien organisateur) sur ce téléphone. */
  keys?: Record<string, string>;
  admin?: boolean;
  protected?: boolean;
}

export interface Persistence {
  load(): Persisted | null;
  save(p: Persisted): void;
}

export class LiveTournament {
  private id: string | null = null;
  private server: { v: number; t: Tournament } | null = null;
  private pending: Action[] = [];
  private local: Tournament | null = null;
  private status: SyncStatus = 'local';
  private flushing = false;
  private inflight: Promise<void> | null = null;
  private polling = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private keys: Record<string, string> = {};
  private admin = false;
  private isProtected = true;
  private notice: Snapshot['notice'] = null;
  /** Raison du dernier échec de mise en ligne, affichée à l'utilisateur. */
  lastError: string | null = null;

  constructor(private api: Api, private persist?: Persistence) {
    const p = persist?.load();
    if (p) {
      this.id = p.id;
      this.server = p.server;
      this.pending = p.pending ?? [];
      this.local = p.local;
      this.status = p.id ? 'offline' : 'local';
      this.keys = p.keys ?? {};
      this.admin = p.admin ?? !!(p.id && this.keys[p.id]);
      this.isProtected = p.protected ?? true;
    }
    this.snap = this.build();
  }

  /* ---- abonnement (useSyncExternalStore) */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private build(): Snapshot {
    let t: Tournament | null = this.local;
    if (this.id) {
      t = this.server?.t ?? null;
      for (const a of this.pending) t = reducer(t, a);
    }
    const role: Role = !this.id ? 'local' : this.admin ? 'admin' : 'player';
    return { id: this.id, t, status: this.status, pending: this.pending.length, role, protected: !this.id || this.isProtected, notice: this.notice };
  }

  private get key(): string | undefined {
    return this.id ? this.keys[this.id] : undefined;
  }

  /** Clé organisateur de ce tournoi (pour le lien organisateur), si ce téléphone l'a. */
  adminKey(): string | null {
    return this.key ?? null;
  }

  private say(msg: string) {
    this.notice = { n: (this.notice?.n ?? 0) + 1, msg };
    this.emit();
  }

  private emit() {
    this.snap = this.build();
    this.persist?.save({ id: this.id, server: this.server, pending: this.pending, local: this.local, keys: this.keys, admin: this.admin, protected: this.isProtected });
    this.listeners.forEach((fn) => fn());
  }

  private setStatus(s: SyncStatus) {
    if (this.status !== s) { this.status = s; this.emit(); }
  }

  /* ---- actions */

  /** Crée le tournoi et tente de le mettre en ligne. Retourne true s'il est partagé. */
  async create(a: Extract<Action, { type: 'create' }>): Promise<boolean> {
    this.leave();
    this.local = reducer(null, a);
    this.emit();
    return this.publish();
  }

  /** Met en ligne un tournoi resté local. */
  async publish(): Promise<boolean> {
    if (this.id || !this.local) return !!this.id;
    try {
      const { id, v, key } = await this.api.create(this.local);
      this.id = id;
      if (key) this.keys = { ...this.keys, [id]: key };
      this.admin = true;
      this.isProtected = !!key;
      this.server = { v, t: this.local };
      this.local = null;
      this.pending = [];
      this.status = 'live';
      this.lastError = null;
      this.emit();
      return true;
    } catch (e) {
      this.lastError = e instanceof NotConfiguredError
        ? 'Aucune base de données n’est reliée au projet Vercel (Storage → Connect, puis Redeploy).'
        : e instanceof TypeError
          ? 'Pas de connexion internet.'
          : `Le serveur a refusé la mise en ligne. ${(e as Error).message}`;
      this.setStatus('local');
      return false;
    }
  }

  dispatch = (a: Action) => {
    if (a.type === 'create') { void this.create(a); return; }
    if (a.type === 'reset') { this.leave(); return; }
    if (!this.id) {
      this.local = reducer(this.local, a);
      this.emit();
      return;
    }
    if (!this.admin && isAdminOnly(a)) {
      this.say('Seul l’organisateur du tournoi peut faire ça.');
      return;
    }
    this.pending.push(a);
    this.emit();
    void this.flush();
  };

  /** Ouvre un tournoi partagé à partir de son identifiant. */
  async open(id: string, adminKey?: string | null): Promise<void> {
    if (adminKey) this.keys = { ...this.keys, [id]: adminKey };
    if (id !== this.id) {
      this.id = id;
      this.server = null;
      this.pending = [];
      this.local = null;
      this.admin = !!this.keys[id];
      this.isProtected = true;
      this.status = 'loading';
      this.emit();
    } else if (adminKey) {
      this.server = null; // relire complètement pour connaître le rôle
    }
    await this.poll();
    void this.flush();
  }

  /** Quitte le tournoi sur cet appareil (il reste disponible pour les autres). */
  leave() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.id = null;
    this.server = null;
    this.pending = [];
    this.local = null;
    this.admin = false;
    this.isProtected = true;
    this.status = 'local';
    this.emit();
  }

  /** Récupère la dernière version publiée (appelé régulièrement). */
  async poll(): Promise<void> {
    const id = this.id!;
    if (!id || this.polling || this.flushing) return;
    this.polling = true;
    try {
      const r = await this.api.get(id, this.server?.v, this.key);
      if (id !== this.id) return;
      if (r === null) {
        if (!this.server) { this.status = 'missing'; this.emit(); }
        else this.setStatus('offline');
        return;
      }
      if (r !== 'unchanged') {
        if (!this.server || r.v > this.server.v) this.server = { v: r.v, t: r.t };
        if (typeof r.protected === 'boolean') this.isProtected = r.protected;
        if (typeof r.admin === 'boolean') this.admin = r.admin;
      }
      this.status = this.pending.length ? 'syncing' : 'live';
      this.emit();
      if (this.pending.length) void this.flush();
    } catch {
      if (id === this.id) this.setStatus('offline');
    } finally {
      this.polling = false;
    }
  }

  /** Envoie les modifications en attente, une par une, en les rejouant sur la dernière version en cas de conflit. */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.id || !this.server || !this.pending.length) return Promise.resolve();
    this.inflight = this.doFlush().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doFlush(): Promise<void> {
    this.flushing = true;
    this.setStatus('syncing');
    const id = this.id!;
    try {
      while (this.pending.length && this.server && this.id === id) {
        const next = reducer(this.server.t, this.pending[0]);
        if (!next) { this.pending.shift(); continue; }
        const r = await this.api.put(id, this.server.v, next, this.key);
        if (this.id !== id) return;
        if (r.status === 'ok') {
          this.server = { v: r.v, t: next };
          this.pending.shift();
        } else if (r.status === 'conflict') {
          // Quelqu'un a modifié entre-temps : on repart de sa version et on rejoue notre action dessus.
          this.server = { v: r.v, t: r.t };
        } else if (r.status === 'forbidden') {
          this.pending.shift();
          this.admin = false;
          this.notice = { n: (this.notice?.n ?? 0) + 1, msg: 'Seul l’organisateur du tournoi peut faire ça.' };
        } else {
          this.pending = [];
          this.status = 'missing';
          this.emit();
          return;
        }
        this.emit();
      }
      this.status = 'live';
      this.emit();
    } catch {
      this.setStatus('offline');
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => void this.flush(), 3000);
    } finally {
      this.flushing = false;
    }
  }

  /** Organisateur : revient à la version d'avant la dernière modification (de n'importe qui). */
  async undo(): Promise<void> {
    if (!this.id || !this.api.undo) return;
    await this.flush();
    const id = this.id;
    try {
      for (let attempt = 0; attempt < 3 && this.server && this.id === id; attempt++) {
        const r = await this.api.undo(id, this.server.v, this.key);
        if (this.id !== id) return;
        if (r.status === 'ok') { this.server = { v: r.v, t: r.t }; this.say('Dernière action annulée.'); return; }
        if (r.status === 'conflict') { this.server = { v: r.v, t: r.t }; continue; }
        if (r.status === 'empty') { this.say('Rien d’autre à annuler.'); return; }
        if (r.status === 'forbidden') { this.admin = false; this.say('Seul l’organisateur du tournoi peut annuler.'); return; }
        this.status = 'missing'; this.emit(); return;
      }
      this.say('Le tournoi bouge trop vite, réessaie.');
    } catch {
      this.say('Annulation impossible : vérifie ta connexion.');
    }
  }

  /** Tournoi créé avant les clés : ce téléphone en devient l'organisateur. */
  async claim(): Promise<boolean> {
    if (!this.id || !this.api.claim) return false;
    const id = this.id;
    try {
      const key = await this.api.claim(id);
      if (!key) { this.isProtected = true; this.admin = false; this.say('Un autre téléphone est déjà organisateur.'); return false; }
      this.keys = { ...this.keys, [id]: key };
      this.admin = true;
      this.isProtected = true;
      this.say('Tournoi protégé : tu es l’organisateur.');
      return true;
    } catch {
      this.say('Impossible pour l’instant : vérifie ta connexion.');
      return false;
    }
  }
}

/* ------------------------------------------------------------ persistance navigateur */

const KEY = 'fc-tournament:v2';
const OLD_KEY = 'fc-tournament:v1';

export const browserPersistence: Persistence = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Persisted;
      // Reprise d'un tournoi créé avec la première version (local uniquement).
      const old = localStorage.getItem(OLD_KEY);
      const t = old ? JSON.parse(old) : null;
      return isTournament(t) ? { id: null, server: null, pending: [], local: t } : null;
    } catch {
      return null;
    }
  },
  save(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
      localStorage.removeItem(OLD_KEY);
    } catch {
      /* stockage indisponible : l'appli fonctionne quand même */
    }
  },
};
