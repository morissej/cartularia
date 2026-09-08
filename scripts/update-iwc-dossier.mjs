import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';
import {
  processPrivateDraftUpload,
  PRIVATE_UPLOAD_VERIFICATION_VERSION,
} from './lib/private-upload-command.mjs';
import { processCartularySyncRequest } from './lib/live-sync-command.mjs';

const OWNER_UID = process.env.CARTULARIA_OWNER_UID || 'wave1-owner';
const UPDATE_DATE = '2026-08-29';
const sourceDirectoryInput = process.env.IWC_SOURCE_DIRECTORY;
if (!sourceDirectoryInput) throw new Error('IWC_SOURCE_DIRECTORY est requis.');
const sourceDirectory = resolve(sourceDirectoryInput);
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : null);
const usesEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && (
  process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST
));
const allowRemote = process.argv.includes('--allow-remote');
const dryRun = process.argv.includes('--dry-run');

if (!projectId) throw new Error('GCLOUD_PROJECT ou FIREBASE_PROJECT_ID est requis.');
if (!storageBucket) throw new Error('FIREBASE_STORAGE_BUCKET est requis.');
if (!usesEmulators && !allowRemote && !dryRun) {
  throw new Error('Mise à jour interrompue : utilisez les émulateurs, --dry-run ou passez explicitement --allow-remote.');
}

const MIME_BY_EXTENSION = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
};

const supportedUploadExtensions = new Set(['.jpeg', '.jpg', '.mov', '.pdf']);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'fr'))) {
    if (entry.name === '.DS_Store') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const slug = (value) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 72);

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const isoDateFor = (relativePath, modifiedAt) => {
  if (relativePath.startsWith(`MAJ Etat${sep}2022${sep}`)) return '2022-07-06';
  if (/_[Dd][Ss][Cc]0/.test(relativePath)) return '2026-08-05';
  if (/_DSC11(?:56|57|58|59|60)\.jpg$/i.test(relativePath)) return '2026-08-28';
  if (/DSC_1265\.MOV$/i.test(relativePath)) return '2026-08-26';
  return modifiedAt.toISOString().slice(0, 10);
};

const mediaCategoryFor = (relativePath) => {
  if (relativePath.startsWith(`Achat${sep}`) || relativePath.startsWith(`Rapports analyses${sep}`)) return 'documentation';
  if (relativePath.includes(`${sep}2022${sep}IMG_1864`)) return 'boite';
  if (relativePath.includes(`${sep}2022${sep}IMG_1867`)) return 'ensemble';
  if (/_DSC097[678]-3\.jpg$/i.test(relativePath)) return 'mouvement';
  if (/_DSC098[01]-3\.jpg$/i.test(relativePath)) return 'mouvement';
  if (/_DSC115[6-9]\.jpg$|_DSC1160\.jpg$/i.test(relativePath)) return 'accessoire';
  return 'ensemble';
};

const mediaDescriptionFor = (relativePath) => {
  if (/Facture montre IWC\.pdf$/i.test(relativePath)) return 'Facture d’achat originale du 8 mars 2002. Original privé contenant des données personnelles.';
  if (/DSC_1265\.MOV$/i.test(relativePath)) return 'Séquence vidéo privée ajoutée au relevé d’état d’août 2026.';
  if (/IMG_1863\.jpeg$/i.test(relativePath)) return 'Vue de face datée du 6 juillet 2022 : cadran, aiguilles, disque UTC, date et bracelet.';
  if (/IMG_1864\.jpeg$/i.test(relativePath)) return 'Vue du fond datée du 6 juillet 2022 : gravure IWC et numéro 2715537 lisible.';
  if (/IMG_1867\.jpeg$/i.test(relativePath)) return 'Photographie de détention datée du 6 juillet 2022. Média strictement privé.';
  if (/_DSC0975-3\.jpg$/i.test(relativePath)) return 'Vue frontale macro du cadran, des affichages, du boîtier et des cornes.';
  if (/_DSC0976-3\.jpg$/i.test(relativePath)) return 'Vue extérieure du fond portant le numéro 2715537.';
  if (/_DSC0977-3\.jpg$/i.test(relativePath)) return 'Vue intérieure du fond portant le numéro 2715537 et la référence 3251.';
  if (/_DSC0980-3\.jpg$|_DSC0981-3\.jpg$/i.test(relativePath)) return 'Vue du calibre automatique IWC, rotor signé et mention 21 jewels.';
  if (/_DSC115[6-9]\.jpg$/i.test(relativePath)) return 'Montre dans sa boîte IWC d’origine ; présence et état de l’écrin documentés.';
  if (/_DSC1160\.jpg$/i.test(relativePath)) return 'Vue du revêtement extérieur de la boîte IWC, fortement dégradé.';
  if (/téléchargement\.jpeg$|téléchargement\.jpeg$/i.test(relativePath)) return 'Image de référence externe ; ne constitue pas une preuve propre à l’exemplaire.';
  return 'Vue photographique du relevé d’état d’août 2026.';
};

