# ADR-016 — Recette pilote et gate de production séparés

- Statut : accepté
- Date : 16 août 2026
- Vague : Registre R8

## Contexte

La fin de programmation du Registre ne suffit pas à autoriser sa mise en service. Certaines décisions relèvent de la sécurité, du juridique, de l’exploitation ou d’une autorisation explicite et ne doivent jamais être inventées par le code.

La recette automatique doit aussi rester honnête : elle peut vérifier des contrats, des règles, des tests et des caractéristiques d’accessibilité, mais ne remplace pas une campagne humaine sur appareils et technologies d’assistance réels.

## Décision

La Vague 8 produit deux états indépendants :

- `pilotStatus` dépend de dix contrôles locaux versionnés ;
- `goLiveAuthorization` dépend du pilote et de toutes les décisions de `config/production-policy.json`.

Un pilote prêt peut donc coexister avec une mise en service bloquée. Le préflight retourne une empreinte SHA-256 du cœur du rapport afin de rendre son verdict comparable et détectable en cas de modification.

Le préflight échoue si l’un des contrôles pilotes échoue. Il n’échoue pas du seul fait que la production est bloquée : ce blocage est le comportement attendu tant que les décisions externes ne sont pas confirmées.

## Accessibilité

La navigation compacte porte désormais un nom accessible indépendant de son libellé visuel. Un lien d’évitement permet de rejoindre directement le contenu principal et les liens du Registre disposent d’un focus visible.

Ces contrôles préparent la recette clavier, mobile et zoom 200 %. La validation humaine multi-navigateurs et lecteur d’écran reste une activité du pilote, pas une preuve fabriquée par la suite automatisée.

## Données et sécurité

Le rapport R8 ne contient que des résultats de contrôles, des chemins d’évidence et des statuts de politique. Il ne lit ni ne copie de contenu patrimonial. Les règles Firestore et Storage restent les autorités d’accès ; le Cartulaire reste l’autorité de ses médias, preuves, documents et archives.

## Déploiement

Aucun déploiement distant n’est déclenché par `registry:pilot` ou `test:wave8`. Le déploiement ne peut avoir lieu qu’après passage de `goLiveAuthorization` à `authorized` et instruction correspondante dans le workflow de publication.
