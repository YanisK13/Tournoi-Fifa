import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle, memoryStore, setStore } from './api/tournament';

/**
 * En local (npm run dev / preview), l'API /api/tournament tourne dans le serveur Vite.
 * En production, c'est la fonction Vercel qui répond.
 */
function localApi(): Plugin {
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/tournament')) return next();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(`http://localhost${req.url}`, { method: req.method, body: req.method === 'GET' ? undefined : body }));
    res.statusCode = r.status;
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
  };
  // Si une base est configurée (REDIS_URL ou KV_REST_API_URL), on l'utilise ; sinon stockage en mémoire.
  const useMemory = () => { if (!process.env.REDIS_URL && !process.env.KV_REST_API_URL) setStore(memoryStore()); };
  return {
    name: 'local-api',
    configureServer(server) { useMemory(); server.middlewares.use(middleware); },
    configurePreviewServer(server) { useMemory(); server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  test: { environment: 'node' },
} as never);
