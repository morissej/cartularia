export interface PrivacyTocEntry {
  id: string;
  label: string;
  children?: readonly PrivacyTocEntry[];
}

export interface PrivacyCurrentStateItem {
  title: string;
  text: string;
  status: 'confirmed' | 'partial' | 'unresolved' | 'updated';
}

export const PRIVACY_POLICY_METADATA = {
  version: '1.0',
  sourceDate: '21 août 2026',
  reviewDate: '17 septembre 2026',
  status: 'projet de politique soumis à revue juridique avant adoption',
  sourceName: 'Politique_RGPD_Cartularia_v1.0.docx',
} as const;

export const PRIVACY_POLICY_TOC: readonly PrivacyTocEntry[] = [
  { id: 'objet', label: 'Objet de la note' },
  { id: 'essentiel', label: 'L’essentiel en bref' },
  {
    id: 'partie-1',
    label: 'Partie I — Cadre juridique applicable',
    children: [
      { id: 'textes', label: '1. Les textes' },
      { id: 'qualifications', label: '2. Qualifications' },
    ],
  },
  {
    id: 'partie-2',
    label: 'Partie II — La politique',
    children: [
      { id: 'article-1', label: 'Article 1 — Gouvernance' },
      { id: 'article-2', label: 'Article 2 — Principes' },
      { id: 'article-3', label: 'Article 3 — Registre des traitements' },
      { id: 'article-4', label: 'Article 4 — Durées de conservation' },
      { id: 'article-5', label: 'Article 5 — Droits des personnes' },
      { id: 'article-6', label: 'Article 6 — Sous-traitants et transferts' },
      { id: 'article-7', label: 'Article 7 — Sécurité' },
      { id: 'article-8', label: 'Article 8 — Cookies et traceurs' },
      { id: 'article-9', label: 'Article 9 — Violations de données' },
      { id: 'article-10', label: 'Article 10 — Protection dès la conception' },
      { id: 'article-11', label: 'Article 11 — Information des personnes' },
    ],
  },
  {
    id: 'partie-3',
    label: 'Partie III — Audit de conformité du code actuel',
    children: [
      { id: 'audit-conforme', label: '1. Prototype Antigravity — ce qui est conforme' },
      { id: 'audit-ecarts', label: '2. Prototype Antigravity — écarts à corriger' },
      { id: 'audit-prototype-test', label: '3. Prototype_Cartulaire_Test' },
      { id: 'audit-synthese', label: '4. Synthèse' },
    ],
  },
  { id: 'partie-4', label: 'Partie IV — Plan d’action avant mise en service' },
  { id: 'annexe-a', label: 'Annexe A — Notice courte à la création du compte' },
  { id: 'annexe-b', label: 'Annexe B — Références' },
] as const;