const buildSpecificationGroups = () => [
  {
    id: 'basic', title: 'Données de base', items: [
      { id: 'ad-code', label: 'Code annonce', value: 'Non applicable · dossier OP-4892-XZ9' },
      { id: 'brand', label: 'Marque', value: 'IWC Schaffhausen' },
      { id: 'collection', label: 'Collection', value: 'Pilot’s Watches' },
      { id: 'model', label: 'Modèle', value: 'Flieger UTC (Die Fliegeruhr)' },
      { id: 'reference', label: 'Numéro de référence', value: 'IW3251-001 · 3251-001' },
      { id: 'movement', label: 'Mouvement', value: 'Remontage automatique' },
      { id: 'case', label: 'Boîtier', value: 'Acier, brossé avec fins chanfreins polis de référence' },
      { id: 'bracelet', label: 'Matière du bracelet', value: 'Cuir marron patiné' },
      { id: 'year', label: 'Année de fabrication', value: '2002' },
      { id: 'condition', label: 'État', value: 'État d’usage documenté · voir 03 · L’objet' },
      { id: 'delivered', label: 'Contenu livré', value: 'Montre, boîte IWC et facture d’achat ; carte de garantie et manuel non retrouvés dans le dossier versé' },
      { id: 'gender', label: 'Sexe', value: 'Montre homme / Unisexe' },
      { id: 'location', label: 'Emplacement', value: 'Accès restreint' },
      { id: 'price', label: 'Prix', value: 'Voir 04 · Valorisation' },
      { id: 'availability', label: 'Disponibilité', value: 'Collection privée · conserver selon la note du 18/08/2026' },
    ],
  },
  {
    id: 'caliber', title: 'Calibre', items: [
      { id: 'cal-movement', label: 'Mouvement', value: 'Automatique · 28 800 alternances/heure · stop seconde' },
      { id: 'caliber', label: 'Calibre', value: 'IWC 37526 · module TZC' },
      { id: 'base-caliber', label: 'Calibre de base', value: 'ETA 2893-2 selon les sources les mieux recoupées ; divergence interne avec ETA 2892-A2 + module IWC' },
      { id: 'power-reserve', label: 'Réserve de marche', value: 'Environ 42 heures' },
      { id: 'jewels', label: 'Nombre de pierres', value: '21 · visible sur le rotor et confirmé par plusieurs sources' },
    ],
  },
  {
    id: 'case', title: 'Boîtier', items: [
      { id: 'case-material', label: 'Boîtier', value: 'Acier inoxydable, protection antimagnétique interne en fer doux' },
      { id: 'diameter', label: 'Diamètre', value: '39,0 mm' },
      { id: 'height', label: 'Hauteur', value: '13,5 mm' },
      { id: 'water', label: 'Étanche', value: '60 m · 6 bar (valeur constructeur ; contrôle actuel non fourni)' },
      { id: 'bezel', label: 'Matériau de la lunette', value: 'Acier, fixe' },
      { id: 'crystal', label: 'Verre', value: 'Saphir bombé' },
      { id: 'dial', label: 'Cadran', value: 'Noir, chiffres arabes, mentions Universal Time Coordinated et TZC Automatic' },
      { id: 'numerals', label: 'Chiffres du cadran', value: 'Arabes peints ; matière lumineuse exacte à confirmer pour cet exemplaire de transition' },
    ],
  },
  {
    id: 'bracelet', title: 'Bracelet', items: [
      { id: 'strap-material', label: 'Matière du bracelet', value: 'Cuir marron, fortement patiné ; configuration catalogue -001 en buffle marron' },
      { id: 'strap-color', label: 'Couleur du bracelet', value: 'Marron foncé' },
      { id: 'clasp', label: 'Boucle', value: 'Boucle ardillon IWC déclarée ; vue macro dédiée à compléter' },
      { id: 'clasp-material', label: 'Matière de la boucle', value: 'Acier' },
    ],
  },
  {
    id: 'functions', title: 'Fonctions', items: [
      { id: 'date', label: 'Date', value: 'Guichet à 3 heures ; date liée à l’heure locale dans les deux sens' },
      { id: 'gmt', label: 'GMT', value: 'Heure de référence sur disque UTC 24 heures à 12 heures' },
      { id: 'timezone', label: 'Second fuseau horaire', value: 'Heure locale sautante par pas de ±1 h via le module TZC' },
    ],
  },
  {
    id: 'other', title: 'Autres', items: [
      { id: 'seconds', label: 'Seconde', value: 'Seconde centrale' },
      { id: 'crown', label: 'Couronne', value: 'Type et gravure à confirmer sur une vue dédiée ; la couronne poisson est attendue mais non établie par le dossier actuel' },
      { id: 'caseback', label: 'Fond', value: 'Fond plein acier vissé ; extérieur et intérieur photographiés le 05/08/2026' },
    ],
  },
];

