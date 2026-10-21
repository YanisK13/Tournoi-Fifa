# FC Tournament

Application web mobile pour organiser un tournoi EA Sports FC entre amis sur une seule console : création en moins d'une minute, tirage, tableau, saisie des scores, classement et champion. Aucun compte, aucun serveur : tout est enregistré dans le navigateur.

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
    share.ts         lien de partage (tournoi compressé dans l'URL)
    *.test.ts        tests
  components/        écrans React (création, joueurs, matchs, tableau, classement, saisie du score, champion)
  App.tsx            navigation et actions globales
  index.css          identité visuelle
```

Le tournoi stocke uniquement le tirage et les résultats ; le tableau est recalculé à chaque changement. Quand un score modifié change un vainqueur, les matchs suivants devenus incohérents sont annulés automatiquement (après confirmation).
