# PF3 — Affichage immédiat et hydratation sûre

Date de validation locale : 18 août 2026.

## Cause traitée

`main.tsx` attendait la fin de `restoreCartulariaLocalState`, de l'état Firebase
Auth et, pour un Cartulaire privé importé, de l'amorçage du brouillon cloud
avant d'appeler `createRoot`. Aucun pixel React n'était donc affiché pendant
ces opérations.

Monter directement `App` avant la restauration aurait toutefois créé un risque
plus grave : ses états persistants auraient pu lire des valeurs incomplètes,
puis réécrire des valeurs par défaut avant le retour d'IndexedDB ou du cloud.

## Correction

- React monte maintenant synchroniquement depuis `main.tsx`.
- Un shell Cartularia léger et responsive est affiché immédiatement.
- Seule la racine du Cartulaire privé est placée derrière la barrière
  d'hydratation.
- Le Cartulaire métier reste non importé et non monté tant que la restauration
  locale n'est pas définitivement terminée.
- L'ordre reste strict : coffre IndexedDB → contexte du Cartulaire → session
  Auth → amorçage éventuel du brouillon cloud.
- Le Cartulaire IWC local ne charge pas Firebase pendant ce bootstrap.
- Une session déconnectée ouvre directement le coffre restauré, sans lecture
  cloud.
- Les routes `watch-website`, `cartulary-view`, `community`, `registry`, 404 et
  la confirmation de suppression ne déclenchent pas le bootstrap privé.
- Une erreur locale ou distante devient un avertissement dismissible ; elle ne
  laisse pas un écran blanc et ne réinitialise aucune donnée.
- L'ouverture IndexedDB bloquée est maintenant rejetée explicitement ; une
  connexion éventuellement ouverte plus tard est refermée.
- L'attente Auth est bornée à 3 secondes et libère son observateur.
- La lecture initiale du brouillon cloud est bornée à 5 secondes. Si elle
  expire, la promesse Firestore tardive ne peut plus appliquer de mutation au
  coffre après le montage.

## Verrous de non-régression

`tests/ui/application-bootstrap.test.tsx` vérifie :

- shell visible avant résolution du bootstrap privé ;
- application métier absente avant restauration ;
- montage direct des routes publiques ;
- exclusion de la page `data-deleted=1` ;
- avertissement non bloquant en mode dégradé ;
- ordre local → session → cloud et délais transmis ;
- absence de Firebase pour le Cartulaire IWC ;
- absence de cloud après échec local, session indisponible ou déconnexion ;
- disparition de l'ancien `.finally(renderApplication)`.

Les tests du coffre et de synchronisation vérifient en complément :

- un coffre vide ne crée aucune valeur métier par défaut ;
- les états locaux survivent à la restauration ;
- une suppression ne ressuscite pas ;
- deux modifications concurrentes deviennent un conflit sans écrasement ;
- une réhydratation identique ne retransforme pas un état cloud en écriture
  locale.

## Validation locale

- Tests UI : 38/38 réussis.
- Tests coffre, synchronisation et conservation : 21/21 réussis.
- Tests UX complémentaires : 14/14 réussis.
- TypeScript et lint : réussis.
- Build Vite isolé : réussi, sans écrire dans `dist/`.
- Budgets PF0 : entrée 199 778 o, App 298 847 o, Registre 36 201 o,
  plus gros fragment 488 183 o — quatre budgets respectés.

## Validation navigateur

- Racine privée : shell de restauration observé avant le Cartulaire.
- Trois transitions chaudes après navigation : 306 ms, 319 ms et 326 ms entre
  le retour de navigation et le titre métier vérifiable.
- `watch-website` : aucun shell de restauration privée ; seul le fallback de
  chargement du module apparaît, puis la fiche est rendue.
- Registre : aucun bootstrap privé ; l'écran de connexion reste accessible avec
  les émulateurs arrêtés.
- Cartulaire Rolex, émulateurs arrêtés et session déconnectée : shell puis
  ouverture depuis le coffre local en environ 400 ms.
- Mobile 390 × 844 : shell lisible, transition terminée et aucun débordement
  horizontal.

Ces durées incluent le coût de l'automatisation locale et ne constituent pas des
Web Vitals de terrain. Le scénario navigateur « utilisateur authentifié puis
cloud interrompu » n'a pas été fabriqué avec des identifiants de démonstration ;
son basculement dégradé est verrouillé par le test injecté, tandis que le
parcours déconnecté hors ligne a été vérifié visuellement.

## Périmètre

- aucune clé persistée, route fonctionnelle, décision W/R/C ou donnée métier
  modifiée ;
- aucune règle Firebase ou autorisation modifiée par PF3 ;
- aucune écriture Firebase de production et aucun déploiement Hosting.