export const CURRENT_IMPLEMENTATION_STATE: readonly PrivacyCurrentStateItem[] = [
  {
    title: 'Statut juridique de la source',
    text: 'La version 1.0 est la seule politique RGPD trouvée dans le dossier juridique du projet. Elle reste un document de travail interne soumis à revue juridique ; aucune version adoptée ou validée plus récente n’a été identifiée.',
    status: 'unresolved',
  },
  {
    title: 'Responsable, référent et canal vie privée',
    text: 'La forme sociale, le siège, le RCS, le nom du référent, son adresse postale et une adresse dédiée à la vie privée ne sont pas renseignés. Le site propose contact@cartularia.com et un formulaire qui prépare un e-mail dans la messagerie de l’utilisateur ; il n’envoie rien automatiquement.',
    status: 'unresolved',
  },
  {
    title: 'Trois espaces techniques',
    text: 'L’implémentation distingue désormais le Registre, le Coffre personnel et une base de correspondance dans trois projets séparés. La console d’administration peut rattacher côté serveur la présence des comptes par nom utilisateur ; elle ne lit ni ne déchiffre le contenu du Coffre. La phrase de la source selon laquelle aucune jointure côté serveur n’existe doit donc être lue dans ce contexte plus récent.',
    status: 'updated',
  },
  {
    title: 'Région d’hébergement',
    text: 'La configuration locale de production conserve Firestore, Storage et les fonctions en us-central1. Firebase Authentication traite également des données de connexion aux États-Unis. L’objectif EEE décrit par la politique n’est pas l’état configuré du projet.',
    status: 'unresolved',
  },
  {
    title: 'App Check et traceurs',
    text: 'Lorsque sa clé est fournie, reCAPTCHA Enterprise pour App Check est initialisé au chargement de l’application, sans écran de consentement préalable ni chemin alternatif constaté. L’exigence de l’article 8 n’est pas réalisée.',
    status: 'unresolved',
  },
  {
    title: 'Polices et ressources tierces',
    text: 'Archivo, Newsreader et JetBrains Mono ont été auto-hébergées dans la version locale du projet. Cette correction répond à l’écart Google Fonts de l’audit du 21 août 2026 ; son déploiement en production n’est pas établi par cette page.',
    status: 'updated',
  },
  {
    title: 'En-têtes de sécurité',
    text: 'La politique exige une CSP bloquante. La configuration actuelle utilise encore Content-Security-Policy-Report-Only : elle observe les violations mais ne les bloque pas.',
    status: 'partial',
  },
  {
    title: 'Information et acceptation',
    text: 'Les pages Confidentialité et Conditions existent et sont liées depuis le pied de page, le contact et la création de compte. Les mentions légales complètes, la politique de traceurs et la journalisation de la version acceptée ne sont pas présentes ; aucune déclaration de majorité n’est demandée.',
    status: 'partial',
  },
  {
    title: 'Conservation',
    text: 'La durée générale de deux ans après inactivité est une décision produit, encore soumise à revue juridique. Le passage à l’état inactif reste manuel et les durées des journaux opérationnels et des sauvegardes ne sont pas fixées dans la matrice.',
    status: 'partial',
  },
  {
    title: 'Portabilité, droits et suppression',
    text: 'Aucun export complet du compte en JSON avec les médias originaux, formulaire dédié aux droits ou suivi de demande n’a été constaté. La suppression disponible efface le coffre local du navigateur et, si la session le permet, la copie privée cloud du Cartulaire concerné ; elle ne supprime pas les Cartulaires autoritaires, publications, Sceaux ou chaînes serveur.',
    status: 'partial',
  },
  {
    title: 'Secours du Coffre',
    text: 'Le produit propose désormais des kits de secours JSON distincts pour le Registre et le Coffre. La « phrase de récupération imprimable » annoncée à l’article 7.2 n’est pas le mécanisme actuellement mis en œuvre.',
    status: 'updated',
  },
  {
    title: 'Métadonnées des médias',
    text: 'Des tests locaux vérifient désormais que les dérivés de présentation ne conservent pas de bloc EXIF ou GPS. Le constat « Partiel » du premier audit a donc été corrigé dans le code local, sans constituer une recette de production.',
    status: 'updated',
  },
  {
    title: 'Registres et analyse d’impact',
    text: 'Aucun registre des traitements, registre des violations ou dossier AIPD formalisé et adopté n’a été identifié dans l’application. Les éléments de la présente note restent des matériaux préparatoires.',
    status: 'unresolved',
  },
] as const;

export const PROCESSING_REGISTER_HEADERS = ['Traitement', 'Finalité', 'Base légale', 'Données', 'Destinataires', 'Durée'] as const;

