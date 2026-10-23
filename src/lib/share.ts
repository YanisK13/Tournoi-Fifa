declare const __PUBLIC_HOST__: string;

/** Adresse publique du site : celle de production si elle est connue, sinon l'adresse actuelle. */
export function publicOrigin(host = typeof __PUBLIC_HOST__ === 'string' ? __PUBLIC_HOST__ : '', current = window.location.origin): string {
  const h = host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!h || /^(localhost|127\.|\[?::1)/.test(new URL(current).hostname)) return current;
  return `https://${h}`;
}

/** Lien à envoyer aux autres joueurs : il ouvre le tournoi en direct. */
export function liveLink(id: string): string {
  return `${publicOrigin()}/?t=${id}`;
}

/** Lien organisateur : la clé est après le #, elle n'est jamais envoyée au serveur ni enregistrée dans l'historique. */
export function organizerLink(id: string, key: string): string {
  return `${liveLink(id)}#admin=${key}`;
}

export function readAdminKey(): string | null {
  const m = window.location.hash.match(/admin=([a-z0-9]{24})/);
  return m ? m[1] : null;
}

export function readTournamentParam(): string | null {
  const id = new URLSearchParams(window.location.search).get('t');
  return id && /^[a-z0-9]{6,16}$/.test(id) ? id : null;
}

/** Garde l'identifiant du tournoi dans l'adresse (pour recharger ou copier l'URL). */
export function setTournamentParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('t', id);
  else url.searchParams.delete('t');
  url.hash = '';
  if (url.href !== window.location.href) history.replaceState(null, '', url.pathname + url.search);
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
