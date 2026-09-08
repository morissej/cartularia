/**
 * Valeurs de référence du dossier IWC (ADR-029), partagées entre :
 *   - scripts/update-iwc-dossier.mjs : consolidation complète du brouillon privé (médias, Storage) ;
 *   - scripts/update-iwc-profile-keys.mjs : complément des seules clés de profil, sans Storage.
 *
 * L'ordre des propriétés est celui de la consolidation du 29/08/2026 : la sérialisation JSON de
 * chaque valeur doit rester identique octet pour octet, sinon un rejeu complet réécrirait les clés.
 * Les fonctions renvoient des copies fraîches (aucune constante mutable partagée).
 */
export const IWC_UPDATE_DATE = '2026-08-29';
export const IWC_ORIGIN_TITLE = 'Une montre de pilote pensée pour voyager';
export const IWC_PUBLIC_CODE = 'OP-4892-XZ9';
export const IWC_SENSITIVITY_PRICES = Object.freeze([3200, 3600, 4000, 4400, 4800]);

export const buildIwcEditableCopy = () => ({
  originTitle: IWC_ORIGIN_TITLE,
  heroSummary: 'IWC Flieger UTC 3251-001 en acier de 39 mm, achetée neuve le 8 mars 2002. Le dossier réunit la facture d’origine, la boîte IWC, des vues d’état de 2022 et 2026, le mouvement ouvert, une vidéo et cinq analyses.',
  originParagraphs: [
    'Introduite en 1998, la Fliegeruhr UTC 3251 associe la lisibilité des montres de pilote IWC à une complication de voyage : l’heure de référence demeure sur un disque de 24 heures à 12 heures, tandis que l’heure locale se règle par sauts d’une heure sans arrêter la trotteuse.',
    'La référence 3251-001 est la version acier à cadran noir livrée sur cuir. Son calibre IWC 37526 et son module TZC sont protégés par une cage interne en fer doux. Les sources recoupées retiennent 39,0 mm, 13,5 mm, 60 m et 21 rubis.',
    'Deux divergences restent ouvertes : la base ETA est mieux étayée comme 2893-2, tandis que certains rapports citent 2892-A2 ; la fin de production du calibre 37526 est donnée en 2003 ou 2005 selon les sources. La transition tritium / Super-LumiNova autour de 2002 n’est pas datée assez précisément pour conclure sur cet exemplaire.',
  ],
  originKnowledge: 'Les affirmations d’authenticité restent graduées : la facture et le numéro de fond sont corrélés, le mouvement signé et 21 rubis sont observés, mais la couronne, le lume, le fonctionnement du TZC et le niveau de polissage restent à vérifier.',
  watchDescription: [
    'L’exemplaire porte le numéro 2715537, visible sur le fond extérieur et intérieur, identique au numéro porté sur la facture Aldebert du 08.03.2002. Le calibre automatique IWC signé, avec rotor doré marqué 21 jewels, a été photographié ouvert le 05.08.2026.',
    'Le cadran noir, le disque UTC, le guichet de date, le bracelet cuir marron et la boîte IWC sont documentés. La facture originale est conservée comme pièce privée car elle contient des données personnelles.',
  ],
  conditionSummary: [
    'Les photographies montrent un cadran lisible et cohérent, un boîtier en état d’usage avec marques superficielles visibles, ainsi qu’un bracelet cuir très patiné et usé. La boîte est présente mais son revêtement blanc est fortement écaillé et dégradé.',
    'L’ouverture du fond documente le mouvement et la correspondance du numéro de boîtier. Les images seules ne permettent pas de conclure au fonctionnement du module TZC, à la précision, à la réserve de marche, à l’étanchéité, à l’authenticité de la couronne ni à l’absence de sur-polissage.',
  ],
  conditionFacts: {
    lastCondition: '28/08/2026',
    conclusion: 'Configuration cohérente et traçabilité forte · contrôle fonctionnel à compléter',
    openPoint: 'TZC, marche, étanchéité, couronne, lume et historique de service',
  },
});

export const buildIwcCreationProfile = () => {
  const editableCopy = buildIwcEditableCopy();
  return {
    profileVersion: '1.0.0',
    assetType: 'watch',
    schemaId: 'watch',
    schemaVersion: '1.6.0',
    collectionId: 'col_pilots',
    brand: 'IWC Schaffhausen',
    model: 'Flieger UTC (Die Fliegeruhr)',
    reference: 'IW3251-001',
    manufactureYear: 2002,
    serialNumber: '2715537',
    caliber: 'IWC 37526',
    description: editableCopy.heroSummary,
    conditionSummary: editableCopy.conditionFacts.conclusion,
    purchaseDate: '2002-03-08',
    purchasePrice: 3200,
    currency: 'EUR',
    seller: 'Aldebert, Paris',
    valuationDate: '2026-08-18',
    valuationLow: 2500,
    valuationMid: 2900,
    valuationHigh: 3300,
    sourceLabel: 'Dossier source IWC consolidé le 29/08/2026',
    assertedAt: `${IWC_UPDATE_DATE}T00:00:00.000Z`,
  };
};