export const PROCESSING_REGISTER_ROWS = [
  ['T1 Compte et authentification', 'Créer le compte, authentifier, sécuriser la session, appliquer le step-up', 'Contrat (art. 6-1-b)', 'E-mail, mot de passe haché, identifiant, horodatages de connexion, état du compte', 'Google Firebase Authentication (sous-traitant, États-Unis)', 'Durée du compte + 2 ans après passage en inactivité'],
  ['T2 Cartulaire (dossier d’un exemplaire)', 'Constituer, conserver et prouver le dossier d’un bien', 'Contrat', 'Pseudonyme, code objet, historique de détention, prix, évaluations, factures, certificats, médias, journal d’événements', 'Équipe Cartularia habilitée ; Google Cloud (hébergement)', 'Durée du compte + 2 ans ; rétention prolongée en cas de gel juridique'],
  ['T3 Coffre personnel', 'Conserver l’identité du propriétaire, les lieux de stockage, les plans de transmission et les gestionnaires', 'Contrat', 'Nom, prénom, adresse, e-mail, téléphone, documents d’identité, adresses de stockage, destinataires', 'Aucun : chiffré côté client, clé dérivée du mot de passe, illisible par Cartularia', 'Jusqu’à suppression par l’utilisateur ; purge 2 ans après inactivité'],
  ['T4 Publication (Folio, Sceau, QR)', 'Exposer publiquement une sélection choisie par le propriétaire', 'Contrat et décision de l’utilisateur', 'Blocs W projetés (référence, état, médias dérivés sans EXIF), code public', 'Public ; Google Cloud CDN', 'Jusqu’à révocation, puis expiration des caches'],
  ['T5 Partage et invitations', 'Donner accès à un tiers désigné (acheteur, assureur, notaire)', 'Contrat et décision de l’utilisateur ; intérêt légitime pour la traçabilité', 'E-mail du destinataire (haché et masqué), jeton haché, consultations, téléchargements', 'Destinataire ; fournisseur d’e-mail transactionnel', 'Durée de l’accès + 1 an de journal'],
  ['T6 Transfert de propriété', 'Organiser la cession contradictoire et transmettre le dossier à l’acquéreur', 'Contrat ; intérêt légitime (preuve de la chaîne de détention)', 'Identifiants cédant et acquéreur, décisions confirmées, archives privées du cédant', 'Acquéreur (dossier expurgé des données personnelles du cédant)', 'Preuve de cession : 5 ans (prescription civile) ; données personnelles du cédant expurgées à la clôture'],
  ['T7 Le Cercle (communauté)', 'Permettre les échanges entre membres admis', 'Contrat', 'Pseudonyme communautaire, publications, modération', 'Membres admis ; modérateurs', 'Durée de l’adhésion + 2 ans'],
  ['T8 Horodatage et ancrage', 'Prouver l’antériorité et l’intégrité du journal', 'Contrat ; intérêt légitime', 'Empreinte SHA-256 de lot, racine de Merkle (aucune donnée personnelle)', 'DigiCert (TSA RFC 3161) ; réseau Bitcoin via OpenTimestamps (public, irréversible)', 'Permanente (empreintes seulement)'],
  ['T9 Sécurité et journaux', 'Détecter les abus, tracer les actions, répondre aux incidents', 'Intérêt légitime ; obligation légale (art. 32)', 'Identifiant, horodatage, action, adresse IP et agent utilisateur (journaux plateforme), jetons App Check', 'Google Cloud Logging ; équipe habilitée', '6 mois (journaux de connexion, art. 6-II LCEN par analogie) ; 1 an (journaux d’audit applicatifs) sauf gel'],
  ['T10 Facturation et abonnement', 'Facturer, gérer le cycle de vie de l’abonnement, tenir la comptabilité', 'Contrat ; obligation légale (art. L123-22 C. com.)', 'Identité, adresse de facturation, moyens de paiement tokenisés, factures', 'Prestataire de paiement (à désigner) ; expert-comptable', '10 ans (pièces comptables) ; données de carte jamais conservées'],
  ['T11 Support et exercice des droits', 'Répondre aux demandes, prouver la réponse', 'Obligation légale (art. 12 à 22) ; intérêt légitime', 'Identité, correspondance, justificatifs proportionnés', 'Équipe support', '5 ans après clôture de la demande (prescription)'],
  ['T12 Lettre d’information et prospection', 'Informer des nouveautés', 'Consentement (art. 6-1-a ; L34-5 CPCE)', 'E-mail, préférences', 'Outil d’e-mailing (à désigner, EEE)', '3 ans après le dernier contact actif ; retrait à tout moment'],
  ['T13 Mesure d’audience (à venir)', 'Mesurer la fréquentation du site public', 'Exemption art. 82 LIL si outil configuré selon la CNIL ; sinon consentement', 'Données agrégées, sans identifiant croisé', 'Outil exempté (Matomo auto-hébergé ou équivalent)', '25 mois maximum'],
  ['T14 Assistance IA (à venir)', 'Pré-remplir des champs, analyser l’état', 'Contrat ou intérêt légitime selon le service ; AIPD préalable', 'Médias et champs sélectionnés, sorties, annotations humaines', 'Fournisseur de modèle sous DPA, sans entraînement sur les données', 'Durée du Cartulaire ; entrées non conservées par le fournisseur'],
] as const;

export const PROCESSOR_HEADERS = ['Prestataire', 'Service', 'Données', 'Localisation', 'Mécanisme', 'Statut'] as const;

