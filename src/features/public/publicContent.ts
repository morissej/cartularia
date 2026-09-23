import { DEMO_SUBMARINER_CARTULARY_ID, DEMO_SUBMARINER_PUBLIC_CODE, DEMO_WEBSITE_BLOCK_IDS } from '../../data/demoCartularies.ts';

export const DEMO_SUBMARINER_HREF = `/cartulary-demo?cartularyId=${encodeURIComponent(DEMO_SUBMARINER_CARTULARY_ID)}#cover`;
const demoMiniSiteParameters = new URLSearchParams({
  publicCode: DEMO_SUBMARINER_PUBLIC_CODE,
  preview: 'local',
  cartularyId: DEMO_SUBMARINER_CARTULARY_ID,
  blocks: DEMO_WEBSITE_BLOCK_IDS.join(','),
});
export const DEMO_SUBMARINER_WEBSITE_HREF = `/watch-website?${demoMiniSiteParameters.toString()}`;
export const DEMO_SUBMARINER_PROOFS_HREF = `/cartulary-demo?cartularyId=${encodeURIComponent(DEMO_SUBMARINER_CARTULARY_ID)}&view=proofs#cover`;
export const PROFESSIONAL_MEDIA_HELP_REASON = 'Aide professionnelle photo et vidéo';

export const HERO_BENEFITS = [
  {
    label: 'Tout au même endroit',
    detail: 'Papiers, état, médias, valeurs et suivi de chaque pièce dans un seul dossier.',
  },
  {
    label: 'Chaque pièce connue',
    detail: "État daté, historique d'entretien, concordance des numéros, référence : ce que l'on possède, vraiment.",
  },
  {
    label: "Une vue d'ensemble pour décider",
    detail: 'Le Registre rassemble et compare les données disponibles ; la portée dépend de la qualité des dossiers renseignés.',
  },
  {
    label: 'Secret et sécurisé par défaut',
    detail: 'Un nouveau Cartulaire reste secret tant que son propriétaire ne choisit pas de publier des blocs précis.',
  },
  {
    label: 'Analyse assistée, revue humaine',
    detail: 'Le catalogue structure les données pour une analyse assistée et une revue humaine. Le pilote ne produit pas de diagnostic automatique.',
  },
  {
    label: 'Preuve d’intégrité datée',
    detail: 'Une empreinte et, lorsqu’il est confirmé, un horodatage externe permettent de vérifier une version sans certifier l’authenticité de l’objet.',
  },
] as const;

export type PublicIconName = 'archive' | 'book' | 'car' | 'circle' | 'coins' | 'file' | 'fingerprint' | 'gem' | 'globe' | 'image' | 'layers' | 'list' | 'palette' | 'scan' | 'shield' | 'sparkles' | 'wine';

export type ObjectAvailability = 'dedicated' | 'standard-pending';

export interface ObjectCategory {
  slug: string;
  name: string;
  icon: PublicIconName;
  examples: string;
  summary: string;
  availability: ObjectAvailability;
  availabilityLabel: string;
}

