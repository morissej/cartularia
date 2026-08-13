# Cartularia Prototype Checklist

## Phase 1 : Initialisation & Dépôt Git
- [x] Initialiser le dépôt Git local dans `Prototype Antigravity`
- [x] Créer le fichier `.gitignore` standard (node_modules, build, .env, etc.)
- [x] Initialiser l'application React + TypeScript avec Vite
- [x] Configurer Firebase localement (`firebase.json`, `.firebaserc`, et initialisation SDK)

## Phase 2 : Configuration du Design System
- [x] Créer la structure des dossiers (`src/components`, `src/styles`, `src/hooks`, `src/assets`)
- [x] Créer le fichier `src/styles/variables.css` contenant tous les Design Tokens de `Design.pdf`
- [x] Configurer `src/index.css` pour appliquer les polices (Archivo et JetBrains Mono) et les styles globaux
- [x] Créer la barre de dossier persistante `BarreDossier` (Composant C01)

## Phase 3 : Composants UI & Rendu des 11 Sections
- [x] Définir les types TypeScript métier (`src/types/index.ts`)
- [x] Créer le jeu de données mockées de test (montre IWC issues de `10_Assets/IWC`)
- [x] Implémenter les composants génériques :
  - [x] Table clé/valeur réactive (Composant C02)
  - [x] Bloc de constat de défauts (Composant C03)
  - [x] Boutons standard et états (Composant C05)
- [x] Implémenter les 11 sections canoniques (01 à 11) du Cartulaire dans la vue principale

## Phase 4 : Lecteur 3D (Spin 360°)
- [x] Créer le composant `Spin360` (Composant C07)
- [x] Gérer l'interaction glisser/balayer pour tourner la montre
- [x] Implémenter le chargement progressif des images de rotation (preloading)
- [x] Gérer le support "mouvement réduit" (reduced motion) et accessibilité clavier

## Phase 5 : Journal d'Intégrité & Visibilité
- [x] Créer le simulateur d'ancrage et de chaînage cryptographique
- [x] Ajouter la barre de contrôle d'audience (Secret, Communauté, Tous)
- [x] Masquer/Afficher dynamiquement les données selon le niveau de visibilité effectif

## Phase 6 : Finalisation & Déploiement
- [x] Ajouter les tests unitaires de non-exposition des données sensibles
- [x] Vérifier le comportement réactif (Desktop, Tablette, Mobile)
- [x] Créer le walkthrough de démonstration