export const PROCESSOR_ROWS = [
  ['Google LLC / Google Ireland', 'Firebase Authentication', 'E-mail, mot de passe haché, IP de connexion, jetons', 'États-Unis (pas d’option UE)', 'DPF (Google certifié) + CCT du Cloud Data Processing Addendum', 'Transfert à documenter ; alternative à étudier'],
  ['Google', 'Firestore, Cloud Storage, Cloud Functions, Hosting', 'Cartulaires, projections, médias, journaux', 'us-central1 (confirmé le 16/08/2026)', 'Idem', 'Non conforme à la politique : migrer en europe-west'],
  ['Google', 'App Check — reCAPTCHA Enterprise', 'Empreinte navigateur, IP, cookies Google', 'États-Unis', 'Idem', 'Traceur soumis à consentement (SAN-2023-003)'],
  ['Google', 'Google Fonts (fonts.googleapis.com)', 'Adresse IP', 'États-Unis', 'Aucun', 'À auto-héberger'],
  ['DigiCert', 'Autorité d’horodatage RFC 3161', 'Empreinte SHA-256 uniquement', 'États-Unis', 'Sans objet (aucune donnée personnelle)', 'Conforme'],
  ['OpenTimestamps / Bitcoin', 'Ancrage public', 'Racine de Merkle', 'Réseau public mondial', 'Sans objet', 'Conforme, irréversible'],
  ['Fournisseur d’e-mail transactionnel', 'Envoi des invitations (collection mail)', 'E-mail du destinataire, lien signé', 'À désigner', 'À contractualiser', 'À identifier'],
  ['Prestataire de paiement', 'Abonnements', 'Identité, facturation', 'À désigner (EEE)', 'À contractualiser', 'À venir'],
  ['Fournisseur IA', 'Assistance à la saisie', 'Médias et champs sélectionnés', 'À désigner (EEE)', 'DPA + interdiction d’entraînement', 'À venir, après AIPD'],
] as const;

export const COMPLIANCE_HEADERS = ['Domaine', 'Constat', 'Statut et remarque'] as const;

export const COMPLIANCE_ROWS = [
  ['Secret par défaut (art. 2.1)', 'firestore.rules et storage.rules refusent tout par défaut ; les collections patrimoniales n’acceptent aucune écriture client ; le dérivé public n’est lisible que si la publication est active.', 'Conforme / Modèle deny-by-default vérifié par tests de règles (firestore.rules.test, storage.rules.test).'],
  ['Séparation identité / objet (art. 2.2)', 'personalDataBoundary.ts interdit la synchronisation de six clés d’état (identité, documents, destinataires, stockage) vers le Registre ; le Cartulaire ne porte qu’un pseudonyme et un code objet.', 'Conforme / Couvert par personal-data-boundary.test. Ajouter toute nouvelle clé personnelle à la liste.'],
  ['Coffre personnel chiffré (art. 7.1)', 'personalVault/crypto.ts : AES-GCM 256, PBKDF2-SHA-256 600 000 itérations, sel et IV aléatoires, contexte lié au pseudonyme ; projet Firebase séparé.', 'Conforme / Niveau supérieur aux recommandations OWASP 2023. Documenter la perte de mot de passe (art. 7.2).'],
  ['Invitations (art. 10)', 'invitation-command.mjs : e-mail normalisé puis haché SHA-256, libellé masqué, jeton haché, lien de connexion Firebase.', 'Conforme / Bon niveau de minimisation. Le fournisseur d’envoi derrière la collection mail reste à identifier.'],
  ['Communauté pseudonyme (T7)', 'communityProfiles séparés du compte ; profil privé inaccessible ; lecture réservée aux membres admis.', 'Conforme / —'],
  ['Session (art. 7.1)', 'sessionSecurity.ts : verrouillage après 30 min d’inactivité ou 15 min d’onglet masqué ; ré-authentification (step-up) par mot de passe.', 'Conforme / —'],
  ['Horodatage et ancrage (art. 1-2.5, T8)', 'Seules la racine de Merkle et l’empreinte de lot quittent l’infrastructure ; passerelle serveur, URL de la TSA jamais exposée au navigateur.', 'Conforme / Conforme à la position CNIL 2018 sur les blockchains.'],
  ['Métadonnées des médias (art. 10)', 'exifr ne lit que DateTimeOriginal et CreateDate ; les dérivés sont produits par sharp, qui supprime les métadonnées par défaut.', 'Partiel / Comportement correct mais non prouvé : aucun test ne vérifie l’absence d’EXIF/GPS sur les dérivés. Ajouter un test DPR-009.'],
  ['Suppression par l’utilisateur (art. 5.3)', 'Panneau Intégrité : effacement du coffre local et de la copie privée cloud, confirmation textuelle, écran « Vos données privées ont été supprimées », tombstone anti-recréation.', 'Partiel / Couvre privateDrafts uniquement. Cartulaires autoritaires, publications, transferts et journaux restent ; la cascade de l’art. 10 n’existe pas.'],
  ['Conservation (art. 4)', 'retention-command.mjs : inactif + 2 années civiles, dry-run par défaut, purge Firestore et Storage ; retention-matrix.json ; runbook PRIVACY_RETENTION.', 'Partiel / Le passage à l’état inactif est manuel ; aucune détection d’inactivité ni rappel. Les catégories logs et backups ont une durée nulle.'],
  ['En-têtes de sécurité (art. 7.1)', 'firebase.json : CSP, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options DENY.', 'Partiel / La CSP est en mode Report-Only : elle n’empêche rien. Passer en mode bloquant avant production.'],
  ['Traceurs marketing (art. 8)', 'Aucun script d’analytics, de publicité ou de réseau social dans le code.', 'Conforme / À préserver ; tout ajout passe par l’art. 8.2.'],
  ['Gate de production (art. 1.2)', 'production-policy.json bloque le déploiement tant que chiffrement applicatif et matrice de conservation sont « pending_legal_review ».', 'Conforme / Mécanisme sain. Mais voir l’écart n° 1 : la région a été « confirmée » en us-central1.'],
] as const;

