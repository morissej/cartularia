# Cartularia — prototype du Cartulaire

Prototype React/TypeScript du dossier numérique d’une montre de collection.

Le Cartulaire rassemble dans une interface unique :

- une page d’accueil avec l’identité de la montre, son propriétaire et son stockage ;
- la bibliothèque média, la photo et la vidéo principales, le diaporama et la revue à 360° ;
- l’histoire, les spécifications et les points d’identification de la référence ;
- la description de l’exemplaire, son état, ses rapports, papiers et accessoires ;
- la valorisation, les comparables, le prix de revient, la plus-value et le TRI ;
- une sélection indépendante pour le Watch website et pour le rapport PDF.

## Démarrage local

Prérequis : Node.js et npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

L’application est ensuite accessible à l’adresse indiquée par Vite, généralement `http://127.0.0.1:5173`.

## Configuration Firebase

Copier `.env.example` vers `.env`, puis remplacer les valeurs par la configuration du projet Firebase. Le fichier `.env` est volontairement exclu de Git.

Les règles de développement sont présentes dans `firestore.rules` et `storage.rules`.

## Contrôles

```bash
npm run validate:ai
npm run lint
npm run build
```

## Préparation au remplissage par IA

Le catalogue typé des postes se trouve dans `src/ai/fieldCatalog.ts`. Chaque champ de l’interface possède un identifiant stable, une description, des consignes de remplissage, une hiérarchie de sources, une validation et un niveau de confidentialité.

Le workflow d’intégration recommandé est documenté dans `src/ai/AI_AUTOFILL_GUIDE.md`. L’IA devra produire des propositions sourcées soumises à validation humaine ; elle ne pourra pas publier de contenu ni activer les marqueurs W/R de manière autonome.

## Données

Les données et médias présents dans ce dépôt servent de démonstration au prototype. Ils ne constituent ni un certificat d’authenticité ni une évaluation engageante.
