import { describe, expect, it } from 'vitest';
import { publicOrigin } from './share';

describe('adresse partagée', () => {
  it('remplace une adresse de déploiement protégée par l’adresse publique', () => {
    expect(publicOrigin('tournoi-fifa.vercel.app', 'https://tournoi-fifa-l3x5wq1wt-yaniskaabouri-6591s-projects.vercel.app'))
      .toBe('https://tournoi-fifa.vercel.app');
  });
  it('garde l’adresse actuelle en local ou si l’adresse publique est inconnue', () => {
    expect(publicOrigin('tournoi-fifa.vercel.app', 'http://localhost:5173')).toBe('http://localhost:5173');
    expect(publicOrigin('', 'https://exemple.fr')).toBe('https://exemple.fr');
  });
});