export const GAP_HEADERS = ['N°', 'Écart', 'Référence', 'Correction recommandée', 'Priorité'] as const;

export const GAP_ROWS = [
  ['1', 'Hébergement en région us-central1 pour Firestore, Storage et Cloud Functions, confirmé dans production-policy.json le 16 août 2026 et codé en dur dans firebase.ts et firebase-functions.mjs. Contredit la décision D-09 (EEE ou Suisse) et l’exigence DPR-007.', 'Art. 6.2 ; RGPD chap. V', 'Créer le projet de production en région européenne (europe-west9 Paris ou eur3 multi-région) avant toute donnée réelle ; la région Firestore n’est pas modifiable après création. Remplacer la constante us-central1 par une variable d’environnement. Mettre à jour production-policy.json.', 'P0'],
  ['2', 'Firebase Authentication stocke les comptes (e-mail, hachés, IP de connexion) aux États-Unis sans option de région européenne.', 'Art. 6.2-6.3', 'Documenter le transfert (DPF + CCT + TIA) dans l’inventaire et la notice ; étudier Identity Platform avec pass-through ou un IdP européen ; suivre la régionalisation annoncée par Google. À défaut, accepter le risque explicitement dans l’AIPD.', 'P0'],
  ['3', 'reCAPTCHA Enterprise (App Check) initialisé au chargement de l’application, sans information ni consentement. La CNIL a jugé ce traceur non exempté (SAN-2023-003, 16 mars 2023, Cityscoot, 125 000 €).', 'Art. 8.2-8.3 ; art. 82 LIL', 'Ne charger App Check web qu’après consentement, sur les pages d’authentification ; ou remplacer par limitation de débit serveur + attestation d’appareil mobile ; ou solution auto-hébergée. Ajouter la bannière de choix.', 'P0'],
  ['4', 'Google Fonts chargées depuis fonts.googleapis.com et fonts.gstatic.com (index.html, personal-vault.html) : transmission de l’adresse IP à Google à chaque visite (LG München, 20 janv. 2022).', 'Art. 8.4', 'Auto-héberger Archivo, Newsreader et JetBrains Mono (licences SIL OFL) dans public/fonts et retirer les preconnect et la CSP correspondante.', 'P1'],
  ['5', 'Aucune notice de confidentialité, mentions légales (LCEN art. 6-III), CGU, politique de traceurs ni lien vers ces textes dans l’interface ; aucun formulaire ne renvoie à une information (DPR-002, LEG-003, LEG-004 non réalisés).', 'Art. 2.4, 11 ; RGPD art. 13', 'Créer les pages /confidentialite, /mentions-legales, /cgu, /cookies ; pied de page sur toutes les surfaces ; version courte à l’inscription ; journalisation de la version acceptée (collection consents).', 'P0'],
  ['6', 'Aucun parcours d’exercice des droits : pas de canal privacy, pas de formulaire, pas de suivi de demande.', 'Art. 5.2 ; RGPD art. 12', 'Adresse dédiée, formulaire dans l’espace Compte, fiche de suivi avec délai d’un mois, modèle de réponse.', 'P1'],
  ['7', 'Pas d’export structuré du compte (portabilité). Seul un export PDF du Cartulaire et un export de journal d’intégrité existent.', 'Art. 5.3 ; RGPD art. 20', 'Fonction d’export JSON + médias originaux, couvrant Cartulaires, Coffre (déchiffré localement) et journal.', 'P1'],
  ['8', 'Suppression incomplète : la purge et la suppression utilisateur ne traitent que privateDrafts ; pas de cascade documentée pour cartularies, publications, cartularyTransfers, communityProfiles, timestampRequests.', 'Art. 5.4, 10 ; RGPD art. 17', 'Spécifier la cascade par collection (suppression, anonymisation ou conservation motivée), l’implémenter en fonction serveur, la tester (DPR-005).', 'P1'],
  ['9', 'Inactivité : statut inactive uniquement manuel ; aucun rappel ; durées des catégories operational_logs et backups non définies (null).', 'Art. 4.1-4.2', 'Détection automatique à 24 mois sans connexion + 2 rappels ; Cloud Logging à 6 mois ; sauvegardes à 30 jours ; mettre à jour retention-matrix.json.', 'P1'],
  ['10', 'CSP en mode Report-Only.', 'Art. 7.1', 'Passer en Content-Security-Policy bloquante après une période d’observation.', 'P1'],
  ['11', 'Coffre local (IndexedDB, localVault.ts) et journal d’intégrité (localStorage) conservés en clair sur le poste de l’utilisateur, hors Coffre personnel.', 'Art. 7.1', 'Acceptable pour un brouillon si la notice l’explique ; envisager le chiffrement avec la clé de session ; effacement à la déconnexion sur poste partagé.', 'P2'],
  ['12', 'Fournisseur d’e-mail derrière la collection mail non identifié dans le dépôt (extension Trigger Email ou autre).', 'Art. 6.1', 'Identifier, contractualiser (DPA), inscrire à l’inventaire ; préférer un fournisseur EEE.', 'P1'],
  ['13', 'Aucune vérification d’âge ni mention de majorité.', 'Art. 10', 'Case de déclaration de majorité à l’inscription ; clause CGU.', 'P2'],
  ['14', 'Données du cédant lors d’un transfert : transferPrivateArchives conservées sans durée ni règle d’expurgation explicite (D-12).', 'Art. 3 T6', 'Définir la durée (5 ans) et l’expurgation des données personnelles du cédant du dossier transmis ; tester.', 'P1'],
  ['15', 'Journaux plateforme (Cloud Logging, App Check, Functions) : adresses IP et agents utilisateurs collectés par défaut sans politique.', 'Art. 3 T9', 'Fixer la rétention Cloud Logging à 6 mois ; exclure les charges utiles ; documenter dans le registre.', 'P1'],
  ['16', 'Absence de registre des traitements, d’AIPD et de registre des violations formalisés ; les ADR et runbooks en contiennent les matériaux.', 'Art. 1, 9 ; RGPD art. 30, 33, 35', 'Adopter la présente politique ; ouvrir les trois registres ; mener l’AIPD (modèle PIA de la CNIL) avant le pilote.', 'P0'],
] as const;

