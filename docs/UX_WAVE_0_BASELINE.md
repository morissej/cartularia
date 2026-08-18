# Vague UX 0 — filet de sécurité et état de référence

Date de mesure : 17 août 2026. Environnement : build Vite de production et serveur Vite local sur `127.0.0.1`, données de démonstration Firebase Emulator.

## Filet automatisé ajouté

- Vitest + jsdom + Testing Library, exclusivement comme dépendances de développement.
- interactions W/R/C et contrôle d’édition ;
- activation clavier d’un contenu éditable ;
- visionneuse média, navigation et catégories ;
- confirmation de suppression ;
- frontières actives/inactives des cinq pages ;
- conservation des suites Node existantes pour navigation, publication et persistance.

Commandes de référence :

```bash
npm run test:ux-wave0
npm run measure:ux-wave0
```

## Mesures du build

| Mesure | Référence |
| --- | ---: |
| Fichiers JavaScript | 8 |
| JavaScript total | 1 327 852 octets |
| JavaScript total gzip | 377 305 octets |
| Chunk partagé principal | 801 326 octets, 238 165 gzip |
| Chunk Cartulaire `App` | 354 997 octets, 93 472 gzip |
| CSS total | 201 540 octets, 28 456 gzip |
| `src/App.tsx` après la première extraction modulaire | 3 989 lignes |

Le chunk partagé supérieur à 500 ko reste un point de mesure pour la vague 5. Aucune configuration `manualChunks` n’est introduite sans analyse du contenu et du parcours réel.

## Mesures navigateur locales

- ouverture directe de la Galerie du Registre : 51, 55 et 60 ms sur trois passages locaux ; médiane 55 ms ;
- ouverture du diaporama IWC et affichage de sa modale : environ 701 ms ;
- consommation mémoire JavaScript : non exposée par le moteur de recette intégré, donc volontairement notée « non mesurable » plutôt qu’estimée.

Ces valeurs sont des références locales de non-régression, pas des temps de production ni des Core Web Vitals.

## Parcours vérifiés

1. les cinq pages `cover`, `media`, `reference`, `condition` et `value` ;
2. modification d’un champ propriétaire, rechargement et persistance, puis restauration de la valeur initiale ;
3. ouverture d’une décision W et fermeture clavier sans enregistrement ;
4. ouverture et fermeture par `Escape` de la visionneuse média ;
5. ouverture et fermeture par `Escape` de l’éditeur de valorisation extrait ;
6. Registre → Galerie → Cartulaire IWC → retour Galerie ;
7. média privé visible pour l’IWC et état de repli explicite pour le Cartulaire véhicule sans aperçu disponible.

## Limites

- aucune donnée de production n’a été écrite ;
- aucune règle Firebase, autorisation ou fonction de sécurité n’a été modifiée ;
- les tests de mémoire longue durée attendent un navigateur exposant une métrique de heap stable.
