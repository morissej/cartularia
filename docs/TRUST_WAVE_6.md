# Vague 6 — Confiance, horodatage et export

## Résultat

La vague 6 rend le pilote blockchain-ready sans activer de blockchain :

- canonisation `jcs-1` et vérification complète des chaînes d’événements ;
- lots Merkle multi-actifs et preuves d’inclusion privées ;
- reçu d’horodatage de test, non qualifié et vérifiable par son empreinte ;
- adaptateur d’ancrage public présent mais volontairement différé ;
- export propriétaire JSON portable, observable, révisionné et idempotent ;
- projections d’intégrité protégées contre les événements arrivés dans le désordre ;
- règles Firestore en lecture seule pour les exports et reçus du propriétaire.

L’interface locale ne revendique plus d’ancrage blockchain ni de vérification eIDAS. Elle affiche clairement une simulation locale, un reçu non qualifié et un ancrage public différé.

## Exécution locale protégée

Après les vagues 1 à 5 :

```bash
npm run trust:wave6
```

La commande refuse une cible distante sans `--allow-remote`. Le workflow automatique exécute deux fois la commande afin de confirmer qu’un rejeu ne crée ni nouvelle révision, ni nouvel événement, ni second lot.

Pour écrire volontairement une copie du bundle portable dans un nouveau fichier local :

```bash
npm run trust:wave6 -- --output=/private/tmp/cartularia-wave6-export.json
```

Le chemin doit être inexistant ; le script refuse de l’écraser.

## Contrôles de sortie

```bash
npm run test:wave6
npm run lint
npm run build
```

La recette couvre notamment :

- T-10 : un rejeu produit une seule révision et un seul événement ;
- T-11 : une projection plus ancienne ne remplace pas la révision la plus haute ;
- T-15 : l’export du propriétaire est disponible, portable et en lecture seule ;
- vecteurs de canonisation et rejet des valeurs non I-JSON ;
- détection d’une altération du journal ;
- validation et altération négative des preuves Merkle ;
- rejet d’un reçu visant un mauvais digest ;
- absence de secret dans la charge d’ancrage public ;
- refus de toutes les écritures client.

## Limites explicites

`complete=false` dans le manifeste tant que des médias restent `pending_binary_reingest`. Le reçu du pilote porte `qualified=false` et `verificationStatus=test_fixture`. L’intégrité cryptographique ne constitue ni certificat d’authenticité, ni titre de propriété, ni validation d’une valorisation.

La vague 7 est désormais implémentée dans [`PRODUCTION_WAVE_7.md`](PRODUCTION_WAVE_7.md). Elle mesure la charge et les coûts paramétriques, prouve la restauration T-20 et calcule sans ambiguïté le statut d’autorisation de mise en service.
