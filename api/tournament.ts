/**
 * API du tournoi partagé (fonction Vercel).
 *
 *   POST /api/tournament                 { t }        → 201 { id, v, key }  (key = clé organisateur, à garder secrète)
 *   GET  /api/tournament?id=…&v=…                     → 200 { v, t, protected, admin } | 204 (pas de changement) | 404
 *   PUT  /api/tournament?id=…            { base, t }  → 200 { v } | 409 { v, t } | 403 (réservé à l'organisateur) | 404
 *   POST /api/tournament?id=…&op=undo    { base }     → 200 { v, t } | 409 | 403 | 410 (rien à annuler)
 *   POST /api/tournament?id=…&op=claim                → 200 { key } | 403 (déjà protégé)
 *
 * La clé organisateur s'envoie dans l'en-tête X-Admin-Key. Sans elle, une modification n'est
 * acceptée que si elle touche uniquement les scores, la répartition des consoles et le club
 * des joueurs. Le serveur garde les 30 versions précédentes pour pouvoir annuler.
 *
 * Chaque écriture précise la version sur laquelle elle s'appuie : si quelqu'un a modifié
 * le tournoi entre-temps, le serveur refuse (409) et renvoie la version à jour, que le
 * client ré-applique avant de renvoyer. Aucune saisie n'est perdue.
 *
 * Stockage : Redis (Upstash REST ou REDIS_URL), ou en mémoire pour le développement local.
 */

export interface Doc { v: number; t: unknown }
export interface StoredDoc extends Doc { k: string | null }
export type CasResult = { status: 'ok'; v: number } | { status: 'conflict'; doc: Doc } | { status: 'missing' };
export type UndoResult = { status: 'ok'; v: number; t: unknown } | { status: 'conflict'; doc: Doc } | { status: 'empty' } | { status: 'missing' };

export interface Store {
  get(id: string): Promise<StoredDoc | null>;
  create(id: string, data: string, adminKey: string): Promise<boolean>;
  cas(id: string, base: number, data: string): Promise<CasResult>;
  undo(id: string, base: number): Promise<UndoResult>;
  claim(id: string, adminKey: string): Promise<'ok' | 'taken' | 'missing'>;
}

const TTL_SECONDS = 60 * 60 * 24 * 30; // un tournoi inactif est effacé au bout de 30 jours
const HISTORY = 30;
const MAX_BODY = 400_000;
const ID_RE = /^[a-z0-9]{6,16}$/;
const key = (id: string) => `fct:${id}`;

/* ------------------------------------------------------------ stockage mémoire (dev / tests) */

export function memoryStore(): Store {
  const m = new Map<string, { v: number; d: string; k: string | null; h: string[] }>();
  return {
    async get(id) {
      const e = m.get(id);
      return e ? { v: e.v, t: JSON.parse(e.d), k: e.k } : null;
    },
    async create(id, data, adminKey) {
      if (m.has(id)) return false;
      m.set(id, { v: 1, d: data, k: adminKey, h: [] });
      return true;
    },
    async cas(id, base, data) {
      const e = m.get(id);
      if (!e) return { status: 'missing' };
      if (e.v !== base) return { status: 'conflict', doc: { v: e.v, t: JSON.parse(e.d) } };
      e.h.push(e.d);
      if (e.h.length > HISTORY) e.h.shift();
      e.v += 1;
      e.d = data;
      return { status: 'ok', v: e.v };
    },
    async undo(id, base) {
      const e = m.get(id);
      if (!e) return { status: 'missing' };
      if (e.v !== base) return { status: 'conflict', doc: { v: e.v, t: JSON.parse(e.d) } };
      const prev = e.h.pop();
      if (prev === undefined) return { status: 'empty' };
      e.v += 1;
      e.d = prev;
      return { status: 'ok', v: e.v, t: JSON.parse(prev) };
    },
    async claim(id, adminKey) {
      const e = m.get(id);
      if (!e) return 'missing';
      if (e.k) return 'taken';
      e.k = adminKey;
      return 'ok';
    },
  };
}

/* ------------------------------------------------------------ stockage Redis
 * Tout tient dans un seul hash par tournoi : v (version), d (données), k (clé organisateur),
 * et l'historique en anneau h0…h29 (hp = prochaine case, hc = nombre de versions gardées).
 */