/** Source commune à la page Objets et à la FAQ de l’accueil. */
export const OBJECT_CATEGORIES: readonly ObjectCategory[] = [
  {
    slug: 'montres',
    name: 'Montres',
    icon: 'scan',
    examples: 'Montres mécaniques, quartz, anciennes ou contemporaines',
    summary: 'Le Cartulaire montre dédié couvre la référence, les médias, l’état, les révisions, les documents et la valorisation.',
    availability: 'dedicated',
    availabilityLabel: 'Cartulaire dédié disponible',
  },
  {
    slug: 'bijoux',
    name: 'Bijoux',
    icon: 'gem',
    examples: 'Bagues, colliers, bracelets, pierres et ensembles',
    summary: 'La future fiche standard réunira description, provenance, documents, état et médias avant l’ajout de champs spécialisés.',
    availability: 'standard-pending',
    availabilityLabel: 'Fiche standard à ouvrir au public',
  },
  {
    slug: 'or',
    name: 'Or',
    icon: 'coins',
    examples: 'Pièces, lingots et ensembles documentés',
    summary: 'Le modèle commun peut accueillir les preuves et observations, mais le parcours de création standard n’est pas encore disponible.',
    availability: 'standard-pending',
    availabilityLabel: 'Fiche standard à ouvrir au public',
  },
  {
    slug: 'vin',
    name: 'Vin',
    icon: 'wine',
    examples: 'Bouteilles, caisses et lots de collection',
    summary: 'Une spécialisation devra préciser millésime, provenance, stockage, état et documentation sans détourner un profil existant.',
    availability: 'standard-pending',
    availabilityLabel: 'Spécialisation future',
  },
  {
    slug: 'voitures',
    name: 'Voitures',
    icon: 'car',
    examples: 'Automobiles de collection et véhicules patrimoniaux',
    summary: 'Le Cartulaire automobile dédié couvre l’identité du véhicule, son état, ses interventions, ses documents et sa valeur.',
    availability: 'dedicated',
    availabilityLabel: 'Cartulaire dédié disponible',
  },
  {
    slug: 'peinture',
    name: 'Peinture',
    icon: 'palette',
    examples: 'Tableaux, œuvres sur papier et ensembles',
    summary: 'La fiche standard devra précéder une spécialisation dédiée aux dimensions, techniques, provenance, état et expositions.',
    availability: 'standard-pending',
    availabilityLabel: 'Fiche standard à ouvrir au public',
  },
  {
    slug: 'sculpture',
    name: 'Sculpture',
    icon: 'sparkles',
    examples: 'Œuvres uniques, éditions et objets sculptés',
    summary: 'La future fiche standard rassemblera description, mesures, signature, provenance, état et documents, puis gagnera des champs spécialisés.',
    availability: 'standard-pending',
    availabilityLabel: 'Fiche standard à ouvrir au public',
  },
] as const;

export const OBJECTS_FAQ_ANSWER = `Cartularia documente déjà les montres et les voitures avec un Cartulaire dédié. La cible couvre aussi, sans être exhaustive, les bijoux, l’or en pièces ou lingots, le vin, la peinture et la sculpture : ces objets utiliseront d’abord une fiche standard, puis des Cartulaires spécialisés seront ajoutés progressivement. Dans le pilote actuel, ce parcours standard n’est pas encore ouvert à la création ; il ne faut donc pas enregistrer ces objets sous un profil montre ou voiture.`;

export interface DeliverableDetail {
  slug: string;
  title: string;
  shortTitle: string;
  icon: PublicIconName;
  summary: string;
  utility: string;
  features: readonly string[];
  example: string;
  screenshot: string;
  screenshotAlt: string;
  screenshotCaption: string;
  directHref: string;
  directLabel: string;
  limit?: string;
}

const CAPTURE_ROOT = '/assets/public/captures';

