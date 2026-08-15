# Cartularia Prototype Checklist

## Phase 1 : Initialisation & Dépôt Git
- [x] Initialiser le dépôt Git local dans `Prototype Antigravity`
- [x] Créer le fichier `.gitignore` standard (node_modules, build, .env, etc.)
- [x] Initialiser l'application React + TypeScript avec Vite
- [x] Configurer Firebase localement (`firebase.json`, `.firebaserc`, et initialisation SDK)

## Phase 2 : Configuration du Design System v2
- [x] Créer la structure des dossiers (`src/components`, `src/styles`, `src/hooks`, `src/assets`)
- [x] Créer le fichier `src/styles/variables.css` contenant les tokens du design system et l’aligner sur le kit logo officiel v1.0
- [x] Configurer `src/index.css` pour appliquer les polices (Archivo et JetBrains Mono) et les styles globaux
- [x] Créer la barre de dossier persistante `BarreDossier` (Composant C01)

## Phase 3 : Composants UI & Architecture actuelle
- [x] Définir les types TypeScript métier (`src/types/index.ts`)
- [x] Créer le jeu de données mockées de test (montre IWC issues de `10_Assets/IWC`)
- [x] Implémenter les composants génériques :
  - [x] Table clé/valeur réactive (Composant C02)
  - [x] Bloc de constat de défauts (Composant C03)
  - [x] Boutons standard et états (Composant C05)
- [x] Implémenter les cinq pages actuelles : 00 Accueil, 01 Médias, 02 Référence, 03 État de la montre et 04 Valorisation
- [x] Rendre les champs éditables, répétables et supprimables selon leur nature
- [x] Ajouter les marqueurs horizontaux W, R et crayon au niveau pertinent de chaque bloc
- [x] Générer un Watch website indépendant et un rapport PDF à partir de sélections distinctes
- [x] Préparer les 66 postes au remplissage assisté par IA avec validation humaine obligatoire

## Phase 4 : Lecteur 3D (Spin 360°)
- [x] Créer le composant `Spin360` (Composant C07)
- [x] Gérer l'interaction glisser/balayer pour tourner la montre
- [x] Implémenter le chargement progressif des images de rotation (preloading)
- [x] Gérer le support "mouvement réduit" (reduced motion) et accessibilité clavier

## Phase 5 : Journal d'Intégrité & Visibilité
- [x] Créer le simulateur d'ancrage et de chaînage cryptographique
- [x] Ajouter la barre de contrôle d'audience (Secret, Communauté, Tous)
- [x] Masquer/Afficher dynamiquement les données selon le niveau de visibilité effectif

## Phase 5 bis : Données et automatisation
- [x] Horodater les médias à partir des métadonnées disponibles
- [x] Appliquer les catégories Photo principale, Vidéo principale, Séquence 3D, Diaporama, Accessoires, Documentation et Autres
- [x] Accepter images, vidéos, PDF et autres pièces documentaires
- [x] Décrire chaque poste, ses sources, sa validation, sa confidentialité et sa règle d’écriture IA

## Phase 6 : Finalisation & Déploiement
- [x] Ajouter les tests unitaires de non-exposition des données sensibles
- [x] Vérifier le comportement réactif (Desktop, Tablette, Mobile)
- [x] Créer le walkthrough de démonstration
