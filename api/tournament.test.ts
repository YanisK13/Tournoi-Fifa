import { beforeEach, describe, expect, it } from 'vitest';
import { handle, memoryStore, playerMayChange, setStore } from './tournament';

const base = () => ({
  name: 'Soirée', format: 'single', status: 'running', seeds: ['a', 'b', 'c', 'd'], groups: [], consoles: 1,
  players: [{ id: 'a', name: 'Yanis' }, { id: 'b', name: 'Momo' }, { id: 'c', name: 'Karim' }, { id: 'd', name: 'Inès' }],
  results: {}, live: { 'W1-0': 1 },
});

const call = async (method: string, path: string, body?: unknown, key?: string) => {
  const r = await handle(new Request(`http://x/api/tournament${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: key ? { 'X-Admin-Key': key } : {},
  }));
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

beforeEach(() => setStore(memoryStore()));

describe('droits du joueur sans clé', () => {
  it('peut saisir des scores, la répartition des consoles et choisir un club', () => {
    const t = base();
    expect(playerMayChange(t, { ...t, results: { 'W1-0': { sa: 1 } }, live: {} })).toBe(true);
    expect(playerMayChange(t, { ...t, players: t.players.map((p) => (p.id === 'a' ? { ...p, team: { name: 'OM' } } : p)) })).toBe(true);
  });
  it('ne peut pas recommencer, changer le format, les joueurs, les consoles ou le nom', () => {
    const t = base();
    expect(playerMayChange(t, { ...t, status: 'setup', seeds: [], results: {} })).toBe(false);
    expect(playerMayChange(t, { ...t, format: 'league' })).toBe(false);
    expect(playerMayChange(t, { ...t, players: t.players.slice(1) })).toBe(false);
    expect(playerMayChange(t, { ...t, players: t.players.map((p) => (p.id === 'a' ? { ...p, name: 'Hacker' } : p)) })).toBe(false);
    expect(playerMayChange(t, { ...t, consoles: 3 })).toBe(false);
    expect(playerMayChange(t, { ...t, name: 'Nouveau nom' })).toBe(false);
    expect(playerMayChange(t, { ...t, seeds: ['d', 'c', 'b', 'a'] })).toBe(false);
  });
  it('l’ordre des clés ne compte pas', () => {
    const t = base();
    const { results, players, ...rest } = t;
    const reordered = { results, players: players.map((p) => ({ name: p.name, id: p.id })), ...rest };
    expect(playerMayChange(t, reordered)).toBe(true);
  });
});

describe('API avec clé organisateur', () => {
  it('création : renvoie une clé, la lecture dit qui est organisateur', async () => {
    const c = await call('POST', '', { t: base() });
    expect(c.status).toBe(201);
    expect(c.body.key).toMatch(/^[a-z0-9]{24}$/);
    const asPlayer = await call('GET', `?id=${c.body.id}`);
    expect(asPlayer.body).toMatchObject({ v: 1, protected: true, admin: false });
    expect(asPlayer.body.key).toBeUndefined();
    expect(JSON.stringify(asPlayer.body)).not.toContain(c.body.key);
    const asAdmin = await call('GET', `?id=${c.body.id}`, undefined, c.body.key);
    expect(asAdmin.body.admin).toBe(true);
  });

  it('un joueur peut saisir un score mais pas recommencer le tournoi', async () => {
    const { body: { id, key } } = await call('POST', '', { t: base() });
    const score = await call('PUT', `?id=${id}`, { base: 1, t: { ...base(), results: { 'W1-0': { sa: 2 } } } });
    expect(score.status).toBe(200);
    const restart = await call('PUT', `?id=${id}`, { base: 2, t: { ...base(), status: 'setup', seeds: [], results: {} } });
    expect(restart.status).toBe(403);
    const wrongKey = await call('PUT', `?id=${id}`, { base: 2, t: { ...base(), status: 'setup' } }, 'x'.repeat(24));
    expect(wrongKey.status).toBe(403);
    const admin = await call('PUT', `?id=${id}`, { base: 2, t: { ...base(), status: 'setup' } }, key);
    expect(admin.status).toBe(200);
  });

  it('version périmée : 409 avant même de vérifier les droits', async () => {
    const { body: { id } } = await call('POST', '', { t: base() });
    await call('PUT', `?id=${id}`, { base: 1, t: { ...base(), results: { x: 1 } } });
    const r = await call('PUT', `?id=${id}`, { base: 1, t: { ...base(), results: { y: 1 } } });
    expect(r.status).toBe(409);
    expect(r.body.v).toBe(2);
  });

  it('annuler : réservé à l’organisateur, restaure la version précédente', async () => {
    const { body: { id, key } } = await call('POST', '', { t: base() });
    await call('PUT', `?id=${id}`, { base: 1, t: { ...base(), results: { 'W1-0': { sa: 2 } } } });
    expect((await call('POST', `?id=${id}&op=undo`, { base: 2 })).status).toBe(403);
    const u = await call('POST', `?id=${id}&op=undo`, { base: 2 }, key);
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ v: 3, t: { results: {} } });
    expect((await call('POST', `?id=${id}&op=undo`, { base: 3 }, key)).status).toBe(410);
  });

  it('ancien tournoi sans clé : ouvert à tous, puis protégeable une seule fois', async () => {
    const store = memoryStore();
    setStore(store);
    await store.create('ancien12', JSON.stringify(base()), '');
    expect((await call('GET', '?id=ancien12')).body).toMatchObject({ protected: false, admin: true });
    expect((await call('PUT', '?id=ancien12', { base: 1, t: { ...base(), format: 'league' } })).status).toBe(200);
    const claim = await call('POST', '?id=ancien12&op=claim');
    expect(claim.status).toBe(200);
    expect((await call('POST', '?id=ancien12&op=claim')).status).toBe(403);
    expect((await call('PUT', '?id=ancien12', { base: 2, t: { ...base(), format: 'double' } })).status).toBe(403);
    expect((await call('PUT', '?id=ancien12', { base: 2, t: { ...base(), format: 'double' } }, claim.body.key)).status).toBe(200);
  });
});