const identificationChecks = [
  { id: 'identity-invoice-case', title: 'Référence et numéro corrélés', note: 'La facture du 08.03.2002 porte 3251-001 et 2715537 ; le même numéro est lisible sur les vues extérieure et intérieure du fond.', checked: true },
  { id: 'dial-tzc', title: 'Cadran et affichages cohérents', note: 'Cadran noir, mentions Universal Time Coordinated et TZC Automatic, disque 24 h et date à 3 h visibles sur les vues 2022 et 2026.', checked: true },
  { id: 'movement-37526', title: 'Mouvement IWC documenté', note: 'Mouvement automatique photographié ouvert, rotor IWC signé et mention 21 jewels visibles. Le numéro de mouvement interne reste à lire sur une vue dédiée.', checked: true },
  { id: 'box-present', title: 'Boîte IWC présente', note: 'Boîte et coussin photographiés le 28.08.2026 ; revêtement extérieur fortement dégradé.', checked: true },
  { id: 'case-geometry', title: 'Géométrie et niveau de polissage', note: 'Les cornes et finitions sont documentées, mais l’absence de sur-polissage nécessite une revue experte ou des mesures.', checked: false },
  { id: 'fish-crown', title: 'Couronne « poisson »', note: 'Élément attendu pour la période selon le rapport interne, mais la gravure n’est pas lisible sur les fichiers versés.', checked: false },
  { id: 'functional-test', title: 'Fonctions UTC, date et étanchéité', note: 'Les affichages sont visibles. Aucun compte rendu de test de marche, de correction bidirectionnelle, de réserve ou d’étanchéité n’est fourni.', checked: false },
  { id: 'lume-transition', title: 'Matière lumineuse', note: 'Exemplaire de 2002 en période de transition tritium / Super-LumiNova ; nature exacte à déterminer par marquage et test de luminescence.', checked: false },
];

const editableCopy = {
  originTitle: 'Une montre de pilote pensée pour voyager',
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
};

