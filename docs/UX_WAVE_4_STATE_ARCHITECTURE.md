# Vague UX 4 — architecture d’état additive

## Résultat

Les cinq domaines à évolution fréquente disposent désormais de leur propre hook :

- `useCartularyMediaState`
- `useCartularyOwnerState`
- `useCartularyConditionState`
- `useCartularyValuationState`
- `useCartularyPublicationState`

Chaque hook regroupe l’initialisation depuis le coffre local, la persistance sur les clés historiques et le rechargement ciblé après un `CLOUD_PULL_APPLIED_EVENT`. `App.tsx` conserve l’orchestration d’écran et les états purement visuels.

## Contrats préservés

- aucune clé `cartularia-*` n’a été renommée ;
- les URL `blob:` ne sont toujours jamais écrites dans les états média, propriétaire ou état ;
- l’ancienne clé `cartularia-storage-description` déclenche encore le chargement migré des lieux ;
- les sélections W/R/C, décisions humaines et liaison à l’empreinte source restent indépendantes ;
- les routes, schémas métier, événements de synchronisation et règles Firebase ne sont pas modifiés.

## Frontière de responsabilité

Les hooks possèdent les états métier, leurs commandes et leur persistance. Ils ne possèdent ni les permissions, ni Firebase, ni les modales, ni les toasts, ni la page active, ni le média sélectionné.

Le socle `usePersistentCartularyState` est volontairement local au Cartulaire : il fournit une persistance et un rechargement par clé, sans introduire de Context global. Les commandes nommées (`updateCheck`, `toggleAssetTag`, `updateField`, `updateComparable`, etc.) constituent l’API à privilégier pour les prochaines fonctionnalités. Les fonctions `replace*` demeurent disponibles comme pont additif pour les parcours existants, notamment la suppression annulable générique.

## Extension future

Une nouvelle fonctionnalité métier doit être ajoutée au hook de son domaine puis consommée par la page concernée. Un nouveau domaine ne justifie un Context que si plusieurs branches d’interface sans ancêtre pratique doivent réellement partager un état vivant ; ce n’est pas le cas aujourd’hui.

## Vérification

`npm run test:ux-wave4` couvre les cinq hooks, les clés historiques, la sérialisation sans URL locale, les commandes métier, le rechargement de compatibilité et la liaison de publication. Les contrôles usuels `validate:ai`, `lint`, `build` et `git diff --check` restent requis.