export const ACTION_HEADERS = ['Étape', 'Action', 'Responsable', 'Échéance'] as const;

export const ACTION_ROWS = [
  ['1', 'Adopter la politique (présente note, articles 1 à 11) après relecture juridique ; nommer le référent vie privée ; ouvrir les registres (traitements, violations, sous-traitants).', 'Direction + conseil', 'Avant tout chargement de données réelles'],
  ['2', 'Décider la région : recréer le projet Firebase de production en europe-west ; paramétrer la région par variable d’environnement ; corriger production-policy.json.', 'Tech', 'Immédiat (irréversible)'],
  ['3', 'Traiter Authentication : inventaire du transfert, TIA, clauses Google actives ; étude Identity Platform / IdP européen.', 'Tech + conseil', 'Avant pilote'],
  ['4', 'Retirer reCAPTCHA du chargement initial ; mettre en place la bannière de choix et la collection consents ; auto-héberger les polices ; CSP bloquante.', 'Tech', 'Avant pilote'],
  ['5', 'Rédiger et publier notice de confidentialité, mentions légales, CGU, politique de traceurs ; lier chaque formulaire ; journaliser l’acceptation.', 'Juridique + produit', 'Avant pilote'],
  ['6', 'Mener l’AIPD avec l’outil PIA de la CNIL ; consigner le risque résiduel ; décider la consultation préalable.', 'Référent + tech', 'Avant pilote'],
  ['7', 'Implémenter export structuré, cascade de suppression, détection d’inactivité, durées logs et sauvegardes ; écrire les tests DPR-004, DPR-005, DPR-009.', 'Tech', 'Avant ouverture publique'],
  ['8', 'Identifier et contractualiser l’e-mail transactionnel et le paiement (DPA, EEE) ; compléter l’inventaire.', 'Ops', 'Avant ouverture publique'],
  ['9', 'Exercice de violation (fuite de mandat) ; test de purge ; revue des habilitations.', 'Référent + tech', 'Avant ouverture publique, puis annuel / trimestriel'],
  ['10', 'Décommissionner ou isoler Prototype_Cartulaire_Test.', 'Tech', 'Immédiat'],
] as const;