const marketHistory = [
  { id: 'val-2026-conservative', date: '2026-08-18', lowValue: 2500, midValue: 2900, highValue: 3300, currency: 'EUR', confidence: 'Moyenne', source: 'Croisement note de cession du 18/08/2026 et revue Chrono24 du 08/08/2026 ; scénarios selon boîte et révision', visibility: 'Secret' },
  { id: 'val-2026-serviced', date: '2026-08-18', lowValue: 2900, midValue: 3300, highValue: 3600, currency: 'EUR', confidence: 'Moyenne', source: 'Scénario après révision documentée, boîte présente, papiers à confirmer', visibility: 'Secret' },
];

const comparables = [
  { id: 'comp-c24-low', date: '2026-08-08', channel: 'Chrono24 · particulier US', description: 'IW325101, prix demandé le plus bas de l’échantillon', amount: 2576, currency: 'EUR', condition: 'Configuration non homogénéisée', sourceType: 'Annonce', source: 'Revue Chrono24 du dossier', saleChannel: 'Annonce' },
  { id: 'comp-c24-2002-box', date: '2026-08-08', channel: 'Chrono24 · marchand italien', description: 'Exemplaire 2002, très bon état, boîte sans papiers', amount: 3500, currency: 'EUR', condition: 'Très bon · boîte · sans papiers', sourceType: 'Annonce', source: 'Revue Chrono24 du dossier', saleChannel: 'Marchand' },
  { id: 'comp-c24-fullset', date: '2026-08-08', channel: 'Chrono24 · marchand suisse', description: 'IW325101 full set avec certificat et garantie professionnelle', amount: 4606, currency: 'EUR', condition: 'Très bon · full set', sourceType: 'Annonce', source: 'Revue Chrono24 du dossier', saleChannel: 'Marchand' },
  { id: 'comp-auction-range', date: '2026-08-18', channel: 'Vente publique', description: 'Fourchette de résultats publics citée dans la note de cession', amount: 2050, currency: 'EUR', condition: 'Variable', sourceType: 'Estimation', source: 'Note de cession du 18/08/2026', saleChannel: 'Enchère' },
];

const comparableAnalysis = [
  { id: 'analysis-depth', angle: 'Profondeur Chrono24', finding: '19 annonces exactes', reading: 'Marché de niche mais comparable ; l’échantillon reste trop petit pour traiter l’indice comme une transaction certaine.' },
  { id: 'analysis-listings', angle: 'Prix demandés', finding: '2 576 € à 4 606 €', reading: 'Moyenne 3 521 €, médiane 3 550 €. La dispersion reflète surtout la dotation, l’état, la révision et la garantie marchand.' },
  { id: 'analysis-owner-case', angle: 'Scénario avec boîte', finding: '2 900 € à 3 300 €', reading: 'Fourchette de transaction probable citée par la revue Chrono24 pour un exemplaire avec boîte sans papiers.' },
  { id: 'analysis-as-is', angle: 'Scénario prudent en l’état', finding: '2 500 €', reading: 'Valeur de l’exemplaire retenue par la note de cession en l’absence de révision récente documentée.' },
  { id: 'analysis-service', angle: 'Après révision', finding: '3 300 €', reading: 'Scénario central après révision documentée ; le coût annoncé de 250 à 400 € doit être confirmé par devis.' },
  { id: 'analysis-decision', angle: 'Décision du rapport', finding: 'CONSERVER', reading: 'Thèse fondée sur le faible coût de portage et la réparabilité, avec revue annuelle des résultats de vente publique.' },
];

const documentationItems = [
  { id: 'doc-invoice', category: 'Facture', description: 'Facture Aldebert du 08.03.2002 : référence 3251-001, numéro 2715537 et prix 3 200 €. Original nominatif conservé en accès privé.', state: 'Présent' },
  { id: 'doc-box', category: 'Boîte', description: 'Boîte et coussin IWC photographiés le 28.08.2026 ; revêtement extérieur fortement dégradé.', state: 'Présent' },
  { id: 'doc-warranty', category: 'Garantie', description: 'Aucune carte de garantie distincte n’est présente dans les fichiers versés ; à rechercher physiquement.', state: 'À vérifier' },
  { id: 'doc-manual', category: 'Manuel', description: 'Aucun manuel original n’est présent dans les fichiers versés.', state: 'À vérifier' },
  { id: 'doc-analysis', category: 'Certificat', description: 'Cinq rapports et analyses internes datés d’août 2026 sont indexés ; ils ne constituent pas un certificat IWC ni une expertise physique indépendante.', state: 'Présent' },
  { id: 'doc-video', category: 'Autre', description: 'Une vidéo privée DSC_1265.MOV, datée du 26.08.2026, complète le relevé.', state: 'Présent' },
];

