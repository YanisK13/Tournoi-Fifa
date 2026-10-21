import { Component, type ReactNode } from 'react';

/** Filet de sécurité : en cas d'erreur inattendue, on propose de repartir de zéro au lieu d'un écran vide. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="home">
        <div className="home-hero">
          <h1 className="display">Oups.</h1>
          <p className="lead">Une erreur inattendue est survenue. Tu peux recharger la page ; si ça persiste, réinitialise l’application.</p>
        </div>
        <div className="bottom-bar">
          <button className="btn ghost" onClick={() => { try { localStorage.clear(); } catch { /* */ } location.reload(); }}>Réinitialiser</button>
          <button className="btn primary xl" onClick={() => location.reload()}>Recharger</button>
        </div>
      </main>
    );
  }
}
