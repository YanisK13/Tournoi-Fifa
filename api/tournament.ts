/**
 * API du tournoi partagé (fonction Vercel).
 *
 *   POST /api/tournament              { t }          → 201 { id, v }
 *   GET  /api/tournament?id=…&v=…                    → 200 { v, t } | 204 (pas de changement) | 404
 *   PUT  /api/tournament?id=…         { base, t }    → 200 { v } | 409 { v, t } (version périmée) | 404
 *
 * Chaque écriture précise la version sur laquelle elle s'appuie : si quelqu'un a modifié
 * le tournoi entre-temps, le serveur refuse (409) et renvoie la version à jour, que le
 * client ré-applique avant de renvoyer. Aucune saisie n'est perdue.
 *
 * Stockage : Redis Upstash (variables KV_REST_API_URL / KV_REST_API_TOKEN ajoutées par Vercel),
 * ou en mémoire pour le développement local.
 */

export interface Doc { v: number; t: unknown }
export type CasResult = { status: 'ok'; v: number } | { status: 'conflict'; doc: Doc } | { status: 'missing' };

export interface Store {
  get(id: string): Promise<Doc | null>;
  create(id: string, data: string): Promise<boolean>;
  cas(id: string, base: number, data: string): Promise<CasResult>;
}

const TTL_SECONDS = 60 * 60 * 24 * 30; // un tournoi inactif est effacé au bout de 30 jours
const MAX_BODY = 400_000;
const ID_RE = /^[a-z0-9]{6,16}$/;
const key = (id: string) => `fct:${id}`;

/* ------------------------------------------------------------ stockage mémoire (dev / tests) */

export function memoryStore(): Store {
  const m = new Map<string, { v: number; d: string }>();
  return {
    async get(id) {
      const e = m.get(id);
      return e ? { v: e.v, t: JSON.parse(e.d) } : null;
    },
    async create(id, data) {
      if (m.has(id)) return false;
      m.set(id, { v: 1, d: data });
      return true;
    },
    async cas(id, base, data) {
      const e = m.get(id);
      if (!e) return { status: 'missing' };
      if (e.v !== base) return { status: 'conflict', doc: { v: e.v, t: JSON.parse(e.d) } };
      m.set(id, { v: e.v + 1, d: data });
      return { status: 'ok', v: e.v + 1 };
    },
  };
}

/* ------------------------------------------------------------ stockage Redis (Upstash REST) */

const CREATE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'v', '1', 'd', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

const CAS_LUA = `
local v = redis.call('HGET', KEYS[1], 'v')
if not v then return {'missing'} end
if v ~= ARGV[1] then return {'conflict', v, redis.call('HGET', KEYS[1], 'd')} end
local nv = tostring(tonumber(v) + 1)
redis.call('HSET', KEYS[1], 'v', nv, 'd', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return {'ok', nv}`;

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
  return {
    async get(id) {
      const [v, d] = (await cmd(['HMGET', key(id), 'v', 'd'])) as (string | null)[];
      return v && d ? { v: Number(v), t: JSON.parse(d) } : null;
    },
    async create(id, data) {
      return Number(await cmd(['EVAL', CREATE_LUA, 1, key(id), data, TTL_SECONDS])) === 1;
    },
    async cas(id, base, data) {
      const res = (await cmd(['EVAL', CAS_LUA, 1, key(id), base, data, TTL_SECONDS])) as string[];
      if (res[0] === 'ok') return { status: 'ok', v: Number(res[1]) };
      if (res[0] === 'conflict') return { status: 'conflict', doc: { v: Number(res[1]), t: JSON.parse(res[2]) } };
      return { status: 'missing' };
    },
  };
}

/* ------------------------------------------------------------ stockage Redis classique (REDIS_URL, ex. « Redis » de Vercel Storage) */

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
  const run = async (script: string, k: string, args: (string | number)[]) =>
    (await client()).eval(script, { keys: [k], arguments: args.map(String) });
  return {
    async get(id) {
      const [v, d] = await (await client()).hmGet(key(id), ['v', 'd']);
      return v && d ? { v: Number(v), t: JSON.parse(d) } : null;
    },
    async create(id, data) {
      return Number(await run(CREATE_LUA, key(id), [data, TTL_SECONDS])) === 1;
    },
    async cas(id, base, data) {
      const res = (await run(CAS_LUA, key(id), [base, data, TTL_SECONDS])) as string[];
      if (res[0] === 'ok') return { status: 'ok', v: Number(res[1]) };
      if (res[0] === 'conflict') return { status: 'conflict', doc: { v: Number(res[1]), t: JSON.parse(res[2]) } };
      return { status: 'missing' };
    },
  };
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

function newId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function looksLikeTournament(t: unknown): boolean {
  const x = t as { name?: unknown; players?: unknown; results?: unknown };
  return !!x && typeof x === 'object' && typeof x.name === 'string' && Array.isArray(x.players) && typeof x.results === 'object';
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const b = JSON.parse(text);
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}

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

  try {
    if (req.method === 'GET') {
      if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
      const doc = await store.get(id);
      if (!doc) return json(404, { error: 'not_found' });
      const since = Number(url.searchParams.get('v'));
      if (since && since === doc.v) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      return json(200, doc);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !looksLikeTournament(body.t)) return json(400, { error: 'bad_body' });
      const data = JSON.stringify(body.t);
      for (let i = 0; i < 5; i++) {
        const nid = newId();
        if (await store.create(nid, data)) return json(201, { id: nid, v: 1 });
      }
      return json(500, { error: 'id_collision' });
    }

    if (req.method === 'PUT') {
      if (!ID_RE.test(id)) return json(400, { error: 'bad_id' });
      const body = await readBody(req);
      const base = Number(body?.base);
      if (!body || !Number.isInteger(base) || base < 1 || !looksLikeTournament(body.t)) return json(400, { error: 'bad_body' });
      const r = await store.cas(id, base, JSON.stringify(body.t));
      if (r.status === 'ok') return json(200, { v: r.v });
      if (r.status === 'conflict') return json(409, r.doc);
      return json(404, { error: 'not_found' });
    }

    return json(405, { error: 'method_not_allowed' });
  } catch (e) {
    return json(502, { error: 'storage_error', detail: String((e as Error).message ?? e) });
  }
}

export default { fetch: handle };
