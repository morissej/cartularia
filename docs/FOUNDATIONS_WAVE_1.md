# Vague 1 — Exécution locale des fondations Firebase

Ce guide ne déploie rien sur `studio-2614005370-a3e51`. Il crée un environnement local isolé pour Auth, Firestore et Storage. La CLI Firebase 15.x nécessite Java 21 pour exécuter les émulateurs.

## 1. Vérifier le socle

```bash
npm ci
npm run schema:export
npm run test:wave1
npm run lint
npm run build
```

## 2. Démarrer les émulateurs

```bash
npm run schema:export
npm run emulators
```

Les services locaux utilisent :

- Auth : `127.0.0.1:9099`
- Firestore : `127.0.0.1:8080`
- Storage : `127.0.0.1:9199`
- Emulator UI : `127.0.0.1:4000`

## 3. Charger les fondations de démonstration

Dans un second terminal :

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=cartularia-wave1-local \
npm run seed:foundations
```

Le bootstrap crée deux comptes isolés, deux organisations, deux memberships, deux Registres vides et le profil `watch@1.3.0`. Il ne crée aucun Cartulaire et ne charge aucune donnée patrimoniale réelle.

## 4. Relier le client local

Dans `.env`, conserver la configuration Firebase du projet et ajouter :

```dotenv
VITE_USE_FIREBASE_EMULATORS=true
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
VITE_FIREBASE_AUTH_EMULATOR_PORT=9099
VITE_FIREBASE_FIRESTORE_EMULATOR_PORT=8080
VITE_FIREBASE_STORAGE_EMULATOR_PORT=9199
```

Puis lancer `npm run dev`. Le service `src/services/foundations.ts` découvre les memberships actifs du compte connecté et charge uniquement les Registres présents dans leur portée.

## Garde-fous

- `seed:foundations` refuse toute cible distante tant que `--allow-remote` n’est pas fourni explicitement avec des credentials Admin.
- Storage reste fermé dans la vague 1.
- Le déploiement distant attend la confirmation de la région et une validation explicite de la cible.
