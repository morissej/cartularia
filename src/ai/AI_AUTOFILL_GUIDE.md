# Mode d’emploi de l’IA de remplissage

Version du schéma : `1.0.0`

## Objet

Le fichier `fieldCatalog.ts` est la source de vérité des postes du Cartulaire. Chaque champ possède un identifiant stable, un objectif, une consigne de remplissage, un type, une cardinalité, une priorité de sources, une règle de validation, un niveau de confidentialité et une règle d’écriture par l’IA.

L’IA ne remplit jamais directement le dossier. Elle prépare une proposition structurée, puis un humain autorisé l’accepte, la corrige ou la refuse. Une valeur déjà validée ne doit jamais être écrasée silencieusement.

## Chaîne de traitement recommandée

1. **Ingestion** : importer les fichiers originaux sans les modifier ; enregistrer nom, type MIME, taille, empreinte et métadonnées.
2. **Extraction** : extraire le texte, les tableaux, les métadonnées et les observations visuelles en conservant le lien avec la source et, si possible, la page ou la zone.
3. **Normalisation** : convertir dates en ISO 8601, devises en codes ISO 4217 et valeurs numériques sans perdre la valeur originale.
4. **Résolution** : rattacher chaque information à un `fieldId` du catalogue et à un `instanceId` pour les collections `[]`.
5. **Validation** : appliquer les règles du descripteur, comparer aux valeurs existantes et détecter contradictions, doublons et données manquantes.
6. **Proposition** : produire un objet `AIFillProposal` avec sources, confiance, justification et date d’observation.
7. **Revue humaine** : faire accepter, modifier ou rejeter chaque proposition. Les marqueurs W et R restent exclusivement humains.
8. **Enregistrement** : journaliser l’ancienne valeur, la nouvelle valeur, l’utilisateur, les sources et l’horodatage de décision.

## Format d’une proposition

```json
{
  "fieldId": "reference.specifications[].value",
  "instanceId": "case-diameter",
  "operation": "set",
  "value": "39 mm",
  "sourceRefs": ["manufacturer-archive:IW3251:page-2"],
  "confidence": 0.96,
  "rationale": "La fiche manufacture associe explicitement la référence IW3251 à un diamètre de 39 mm.",
  "observedAt": "2026-08-13T18:30:00+02:00",
  "requiresHumanReview": true
}
```

`sourceRefs` doit permettre de rouvrir la source exacte. Une URL seule n’est pas suffisante lorsqu’un document local, une page ou un identifiant d’annonce est disponible.

## Hiérarchie des sources

- **Identité et propriété** : pièce fournie par le propriétaire, document officiel, puis déclaration explicite de l’utilisateur. Ces données restent Secret.
- **Référence et spécifications** : archive ou documentation de manufacture, papiers de la montre, rapport d’expert, puis base spécialisée reconnue.
- **État et authenticité** : examen ou rapport d’expert daté, document d’atelier, puis observation documentée. Une image seule ne suffit pas à conclure sur un élément non visible.
- **Médias** : EXIF, XMP ou métadonnées QuickTime ; à défaut, métadonnée du fichier avec sa source explicitement marquée. L’empreinte est toujours calculée sur l’original.
- **Marché** : transactions réalisées vérifiables, résultats d’enchères, puis annonces en cours. Les prix demandés et réalisés ne sont jamais mélangés.
- **Calculs** : uniquement les formules du produit à partir d’entrées validées. Une IA ne saisit pas directement un prix de revient, une plus-value ou un TRI.

## Règles de confiance et de conflit

- Confiance supérieure ou égale à `0,85` : proposition fortement étayée, mais confirmation humaine toujours requise.
- Confiance de `0,60` à `0,84` : afficher comme élément à revoir et présenter les réserves.
- Confiance inférieure à `0,60` : ne pas préremplir ; produire `skip` et expliquer la donnée manquante.
- Deux sources incompatibles : ne choisir silencieusement aucune valeur. Présenter les deux valeurs, leur date, leur niveau de source et demander une décision.
- Une valeur existante : proposer une comparaison ou un ajout ; ne jamais la remplacer sans validation explicite.

## Confidentialité et publication

Les données propriétaire, stockage, acquisition, dépenses et localisation précise restent `secret` par défaut. Une information Secret ne peut pas être copiée dans un texte public sans décision humaine explicite.

Les marqueurs `W`, `R` et `C` ne sont jamais modifiables par l’IA :

- `W` décide du contenu du Watch website indépendant ;
- `R` décide du contenu du rapport PDF ;
- `C` décide du contenu proposé pour publication dans le Cercle.

L’IA peut détecter un risque de divulgation ou suggérer un bloc, mais la publication reste une action humaine distincte du remplissage.

## Champs répétables et idempotence

Un identifiant se terminant par `[]` décrit une famille. Chaque ligne réelle reçoit un `instanceId` stable. Une nouvelle exécution doit mettre à jour sa proposition pour la même instance et la même source, pas créer un doublon.

Pour dédupliquer :

- documents et médias : empreinte du fichier ;
- transactions et annonces : source + identifiant externe + date ;
- dépenses : date + montant + pièce source ;
- ressources web : URL canonique ;
- rapports : date + empreinte de la pièce principale.

## Contrat avec l’interface

Les contrôles React portent `data-ai-field`, `data-ai-instance` et `data-ai-schema-version`. L’intégration future doit utiliser ces identifiants et importer le catalogue TypeScript ; elle ne doit pas cibler un champ à partir de son texte visible ou de sa position dans la page.

Avant chaque déploiement, vérifier que tous les `data-ai-field` utilisés par l’interface existent dans le catalogue et que toute évolution incompatible augmente la version du schéma.