export const REFERENCE_HEADERS = ['Source', 'Apport'] as const;

export const REFERENCE_ROWS = [
  ['Règlement (UE) 2016/679 (RGPD)', 'Principes, information, droits, registre, AIPD, sous-traitants, transferts, violations.'],
  ['Loi n° 78-17 du 6 janvier 1978 modifiée ; décret n° 2019-536', 'Art. 45 (âge), 48 (CNIL), 82 (traceurs), 84-86 (décès et directives post-mortem).'],
  ['LCEN, loi n° 2004-575, art. 6-III', 'Mentions légales obligatoires des services en ligne.'],
  ['CNIL, lignes directrices et recommandation « cookies et autres traceurs », 17 septembre 2020 ; FAQ et page « mesure d’audience »', 'Traceurs exemptés, refus aussi simple que l’acceptation, durée de conservation du choix de six mois.'],
  ['CNIL, délibération SAN-2023-003 du 16 mars 2023 (Cityscoot)', 'Google reCAPTCHA qualifié de traceur non exempté de consentement ; contrats de sous-traitance incomplets.'],
  ['CNIL, « Blockchain : premiers éléments d’analyse », septembre 2018', 'Inscription d’empreintes, pas de données personnelles en chaîne, conséquences de l’irréversibilité.'],
  ['CNIL, outil PIA et guides AIPD ; G29, lignes directrices WP248 rév. 01', 'Critères déclenchant l’AIPD (données hautement personnelles, technologies innovantes, croisement).'],
  ['Décision d’exécution (UE) 2023/1795 du 10 juillet 2023 (Data Privacy Framework) ; Trib. UE, 3 sept. 2025, Latombe c/ Commission, T-553/23 ; pourvoi pendant', 'Validité actuelle des transferts vers les entités américaines certifiées ; fragilité à moyen terme.'],
  ['Décision d’exécution (UE) 2021/914 (clauses contractuelles types)', 'Mécanisme de transfert subsidiaire retenu par la politique.'],
  ['LG München I, 20 janvier 2022, 3 O 17493/20', 'Chargement de Google Fonts depuis les serveurs de Google sans consentement : transmission illicite de l’adresse IP.'],
  ['Firebase — documentation des emplacements et demande de régionalisation d’Authentication', 'Firestore/Storage/Functions régionalisables en Europe ; Authentication hébergé aux États-Unis sans option européenne à ce jour.'],
  ['Notes de conception Cartularia v1.5 (Cartulaire) et v0.4 (Site et Registre) ; runbook PRIVACY_RETENTION ; ADR-007, ADR-022, ADR-025', 'Exigences DPR, LEG, SEC, SUC ; décisions D-08, D-09, D-12, D-18 à D-21 ; matrice de conservation et gate de production.'],
] as const;