const CREATE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'v', '1', 'd', ARGV[1], 'k', ARGV[3], 'hp', '0', 'hc', '0')
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

const CAS_LUA = `
local v = redis.call('HGET', KEYS[1], 'v')
if not v then return {'missing'} end
if v ~= ARGV[1] then return {'conflict', v, redis.call('HGET', KEYS[1], 'd')} end
local max = tonumber(ARGV[4])
local hp = tonumber(redis.call('HGET', KEYS[1], 'hp') or '0')
local hc = tonumber(redis.call('HGET', KEYS[1], 'hc') or '0')
redis.call('HSET', KEYS[1], 'h' .. hp, redis.call('HGET', KEYS[1], 'd'))
hp = (hp + 1) % max
if hc < max then hc = hc + 1 end
local nv = tostring(tonumber(v) + 1)
redis.call('HSET', KEYS[1], 'v', nv, 'd', ARGV[2], 'hp', tostring(hp), 'hc', tostring(hc))
redis.call('EXPIRE', KEYS[1], ARGV[3])
return {'ok', nv}`;

const UNDO_LUA = `
local v = redis.call('HGET', KEYS[1], 'v')
if not v then return {'missing'} end
if v ~= ARGV[1] then return {'conflict', v, redis.call('HGET', KEYS[1], 'd')} end
local max = tonumber(ARGV[3])
local hp = tonumber(redis.call('HGET', KEYS[1], 'hp') or '0')
local hc = tonumber(redis.call('HGET', KEYS[1], 'hc') or '0')
if hc == 0 then return {'empty'} end
local idx = (hp - 1 + max) % max
local prev = redis.call('HGET', KEYS[1], 'h' .. idx)
if not prev then return {'empty'} end
redis.call('HDEL', KEYS[1], 'h' .. idx)
local nv = tostring(tonumber(v) + 1)
redis.call('HSET', KEYS[1], 'v', nv, 'd', prev, 'hp', tostring(idx), 'hc', tostring(hc - 1))
redis.call('EXPIRE', KEYS[1], ARGV[2])
return {'ok', nv, prev}`;

