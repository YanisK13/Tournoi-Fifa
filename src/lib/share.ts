import { isTournament } from './store';
import type { Tournament } from './types';

const PREFIX = '#t=';

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str: string): Uint8Array {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canCompress = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Encode tout le tournoi dans l'URL (aucun serveur nécessaire). */
export async function encodeTournament(t: Tournament): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(t));
  if (canCompress()) return 'z' + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
  return 'j' + toB64Url(json);
}

export async function decodeTournament(code: string): Promise<Tournament | null> {
  try {
    const bytes = fromB64Url(code.slice(1));
    const raw = code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    const t = JSON.parse(new TextDecoder().decode(raw));
    return isTournament(t) ? t : null;
  } catch {
    return null;
  }
}

export async function shareLink(t: Tournament): Promise<string> {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${PREFIX}${await encodeTournament(t)}`;
}

export function readSharedCode(): string | null {
  const h = window.location.hash;
  return h.startsWith(PREFIX) ? h.slice(PREFIX.length) : null;
}

export function clearHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Partage natif sur mobile, sinon copie dans le presse-papiers. */
export async function shareOrCopy(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}
