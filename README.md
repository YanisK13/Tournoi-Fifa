# FC Tournament

Application web mobile pour organiser un tournoi EA Sports FC entre amis sur une seule console : création en moins d'une minute, tirage, tableau, saisie des scores, classement et champion.

**Temps réel** : chaque tournoi a son lien (`?t=…`). Tous ceux qui l'ouvrent voient les scores se mettre à jour en ~2 secondes et peuvent saisir des résultats. Pas de compte nécessaire.

## Lancer le projet

```bash
npm install
npm run dev        # http://localhost:5173 (et l'adresse réseau pour l'ouvrir sur ton téléphone)
```

Autres commandes :

```bash
npm test           # tests de la logique du tournoi (Vitest)
npm run build      # vérification TypeScript + build de production dans dist/
npm run preview    # sert le build de production
```

Pour l'utiliser sur ton téléphone pendant la soirée : lance `npm run dev`, puis ouvre sur le téléphone l'adresse « Network » affichée (même Wi-Fi). Le dossier `dist/` peut aussi être déployé tel quel sur n'importe quel hébergement statique (Netlify, Vercel, GitHub Pages…).

## Mise en ligne sur Vercel (temps réel)

1. Importer le dépôt dans Vercel (réglages par défaut, Vercel détecte Vite).
2. Dans le projet Vercel : **Storage → Create Database → Upstash for Redis** (offre gratuite), puis **Connect** au projet. Vercel ajoute seul les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
3. **Deployments → ⋯ → Redeploy** pour que le site utilise la base.

Sans base connectée, l'appli fonctionne quand même, mais chaque tournoi reste sur le téléphone qui l'a créé (badge « Non partagé »).

En local (`npm run dev`), l'API tourne dans le serveur Vite avec un stockage en mémoire (effacé à l'arrêt du serveur).

## Formats

| Format | Détail |
| --- | --- |
| Élimination directe (défaut) | Exemptions automatiques quand le nombre de joueurs n'est pas une puissance de 2, sans match fantôme. |
| Double élimination | Tableau principal + repêchage + grande finale, avec revanche si le vainqueur du repêchage gagne la première. |
| Championnat | Toutes rondes, victoire 3 pts, nul 1 pt. |
| Groupes + phase finale | 2 à 8 groupes, les 2 premiers de chaque groupe en tableau final (6 joueurs minimum). |

## Structure

```
src/
  lib/
    types.ts         modèles de données
    engine.ts        génération des tableaux, résolution, classements (pur, sans React)
    store.ts         actions + persistance localStorage
    sync.ts          synchronisation temps réel (envoi, fusion des saisies simultanées, hors ligne)
    share.ts         lien du tournoi et partage
api/
  tournament.ts      fonction Vercel : stockage du tournoi (Redis Upstash) avec contrôle de version
    *.test.ts        tests
  components/        écrans React (création, joueurs, matchs, tableau, classement, saisie du score, champion)
  App.tsx            navigation et actions globales
  index.css          identité visuelle
```

Le tournoi stocke uniquement le tirage et les résultats ; le tableau est recalculé à chaque changement. Chaque modification est envoyée avec la version sur laquelle elle s'appuie : si deux personnes saisissent en même temps, la seconde est rejouée sur la version à jour, aucune saisie n'est perdue. Un tournoi inactif pendant 30 jours est effacé. Quand un score modifié change un vainqueur, les matchs suivants devenus incohérents sont annulés automatiquement (après confirmation).