export const DELIVERABLE_DETAILS: readonly DeliverableDetail[] = [
  {
    slug: 'cartulaire',
    title: 'Le Cartulaire',
    shortTitle: 'Le Cartulaire',
    icon: 'book',
    summary: 'Le dossier vivant d’un objet, organisé en pages cohérentes et enrichi dans la durée.',
    utility: 'Réunir les faits, médias, documents, observations, révisions et valeurs d’un objet sans disperser les preuves.',
    features: ['Six pages communes de consultation', 'Champs adaptés au type d’objet disponible', 'Médias et documents indexés', 'Démonstration fictive en lecture seule'],
    example: 'Le Cartulaire fictif de la Rolex Submariner 124060 présente sa référence, ses photographies, son état déclaré, ses révisions simulées et une valorisation pédagogique.',
    screenshot: `${CAPTURE_ROOT}/cartulaire-accueil.webp`,
    screenshotAlt: 'Capture du Cartulaire de démonstration Rolex Submariner, en lecture seule, sur sa page d’accueil',
    screenshotCaption: 'Capture réelle de la démonstration locale, données entièrement fictives.',
    directHref: DEMO_SUBMARINER_HREF,
    directLabel: 'Ouvrir le Cartulaire fictif',
  },
  {
    slug: 'registre',
    title: 'Le Registre',
    shortTitle: 'Le Registre',
    icon: 'archive',
    summary: 'L’espace principal pour retrouver, filtrer et piloter les Cartulaires et les Collections.',
    utility: 'Voir les objets réunis, leurs états de suivi et les données patrimoniales disponibles avant d’ouvrir un dossier.',
    features: ['Catalogue des objets', 'Vue d’ensemble et agrégats', 'Collections et suivi', 'Compte de démonstration strictement en lecture seule'],
    example: 'Le Registre fictif « Les cinq icônes » réunit cinq montres de démonstration et permet de passer de la vue globale à chaque Cartulaire.',
    screenshot: `${CAPTURE_ROOT}/registre-demo.webp`,
    screenshotAlt: 'Capture du Registre de démonstration présentant cinq montres fictives',
    screenshotCaption: 'Capture du Registre de démonstration en lecture seule, réalisée avec le compte fictif.',
    directHref: '/account/sign-in?demo=1',
    directLabel: 'Accéder au Registre démo',
  },
  {
    slug: 'collection',
    title: 'La Collection',
    shortTitle: 'La Collection',
    icon: 'layers',
    summary: 'Un regroupement choisi d’objets, privé par défaut et publiable objet par objet après confirmation.',
    utility: 'Organiser un ensemble cohérent, suivre son contenu et préparer une présentation limitée aux objets explicitement choisis.',
    features: ['Regroupement dans le Registre', 'Description de la Collection', 'Publication confirmée objet par objet', 'Projection publique distincte des dossiers privés'],
    example: 'La Collection fictive « Les cinq icônes » regroupe cinq références ; une publication peut n’en exposer qu’une sélection confirmée.',
    screenshot: `${CAPTURE_ROOT}/collection-demo.webp`,
    screenshotAlt: 'Capture de la Collection de démonstration Les cinq icônes avec des objets fictifs',
    screenshotCaption: 'Capture de la vue Collection du Registre de démonstration, sans donnée réelle.',
    directHref: '/account/sign-in?demo=1',
    directLabel: 'Découvrir le Registre démo',
    limit: 'La Collection reste privée tant qu’une publication explicite n’est pas confirmée. Une capture publique n’est pas substituée à cette décision.',
  },
  {
    slug: 'mini-site',
    title: 'Le Mini Site (extrait de Cartulaire ou Collection)',
    shortTitle: 'Le Mini Site',
    icon: 'globe',
    summary: 'Une projection web limitée aux blocs d’un Cartulaire ou aux objets confirmés d’une Collection.',
    utility: 'Présenter à un tiers un extrait choisi sans ouvrir le dossier privé ni le Registre.',
    features: ['Origine Cartulaire ou Collection', 'Sélection explicite des contenus', 'Données personnelles exclues des champs projetés', 'Accès révocable pour les consultations futures'],
    example: 'Un propriétaire publie les vues générales et la référence de la Submariner fictive, sans ses documents privés ni ses coordonnées.',
    screenshot: `${CAPTURE_ROOT}/mini-site-demo.webp`,
    screenshotAlt: 'Capture de l’aperçu local du mini site fictif Rolex Submariner',
    screenshotCaption: 'Aperçu local réellement rendu avec la sélection de démonstration ; aucune publication n’est déclenchée.',
    directHref: DEMO_SUBMARINER_WEBSITE_HREF,
    directLabel: 'Ouvrir le mini site fictif',
    limit: 'La révocation bloque les nouveaux accès mais ne supprime pas les copies déjà reçues ou téléchargées.',
  },
  {
    slug: 'rapport-pdf',
    title: 'Le rapport PDF',
    shortTitle: 'Le rapport PDF',
    icon: 'file',
    summary: 'Une synthèse imprimable du dossier, à enregistrer en PDF depuis le navigateur.',
    utility: 'Préparer un support lisible pour un assureur, un conseil ou un tiers, puis vérifier le fichier avant transmission.',
    features: ['Mise en page dédiée à l’impression', 'Synthèse des sections disponibles', 'Pièces et limites contextualisées', 'Enregistrement par la fonction PDF du navigateur'],
    example: 'La valorisation fictive de la Submariner est replacée avec sa date, ses sources simulées et les réserves qui empêchent de la prendre pour une expertise.',
    screenshot: `${CAPTURE_ROOT}/cartulaire-publication.webp`,
    screenshotAlt: 'Capture de la page Publication du Cartulaire fictif avec la commande de préparation du rapport PDF',
    screenshotCaption: 'Écran réel de préparation du rapport ; la capture ne génère et ne télécharge aucun fichier.',
    directHref: `${DEMO_SUBMARINER_HREF.replace('#cover', '')}#publication`,
    directLabel: 'Voir les options de rapport',
    limit: 'Le PDF n’est ni une expertise, ni une garantie d’assurance, ni un titre de propriété.',
  },
  {
    slug: 'sceau-integrite',
    title: "Le Sceau d'intégrité",
    shortTitle: "Le Sceau d'intégrité",
    icon: 'fingerprint',
    summary: 'Le moyen de vérifier qu’une version documentée correspond encore à son empreinte.',
    utility: 'Détecter une modification du contenu canonique et conserver, lorsqu’elle est confirmée, la preuve d’un horodatage externe.',
    features: ['Empreinte de la version', 'État de vérification explicite', 'Horodatage externe identifié lorsqu’il existe', 'Éléments de preuve exportables'],
    example: 'La version fictive du dossier expose son état de vérification et distingue une empreinte locale d’une preuve externe confirmée.',
    screenshot: `${CAPTURE_ROOT}/sceau-integrite.webp`,
    screenshotAlt: 'Capture du panneau Preuves du Cartulaire fictif avec la preuve serveur et ses limites',
    screenshotCaption: 'Panneau réel de la démonstration ; la chaîne est explicitement fictive et ne certifie pas l’authenticité de l’objet.',
    directHref: DEMO_SUBMARINER_PROOFS_HREF,
    directLabel: 'Ouvrir les Preuves dans la démo',
    limit: 'Une empreinte ou une date ne prouve à elle seule ni authenticité, ni propriété, ni véracité des déclarations.',
  },
  {
    slug: 'cercle',
    title: 'Le Cercle',
    shortTitle: 'Le Cercle',
    icon: 'circle',
    summary: 'Un espace séparé, soumis à admission, pour présenter des blocs choisis et échanger autour des objets.',
    utility: 'Partager une publication limitée avec une communauté autorisée sans exposer le Cartulaire privé.',
    features: ['Accès soumis à admission', 'Publication de blocs autorisés', 'Profils et échanges communautaires', 'Séparation avec le Registre privé'],
    example: 'Un membre admis publie une sélection fictive de caractéristiques et de médias, puis conserve son dossier maître hors du Cercle.',
    screenshot: `${CAPTURE_ROOT}/cercle-acces.webp`,
    screenshotAlt: 'Capture de l’écran d’accès au Cercle Cartularia',
    screenshotCaption: 'Capture de l’accès réel au Cercle ; l’admission reste requise.',
    directHref: '/community',
    directLabel: 'Voir les modalités du Cercle',
    limit: 'La page publique ne simule aucune admission et ne publie aucun dossier.',
  },
  {
    slug: 'todo-list',
    title: 'Une todo list pour gérer votre patrimoine',
    shortTitle: 'Une todo list pour gérer votre patrimoine',
    icon: 'list',
    summary: 'Le suivi des tâches, rappels et échéances rattachés aux objets du Registre.',
    utility: 'Identifier ce qui reste à documenter, entretenir ou vérifier et suivre l’avancement sans dupliquer les dossiers.',
    features: ['Tâches planifiées ou terminées', 'Échéances et catégories', 'Vue dans le Cartulaire et centre de suivi du Registre', 'Lecture seule dans la démonstration'],
    example: 'Le dossier fictif peut signaler un contrôle d’étanchéité à renouveler et la collecte d’une pièce justificative manquante.',
    screenshot: `${CAPTURE_ROOT}/todo-demo.webp`,
    screenshotAlt: 'Capture de la liste À Faire du Cartulaire fictif avec ses tâches de démonstration',
    screenshotCaption: 'Capture de la liste réelle de suivi, avec données et échéances fictives.',
    directHref: DEMO_SUBMARINER_HREF,
    directLabel: 'Voir le suivi dans la démo',
  },
] as const;

export const deliverableFromPathname = (pathname: string) => {
  const slug = pathname.replace(/\/$/, '').split('/').at(-1);
  return DELIVERABLE_DETAILS.find((item) => item.slug === slug) ?? null;
};

export const contactReasonFromSearch = (search: string) => {
  const candidate = new URLSearchParams(search).get('motif');
  return candidate === PROFESSIONAL_MEDIA_HELP_REASON ? candidate : '';
};