const app = getApps()[0] || initializeApp({
  projectId,
  storageBucket,
  ...(usesEmulators ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const storage = getStorage(app);
const bucket = storage.bucket(storageBucket);

const sourcePaths = await walk(sourceDirectory);
const records = [];
for (const path of sourcePaths) {
  const fileStat = await stat(path);
  const bytes = await readFile(path);
  const relativePath = relative(sourceDirectory, path);
  const extension = extname(path).toLowerCase();
  const digest = sha256(bytes);
  const idSuffix = digest.slice('sha256:'.length, 'sha256:'.length + 12);
  records.push({
    path,
    relativePath,
    extension,
    mimeType: MIME_BY_EXTENSION[extension] || 'application/octet-stream',
    size: fileStat.size,
    sha256: digest,
    capturedAt: isoDateFor(relativePath, fileStat.mtime),
    assetId: `iwc-${slug(relativePath)}-${idSuffix}`.slice(0, 150),
    binaryId: `iwc_${slug(relativePath).replaceAll('-', '_')}_${idSuffix}`.slice(0, 150),
    uploadSupported: supportedUploadExtensions.has(extension),
  });
}

const counts = records.reduce((result, record) => {
  const key = record.mimeType.startsWith('image/') ? 'images'
    : record.mimeType.startsWith('video/') ? 'videos'
      : 'documents';
  result[key] += 1;
  return result;
}, { images: 0, videos: 0, documents: 0 });

if (dryRun) {
  console.log(JSON.stringify({
    event: 'IWC_DOSSIER_DRY_RUN',
    projectId,
    sourceDirectory,
    fileCount: records.length,
    counts,
    supportedUploads: records.filter((record) => record.uploadSupported).length,
    localOnlyDocuments: records.filter((record) => !record.uploadSupported).map((record) => ({ path: record.relativePath, sha256: record.sha256 })),
  }, null, 2));
  process.exit(0);
}

const draftRef = firestore.doc(`privateDrafts/${OWNER_UID}/cartularies/${IWC_CARTULARY_ID}`);
await draftRef.set({
  ownerUid: OWNER_UID,
  cartularyId: IWC_CARTULARY_ID,
  status: 'active',
  retentionPolicyVersion: 'inactive-plus-2y-v1',
  purgeAfter: null,
  lastActiveAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

let uploaded = 0;
let reused = 0;
const acceptedBinaryIds = new Set();
for (const record of records.filter((candidate) => candidate.uploadSupported)) {
  const binaryRef = draftRef.collection('binaries').doc(record.binaryId);
  const existing = await binaryRef.get();
  const existingData = existing.data();
  const digest = record.sha256.slice('sha256:'.length);
  const storagePath = `private-drafts/${OWNER_UID}/${IWC_CARTULARY_ID}/${record.binaryId}/${digest}/original`;
  if (
    existing.exists
    && existingData?.sha256 === record.sha256
    && existingData?.storagePath === storagePath
    && existingData?.uploadStatus === 'ready'
    && existingData?.verificationStatus === 'accepted'
    && existingData?.verificationVersion === PRIVATE_UPLOAD_VERIFICATION_VERSION
  ) {
    reused += 1;
    acceptedBinaryIds.add(record.binaryId);
    console.log(JSON.stringify({ event: 'IWC_FILE_REUSED', path: record.relativePath, size: record.size }));
    continue;
  }

  const kind = record.extension === '.pdf' ? 'condition_attachment' : 'media';
  await binaryRef.set({
    ownerUid: OWNER_UID,
    cartularyId: IWC_CARTULARY_ID,
    binaryId: record.binaryId,
    deleted: false,
    revision: Number(existingData?.revision || 0) + 1,
    fileName: record.relativePath.split(sep).at(-1),
    mimeType: record.mimeType,
    size: record.size,
    sha256: record.sha256,
    kind,
    storagePath,
    clientUpdatedAt: Date.now(),
    uploadStatus: 'verifying',
    verificationStatus: 'processing',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(JSON.stringify({ event: 'IWC_FILE_UPLOAD_STARTED', path: record.relativePath, size: record.size }));
  await bucket.upload(record.path, {
    destination: storagePath,
    resumable: false,
    metadata: {
      contentType: record.mimeType,
      metadata: {
        ownerUid: OWNER_UID,
        cartularyId: IWC_CARTULARY_ID,
        binaryId: record.binaryId,
        sha256: record.sha256,
        kind,
        sourceRelativePath: record.relativePath,
      },
    },
  });
  console.log(JSON.stringify({ event: 'IWC_FILE_UPLOAD_FINISHED', path: record.relativePath, size: record.size }));
  const [objectMetadata] = await bucket.file(storagePath).getMetadata();
  console.log(JSON.stringify({ event: 'IWC_FILE_VERIFICATION_STARTED', path: record.relativePath }));
  const verification = await processPrivateDraftUpload({ firestore, storage, object: objectMetadata });
  if (verification.status !== 'accepted') {
    throw new Error(`Fichier refusé après contrôle : ${record.relativePath} (${verification.reason || 'motif inconnu'}).`);
  }
  acceptedBinaryIds.add(record.binaryId);
  uploaded += 1;
  console.log(JSON.stringify({ event: 'IWC_FILE_ACCEPTED', path: record.relativePath, format: verification.format }));
}

const mediaAssets = records.map((record) => {
  const isImage = record.mimeType.startsWith('image/');
  const isVideo = record.mimeType.startsWith('video/');
  const isMainPhoto = /_DSC0994-3\.jpg$/i.test(record.relativePath);
  const isBox = /_DSC115[6-9]\.jpg$|_DSC1160\.jpg$/i.test(record.relativePath);
  return {
    id: record.assetId,
    name: record.relativePath.split(sep).at(-1),
    originalFileName: record.relativePath.split(sep).at(-1),
    url: '',
    type: isImage ? 'image' : isVideo ? 'video' : 'document',
    ratio: isVideo ? '16:9' : undefined,
    hash: record.sha256,
    status: 'Archived',
    visibility: 'Secret',
    tags: isMainPhoto
      ? ['main-photo', 'slideshow']
      : isVideo
        ? ['main-video', 'slideshow']
        : record.mimeType === 'application/pdf' || !record.uploadSupported
          ? ['documentation']
          : isBox
            ? ['accessories', 'slideshow']
            : ['slideshow'],
    category: mediaCategoryFor(record.relativePath),
    description: mediaDescriptionFor(record.relativePath),
    capturedAt: record.capturedAt,
    metadataTimestamp: record.capturedAt,
    timestampSource: record.relativePath.startsWith(`MAJ Etat${sep}`) ? 'exif.DateTimeOriginal' : 'file.lastModified',
    fileSize: `${(record.size / 1024 / 1024).toFixed(record.size >= 1024 * 1024 ? 1 : 3)} Mo`,
    mimeType: record.mimeType,
    binaryId: acceptedBinaryIds.has(record.binaryId) ? record.binaryId : undefined,
    localAvailability: acceptedBinaryIds.has(record.binaryId) ? 'missing' : 'available',
    derivativeStatus: isImage && acceptedBinaryIds.has(record.binaryId) ? 'ready' : 'not-required',
    sourceSection: !isImage && !isVideo ? 'reference-report' : undefined,
  };
});

const attachmentFor = (record) => ({
  id: `attachment-${record.assetId}`.slice(0, 160),
  name: record.relativePath.split(sep).at(-1),
  size: record.size,
  type: record.mimeType,
  binaryId: acceptedBinaryIds.has(record.binaryId) ? record.binaryId : undefined,
  sha256: record.sha256,
});

const recordsIn = (prefix) => records.filter((record) => record.relativePath.startsWith(prefix));
const conditionEntries = [
  {
    id: 'iwc-update-2026-08-28-box',
    date: '2026-08-28',
    title: 'Boîte et dotation photographiées',
    note: 'La boîte IWC et son coussin sont présents. Le revêtement extérieur blanc est fortement écaillé et dégradé. Aucune carte de garantie ni manuel distinct n’apparaît dans les fichiers versés.',
    attachments: records.filter((record) => /_DSC115[6-9]\.jpg$|_DSC1160\.jpg$/i.test(record.relativePath)).map(attachmentFor),
  },
  {
    id: 'iwc-update-2026-08-26-video',
    date: '2026-08-26',
    title: 'Vidéo du relevé d’août 2026',
    note: 'Séquence vidéo originale conservée en accès propriétaire. Le conteneur QuickTime et l’empreinte ont été contrôlés ; aucune conclusion fonctionnelle n’est tirée sans visionnage expert documenté.',
    attachments: records.filter((record) => /DSC_1265\.MOV$/i.test(record.relativePath)).map(attachmentFor),
  },
  {
    id: 'iwc-update-2026-08-05-inspection',
    date: '2026-08-05',
    title: 'Inspection photographique et mouvement ouvert',
    note: 'Série de 17 vues Nikon : cadran et boîtier, fond extérieur et intérieur, numéro 2715537, calibre automatique IWC signé et mention 21 jewels. Les images documentent la configuration mais ne remplacent ni test de marche ni expertise physique.',
    attachments: records.filter((record) => /_DSC0.*-[23]\.jpg$/i.test(record.relativePath)).map(attachmentFor),
  },
  {
    id: 'iwc-update-2022-07-06',
    date: '2022-07-06',
    title: 'Relevé photographique antérieur',
    note: 'Trois vues iPhone du 06.07.2022 : face, fond numéroté et photographie de détention. Cette dernière demeure strictement privée.',
    attachments: recordsIn(`MAJ Etat${sep}2022${sep}`).map(attachmentFor),
  },
  {
    id: 'iwc-update-2026-08-analysis',
    date: UPDATE_DATE,
    title: 'Rapports et analyses consolidés',
    note: 'Cinq analyses d’août 2026 indexées par empreinte : caractéristiques de référence, analyse modèle, note de cession, revue Chrono24 et guide d’authentification. Les affirmations divergentes sont conservées comme telles.',
    attachments: recordsIn(`Rapports analyses${sep}`).map(attachmentFor),
  },
  {
    id: 'iwc-purchase-2002-03-08',
    date: '2002-03-08',
    title: 'Facture d’achat originale',
    note: 'Facture Aldebert du 08.03.2002 : IWC Flieger UTC 3251-001, numéro 2715537 et prix 3 200 €. Le document nominatif reste Secret et accessible au seul propriétaire.',
    attachments: recordsIn(`Achat${sep}`).map(attachmentFor),
  },
];

const ownerDocuments = records
  .filter((record) => record.mimeType === 'application/pdf' || record.mimeType === 'text/markdown' || record.mimeType === 'application/rtf')
  .map((record) => ({
    id: `owner-${record.assetId}`.slice(0, 160),
    category: /Facture/i.test(record.relativePath) ? 'Facture' : 'Analyse',
    fileName: record.relativePath.split(sep).at(-1),
    size: record.size,
    type: record.mimeType,
    binaryId: acceptedBinaryIds.has(record.binaryId) ? record.binaryId : undefined,
    sha256: record.sha256,
  }));

const creationProfile = {
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
  assertedAt: `${UPDATE_DATE}T00:00:00.000Z`,
};

const stateValues = new Map([
  // ADR-029 : le Cartulaire complet n'a plus de repli IWC codé ; le brouillon privé porte tout.
  ['cartularia-creation-profile', creationProfile],
  ['cartularia-public-code', 'OP-4892-XZ9'],
  ['cartularia-sensitivity-prices', [3200, 3600, 4000, 4400, 4800]],
  ['cartularia-specification-groups', buildSpecificationGroups()],
  ['cartularia-identification-checks', identificationChecks],
  ['cartularia-condition-entries', conditionEntries],
  ['cartularia-documentation-items', documentationItems],
  ['cartularia-owner-documents', ownerDocuments],
  ['cartularia-editable-copy', editableCopy],
  ['cartularia-media-assets-v3', mediaAssets],
  ['cartularia-market-depth', { analysisDate: '2026-08-08', activeListings: 19, transactions12m: 0, medianDaysOnMarket: 0, lowValue: 2576, midValue: 3521, highValue: 4606 }],
  ['cartularia-market-history', marketHistory],
  ['cartularia-comparables', comparables],
  ['cartularia-comparable-analysis', comparableAnalysis],
  ['cartularia-retained-valuation', { amount: 2500, saleCostAmount: 375, taxAmount: 0, explanation: 'Valeur prudente en l’état selon la note du 18/08/2026, sans révision récente documentée. Scénario après révision : environ 3 300 €. La boîte est présente ; garantie et manuel restent à confirmer.' }],
  ['cartularia-purchase', { date: '2002-03-08', purchasePrice: 3200 }],
  ['cartularia-purchase-expenses', []],
  ['cartularia-exit-assumptions', { saleDate: UPDATE_DATE, salePrice: 2500, disposalCostPct: 15 }],
  ['cartularia-watch-status', 'Patrimonial'],
  ['cartularia-popularity-resources', [
    { id: 'pop-iwc-forum', name: 'IWC Collectors Forum', type: 'Forum officiel', url: 'https://forum.iwc.com/' },
    { id: 'pop-watchbase-reference', name: 'WatchBase · IW3251-01', type: 'Base de données', url: 'https://watchbase.com/iwc/pilot/iw3251-01' },
    { id: 'pop-watchbase-caliber', name: 'WatchBase · calibre 37526', type: 'Base de données', url: 'https://watchbase.com/iwc/caliber/37526' },
    { id: 'pop-yarko-review', name: 'Yarko On The Go · IW3251 review', type: 'Revue', url: 'https://www.yarkoonthego.com/blog/iwc-pilots-watch-utc-iw3251-review' },
    { id: 'pop-chrono24', name: 'Chrono24 · référence IW3251', type: 'Base de données', url: 'https://www.chrono24.com/iwc/ref-iw3251.htm' },
  ]],
]);

let stateUpdates = 0;
for (const [key, value] of stateValues) {
  const reference = draftRef.collection('state').doc(key);
  const existing = await reference.get();
  const serialized = JSON.stringify(value);
  if (existing.exists && existing.data()?.deleted !== true && existing.data()?.value === serialized) continue;
  await reference.set({
    key,
    value: serialized,
    deleted: false,
    revision: Number(existing.data()?.revision || 0) + 1,
    clientUpdatedAt: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  stateUpdates += 1;
}

const requestId = `iwc_dossier_${UPDATE_DATE.replaceAll('-', '')}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
await firestore.doc(`cartularySyncRequests/${IWC_CARTULARY_ID}`).set({
  requestDocumentId: IWC_CARTULARY_ID,
  requestId,
  ownerUid: OWNER_UID,
  cartularyId: IWC_CARTULARY_ID,
  reason: 'iwc_source_dossier_consolidation_2026_08_29',
  status: 'pending',
  requestedAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
const sync = await processCartularySyncRequest({ firestore, requestDocumentId: IWC_CARTULARY_ID });

console.log(JSON.stringify({
  event: 'IWC_DOSSIER_UPDATED',
  projectId,
  storageBucket,
  cartularyId: IWC_CARTULARY_ID,
  sourceDirectory,
  fileCount: records.length,
  counts,
  uploaded,
  reused,
  unsupportedOriginalsIndexed: records.filter((record) => !record.uploadSupported).length,
  stateUpdates,
  sync,
}, null, 2));
