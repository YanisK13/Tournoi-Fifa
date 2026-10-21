/** Lien à envoyer aux autres joueurs : il ouvre le tournoi en direct. */
export function liveLink(id: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?t=${id}`;
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
