import { reducer, type Action } from './store';
import { isTournament } from './store';
import type { Tournament } from './types';

/* ------------------------------------------------------------ accès API */

export type PutResult = { status: 'ok'; v: number } | { status: 'conflict'; v: number; t: Tournament } | { status: 'missing' };

export interface Api {
  create(t: Tournament): Promise<{ id: string; v: number }>;
  get(id: string, since?: number): Promise<{ v: number; t: Tournament } | 'unchanged' | null>;
  put(id: string, base: number, t: Tournament): Promise<PutResult>;
}

/** Le serveur répond mais le stockage n'est pas branché (Vercel sans base Redis). */
export class NotConfiguredError extends Error {}

export function httpApi(base = '/api/tournament', fetchFn: typeof fetch = (...a) => fetch(...a)): Api {
  const call = async (path: string, init?: RequestInit) => {
    const r = await fetchFn(base + path, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
    if (r.status === 503) throw new NotConfiguredError('storage_not_configured');
    return r;
  };
  const doc = (x: unknown): { v: number; t: Tournament } => {
    const d = x as { v: number; t: unknown };
    if (!d || typeof d.v !== 'number' || !isTournament(d.t)) throw new Error('Réponse invalide');
    return { v: d.v, t: d.t };
  };
  return {
    async create(t) {
      const r = await call('', { method: 'POST', body: JSON.stringify({ t }) });
      if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    async get(id, since) {
      const r = await call(`?id=${encodeURIComponent(id)}${since ? `&v=${since}` : ''}`);
      if (r.status === 204) return 'unchanged';
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return doc(await r.json());
    },
    async put(id, b, t) {
      const r = await call(`?id=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ base: b, t }) });
      if (r.status === 200) return { status: 'ok', v: (await r.json()).v };
      if (r.status === 409) return { status: 'conflict', ...doc(await r.json()) };
      if (r.status === 404) return { status: 'missing' };
      throw new Error(`HTTP ${r.status}`);
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

export interface Snapshot {
  id: string | null;
  t: Tournament | null;
  status: SyncStatus;
  pending: number;
}

interface Persisted {
  id: string | null;
  server: { v: number; t: Tournament } | null;
  pending: Action[];
  local: Tournament | null;
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

  constructor(private api: Api, private persist?: Persistence) {
    const p = persist?.load();
    if (p) {
      this.id = p.id;
      this.server = p.server;
      this.pending = p.pending ?? [];
      this.local = p.local;
      this.status = p.id ? 'offline' : 'local';
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
    return { id: this.id, t, status: this.status, pending: this.pending.length };
  }

  private emit() {
    this.snap = this.build();
    this.persist?.save({ id: this.id, server: this.server, pending: this.pending, local: this.local });
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
      const { id, v } = await this.api.create(this.local);
      this.id = id;
      this.server = { v, t: this.local };
      this.local = null;
      this.pending = [];
      this.status = 'live';
      this.emit();
      return true;
    } catch {
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
    this.pending.push(a);
    this.emit();
    void this.flush();
  };

  /** Ouvre un tournoi partagé à partir de son identifiant. */
  async open(id: string): Promise<void> {
    if (id !== this.id) {
      this.id = id;
      this.server = null;
      this.pending = [];
      this.local = null;
      this.status = 'loading';
      this.emit();
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
    this.status = 'local';
    this.emit();
  }

  /** Récupère la dernière version publiée (appelé régulièrement). */
  async poll(): Promise<void> {
    const id = this.id!;
    if (!id || this.polling || this.flushing) return;
    this.polling = true;
    try {
      const r = await this.api.get(id, this.server?.v);
      if (id !== this.id) return;
      if (r === null) {
        if (!this.server) { this.status = 'missing'; this.emit(); }
        else this.setStatus('offline');
        return;
      }
      if (r !== 'unchanged' && (!this.server || r.v > this.server.v)) this.server = r;
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
        const r = await this.api.put(id, this.server.v, next);
        if (this.id !== id) return;
        if (r.status === 'ok') {
          this.server = { v: r.v, t: next };
          this.pending.shift();
        } else if (r.status === 'conflict') {
          // Quelqu'un a modifié entre-temps : on repart de sa version et on rejoue notre action dessus.
          this.server = { v: r.v, t: r.t };
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