const CLAIM_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 'missing' end
if redis.call('HSETNX', KEYS[1], 'k', ARGV[1]) == 1 then return 'ok' end
local k = redis.call('HGET', KEYS[1], 'k')
if k == '' then redis.call('HSET', KEYS[1], 'k', ARGV[1]) return 'ok' end
return 'taken'`;

/** Accès Redis minimal commun à Upstash (REST) et à Redis classique (TCP). */
interface Runner {
  hmget(k: string, fields: string[]): Promise<(string | null)[]>;
  eval(script: string, k: string, args: (string | number)[]): Promise<unknown>;
}

function storeFromRunner(r: Runner): Store {
  const conflict = (res: string[]): { status: 'conflict'; doc: Doc } => ({ status: 'conflict', doc: { v: Number(res[1]), t: JSON.parse(res[2]) } });
  return {
    async get(id) {
      const [v, d, k] = await r.hmget(key(id), ['v', 'd', 'k']);
      return v && d ? { v: Number(v), t: JSON.parse(d), k: k || null } : null;
    },
    async create(id, data, adminKey) {
      return Number(await r.eval(CREATE_LUA, key(id), [data, TTL_SECONDS, adminKey])) === 1;
    },
    async cas(id, base, data) {
      const res = (await r.eval(CAS_LUA, key(id), [base, data, TTL_SECONDS, HISTORY])) as string[];
      if (res[0] === 'ok') return { status: 'ok', v: Number(res[1]) };
      if (res[0] === 'conflict') return conflict(res);
      return { status: 'missing' };
    },
    async undo(id, base) {
      const res = (await r.eval(UNDO_LUA, key(id), [base, TTL_SECONDS, HISTORY])) as string[];
      if (res[0] === 'ok') return { status: 'ok', v: Number(res[1]), t: JSON.parse(res[2]) };
      if (res[0] === 'conflict') return conflict(res);
      return { status: res[0] === 'empty' ? 'empty' : 'missing' };
    },
    async claim(id, adminKey) {
      return (await r.eval(CLAIM_LUA, key(id), [adminKey])) as 'ok' | 'taken' | 'missing';
    },
  };
}

/* Upstash (REST) */
export function redisStore(url: string, token: string): Store {
  const cmd = async (args: (string | number)[]): Promise<unknown> => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
    });
    const j = (await r.json()) as { result?: unknown; error?: string };
    if (!r.ok || j.error) throw new Error(j.error ?? `Redis HTTP ${r.status}`);
    return j.result;
  };
  return storeFromRunner({
    hmget: async (k, fields) => (await cmd(['HMGET', k, ...fields])) as (string | null)[],
    eval: (script, k, args) => cmd(['EVAL', script, 1, k, ...args]),
  });
}

/* Redis classique (REDIS_URL, ex. « Redis » de Vercel Storage) */
type TcpClient = {
  hmGet(key: string, fields: string[]): Promise<(string | null)[]>;
  eval(script: string, opts: { keys: string[]; arguments: string[] }): Promise<unknown>;
};
let tcpClient: Promise<TcpClient> | null = null;

export function tcpRedisStore(url: string): Store {
  const client = (): Promise<TcpClient> => {
    if (!tcpClient) {
      tcpClient = import('redis').then(async ({ createClient }) => {
        const c = createClient({ url, socket: { connectTimeout: 5000 } });
        c.on('error', () => { tcpClient = null; });
        await c.connect();
        return c as unknown as TcpClient;
      });
      tcpClient.catch(() => { tcpClient = null; });
    }
    return tcpClient;
  };
  return storeFromRunner({
    hmget: async (k, fields) => (await client()).hmGet(k, fields),
    eval: async (script, k, args) => (await client()).eval(script, { keys: [k], arguments: args.map(String) }),
  });
}

/* ------------------------------------------------------------ droits */

type T = { players?: { id: string; name: string }[]; duos?: { id: string; a: string; b: string }[]; results?: unknown; live?: unknown };

/** JSON avec les clés triées : deux objets égaux donnent la même chaîne. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().filter((k) => (x as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

/** Ce qu'un participant sans clé n'a pas le droit de modifier. */
function protectedPart(t: T): unknown {
  return {
    ...t, results: undefined, live: undefined,
    players: (t.players ?? []).map((p) => ({ id: p.id, name: p.name })),
    // 2v2 : la composition des duos est protégée, leur club non.
    duos: t.duos ? t.duos.map((d) => ({ id: d.id, a: d.a, b: d.b })) : undefined,
  };
}

/** Vrai si le changement ne touche que les scores, les consoles et les clubs. */
export function playerMayChange(before: unknown, after: unknown): boolean {
  return canonical(protectedPart(before as T)) === canonical(protectedPart(after as T));
}

/* ------------------------------------------------------------ handler */

let override: Store | null = null;
/** Utilisé par le serveur de dev et les tests. */
export function setStore(s: Store | null) { override = s; }

function env(): Record<string, string | undefined> {
  return (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
}

/** Quel stockage est branché, d'après les variables d'environnement présentes. */
function storageKind(): 'override' | 'upstash' | 'redis' | null {
  if (override) return 'override';
  const e = env();
  if ((e.KV_REST_API_URL ?? e.UPSTASH_REDIS_REST_URL) && (e.KV_REST_API_TOKEN ?? e.UPSTASH_REDIS_REST_TOKEN)) return 'upstash';
  if (e.REDIS_URL ?? e.KV_URL) return 'redis';
  return null;
}

function getStore(): Store | null {
  const e = env();
  switch (storageKind()) {
    case 'override': return override;
    case 'upstash': return redisStore((e.KV_REST_API_URL ?? e.UPSTASH_REDIS_REST_URL)!, (e.KV_REST_API_TOKEN ?? e.UPSTASH_REDIS_REST_TOKEN)!);
    case 'redis': return tcpRedisStore((e.REDIS_URL ?? e.KV_URL)!);
    default: return null;
  }
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function randomString(len: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
const newId = () => randomString(8);
const newAdminKey = () => randomString(24);

function looksLikeTournament(t: unknown): boolean {
  const x = t as { name?: unknown; players?: unknown; results?: unknown };
  return !!x && typeof x === 'object' && typeof x.name === 'string' && Array.isArray(x.players) && typeof x.results === 'object';
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const b = JSON.parse(text || '{}');
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}

/** Organisateur : bonne clé, ou tournoi créé avant les clés (ouvert à tous). */
function isAdmin(doc: StoredDoc, req: Request): boolean {
  if (!doc.k) return true;
  const given = req.headers.get('x-admin-key') ?? '';
  if (given.length !== doc.k.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ doc.k.charCodeAt(i);
  return diff === 0;
}

const FORBIDDEN = { error: 'forbidden', message: 'Seul l’organisateur du tournoi peut faire ça.' };

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Diagnostic : /api/tournament?health=1
  if (req.method === 'GET' && url.searchParams.has('health')) {
    const kind = storageKind();
    const store = getStore();
    if (!store) return json(503, { ok: false, storage: null, error: 'storage_not_configured' });
    try {
      await store.get('healthcheck');
      return json(200, { ok: true, storage: kind });
    } catch (e) {
      return json(502, { ok: false, storage: kind, error: 'storage_error', detail: String((e as Error).message ?? e) });
    }
  }

  const store = getStore();
  if (!store) return json(503, { error: 'storage_not_configured' });
  const id = url.searchParams.get('id') ?? '';
  const op = url.searchParams.get('op');

  try {
    if (req.method === 'GET') {
      if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
      const doc = await store.get(id);
      if (!doc) return json(404, { error: 'not_found' });
      const since = Number(url.searchParams.get('v'));
      if (since && since === doc.v) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      return json(200, { v: doc.v, t: doc.t, protected: !!doc.k, admin: isAdmin(doc, req) });
    }

    if (req.method === 'POST' && !op) {
      const body = await readBody(req);
      if (!body || !looksLikeTournament(body.t)) return json(400, { error: 'bad_body' });
      const data = JSON.stringify(body.t);
      const adminKey = newAdminKey();
      for (let i = 0; i < 5; i++) {
        const nid = newId();
        if (await store.create(nid, data, adminKey)) return json(201, { id: nid, v: 1, key: adminKey });
      }
      return json(500, { error: 'id_collision' });
    }

    if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const base = Number(body?.base);
      if (!body || !Number.isInteger(base) || base < 1 || !looksLikeTournament(body.t)) return json(400, { error: 'bad_body' });
      const doc = await store.get(id);
      if (!doc) return json(404, { error: 'not_found' });
      if (doc.v !== base) return json(409, { v: doc.v, t: doc.t });
      if (!isAdmin(doc, req) && !playerMayChange(doc.t, body.t)) return json(403, FORBIDDEN);
      const r = await store.cas(id, base, JSON.stringify(body.t));
      if (r.status === 'ok') return json(200, { v: r.v });
      if (r.status === 'conflict') return json(409, r.doc);
      return json(404, { error: 'not_found' });
    }

    if (req.method === 'POST' && op === 'undo') {
      const body = await readBody(req);
      const base = Number(body?.base);
      if (!Number.isInteger(base) || base < 1) return json(400, { error: 'bad_body' });
      const doc = await store.get(id);
      if (!doc) return json(404, { error: 'not_found' });
      if (!isAdmin(doc, req)) return json(403, FORBIDDEN);
      const r = await store.undo(id, base);
      if (r.status === 'ok') return json(200, { v: r.v, t: r.t });
      if (r.status === 'conflict') return json(409, r.doc);
      if (r.status === 'empty') return json(410, { error: 'nothing_to_undo' });
      return json(404, { error: 'not_found' });
    }

    if (req.method === 'POST' && op === 'claim') {
      const adminKey = newAdminKey();
      const r = await store.claim(id, adminKey);
      if (r === 'ok') return json(200, { key: adminKey });
      if (r === 'taken') return json(403, { error: 'already_protected' });
      return json(404, { error: 'not_found' });
    }

    return json(405, { error: 'method_not_allowed' });
  } catch (e) {
    return json(502, { error: 'storage_error', detail: String((e as Error).message ?? e) });
  }
}

export default { fetch: handle };
