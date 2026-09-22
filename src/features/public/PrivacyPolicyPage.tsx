import { useEffect } from 'react';
import { PublicFooter, PublicHeader } from './PublicChrome.tsx';
import {
  ACTION_HEADERS,
  ACTION_ROWS,
  COMPLIANCE_HEADERS,
  COMPLIANCE_ROWS,
  CURRENT_IMPLEMENTATION_STATE,
  GAP_HEADERS,
  GAP_ROWS,
  PRIVACY_POLICY_METADATA,
  PRIVACY_POLICY_TOC,
  PROCESSING_REGISTER_HEADERS,
  PROCESSING_REGISTER_ROWS,
  PROCESSOR_HEADERS,
  PROCESSOR_ROWS,
  REFERENCE_HEADERS,
  REFERENCE_ROWS,
  type PrivacyTocEntry,
} from './privacyPolicyData.ts';
import './public-site.css';

interface PolicyTableProps {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

const ESSENTIAL_POINTS = [
  'Cartularia est responsable de traitement pour la plateforme. La CNIL est l’autorité compétente. Le registre des traitements de l’article 30 est obligatoire : l’exemption des entreprises de moins de 250 salariés ne joue pas, car les traitements ne sont pas occasionnels et présentent un risque pour les droits des personnes.',
  'Une analyse d’impact (AIPD) est requise avant le lancement : le traitement réunit au moins deux des critères du CEPD — données hautement personnelles (patrimoine, domicile, succession) et usage innovant (ancrage blockchain, horodatage qualifié, assistance IA à venir).',
  'Le prototype Antigravity est architecturalement en avance sur la plupart des produits de sa taille : règles deny-by-default, écritures serveur, Coffre personnel chiffré côté client (AES-GCM, PBKDF2 600 000 itérations), Registre pseudonyme, invitations par empreinte d’e-mail, verrouillage de session, purge différée. Aucune balise publicitaire ni mesure d’audience n’est présente.',
  'Quatre écarts bloquants subsistent : l’hébergement confirmé en région us-central1 (Firestore, Storage, Functions) et Firebase Authentication hébergé aux États-Unis sans option européenne ; reCAPTCHA Enterprise chargé sans consentement, pratique sanctionnée par la CNIL (SAN-2023-003, Cityscoot) ; Google Fonts appelées depuis les serveurs de Google ; et l’absence totale de notice d’information, de mentions légales, de CGU et de parcours d’exercice des droits dans l’interface.',
  'La décision d’hébergement américain est juridiquement tenable aujourd’hui grâce au Data Privacy Framework, confirmé par le Tribunal de l’Union le 3 septembre 2025 mais frappé d’un pourvoi devant la Cour de justice. Pour un service qui promet la confidentialité patrimoniale, la recommandation est de basculer en région européenne avant toute donnée réelle, et de traiter Authentication comme un transfert documenté en attendant sa régionalisation.',
  'Le prototype Cartulaire_Test (Cloudflare + authentification par en-têtes ChatGPT) ne doit recevoir aucune donnée réelle et doit être décommissionné ou isolé comme bac à sable.',
] as const;

const PRODUCT_RULES = [
  'Aucune clé d’état listée comme personnelle (identité, documents, destinataires, lieux de stockage) n’est synchronisée vers le projet Registre ; le test personal-data-boundary en fait foi et toute nouvelle clé personnelle y est ajoutée.',
  'Tout dérivé public ou communautaire est régénéré par le serveur, sans métadonnées EXIF, XMP ni GPS ; un test de non-régression vérifie l’absence de métadonnées sur chaque format de sortie.',
  'La lecture des métadonnées d’un original se limite aux champs de date nécessaires à l’horodatage ; la localisation n’est jamais lue.',
  'Un avertissement bloquant précède la publication d’un média où un visage, un document nominatif ou un intérieur identifiable est détecté ou déclaré.',
  'Les adresses électroniques des tiers invités sont hachées et masquées ; les jetons sont hachés ; les liens expirent.',
  'Les journaux d’audit n’enregistrent ni contenu de champ ni donnée d’identité, seulement l’action, l’acteur pseudonyme, la ressource et l’empreinte.',
  'Chaque formulaire porte un lien vers la section de la notice qui le concerne, avec le numéro de version de la notice.',
  'La suppression d’un compte déclenche une cascade documentée : Coffre, copie privée, brouillons, médias, index, caches, puis, après confirmation distincte, révocation des publications ; les exceptions (comptabilité, gel, empreintes) sont listées à l’écran.',
  'Le service est réservé aux personnes majeures ; l’âge est déclaré à l’inscription et les CGU le rappellent (article 45 LIL : quinze ans pour le consentement numérique, mais la nature patrimoniale du service justifie la majorité).',
] as const;

const CURRENT_STATE_LABELS = {
  confirmed: 'Confirmé dans le code local',
  partial: 'Partiellement réalisé',
  unresolved: 'Non résolu',
  updated: 'État plus récent que la source',
} as const;

function PolicyTable({ caption, headers, rows }: PolicyTableProps) {
  return (
    <div
      className="privacy-policy-table-region"
      role="region"
      aria-label={`${caption} — tableau défilable horizontalement`}
      tabIndex={0}
    >
      <table className="privacy-policy-table">
        <caption>{caption}</caption>
        <thead>
          <tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${caption}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                cellIndex === 0
                  ? <th key={`${rowIndex}-${cellIndex}`} scope="row">{cell}</th>
                  : <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TocEntries({ entries }: { entries: readonly PrivacyTocEntry[] }) {
  return (
    <ol className="privacy-policy-toc__list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a href={`#${entry.id}`}>{entry.label}</a>
          {entry.children && <TocEntries entries={entry.children} />}
        </li>
      ))}
    </ol>
  );
}

function BackToContents() {
  return <a className="privacy-policy-back-link" href="#sommaire">Retour au sommaire</a>;
}

export function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Politique de protection des données personnelles — Cartularia';
  }, []);

  return (
    <div className="public-site privacy-policy-site">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      <PublicHeader />

      <main id="main-content" className="privacy-policy-main" tabIndex={-1}>
        <header className="privacy-policy-hero">
          <a className="privacy-policy-home-link" href="/">← Retour à l’accueil</a>
          <p className="privacy-policy-eyebrow">NOTE — CADRE JURIDIQUE ET RÈGLEMENTAIRE</p>
          <h1>Politique de protection des données personnelles</h1>
          <p className="privacy-policy-subtitle">Politique RGPD du projet Cartularia, conforme au règlement (UE) 2016/679 et à la loi Informatique et Libertés, et audit de conformité du code des prototypes</p>
          <p className="privacy-policy-metadata">Projet Cartularia · Version {PRIVACY_POLICY_METADATA.version} · {PRIVACY_POLICY_METADATA.sourceDate}</p>
          <p className="privacy-policy-status">Statut : {PRIVACY_POLICY_METADATA.status}</p>
          <p className="privacy-policy-source">Source documentaire : <strong>{PRIVACY_POLICY_METADATA.sourceName}</strong> · document original de 18 pages.</p>
        </header>

        <aside className="privacy-policy-warning" aria-labelledby="avertissement-titre">
          <h2 id="avertissement-titre">Avertissement.</h2>
          <p>Cette note est un document de travail interne. Elle réunit l’état du droit tel qu’il ressort des textes, de la doctrine de la CNIL et de la jurisprudence consultés à la date du 21 août 2026, mais elle ne constitue pas une consultation juridique. Elle a vocation à être relue par un avocat ou un délégué à la protection des données avant adoption, puis publiée pour la partie « politique » et conservée en interne pour les parties « registre » et « audit ».</p>
        </aside>

        <aside className="privacy-policy-current-state" aria-labelledby="etat-actuel-titre">
          <div className="privacy-policy-current-state__heading">
            <p className="privacy-policy-eyebrow">Complément distinct de la source v1.0</p>
            <h2 id="etat-actuel-titre">État actuel et écarts vérifiés dans le code local</h2>
            <p>Revue du {PRIVACY_POLICY_METADATA.reviewDate}. Ces constats techniques actualisent les faits observables depuis l’audit daté du 21 août 2026. Ils ne modifient pas le texte source, ne valent ni validation juridique ni recette de production, et laissent visibles ses contradictions.</p>
          </div>
          <ul className="privacy-policy-current-state__list">
            {CURRENT_IMPLEMENTATION_STATE.map((item) => (
              <li key={item.title} className={`privacy-policy-current-state__item privacy-policy-current-state__item--${item.status}`}>
                <p className="privacy-policy-current-state__status">{CURRENT_STATE_LABELS[item.status]}</p>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </aside>

        <nav id="sommaire" className="privacy-policy-toc" aria-labelledby="sommaire-titre">
          <h2 id="sommaire-titre">Sommaire</h2>
          <TocEntries entries={PRIVACY_POLICY_TOC} />
        </nav>

        <article className="privacy-policy-document" aria-label="Texte intégral de la politique RGPD Cartularia, version 1.0">
          <section id="objet" className="privacy-policy-section">
            <h2>Objet de la note</h2>
            <p>Cartularia conserve, pour le compte de propriétaires de montres et d’objets patrimoniaux, un dossier numérique — le Cartulaire — qui associe l’identité d’un bien, son historique de détention, ses prix, ses évaluations, ses factures et ses photographies. Ces informations, prises ensemble, révèlent le patrimoine d’une personne, parfois son domicile, ses habitudes et ses héritiers. Elles sont, au sens du règlement général sur la protection des données, des données à caractère personnel d’une sensibilité élevée, alors même qu’aucune n’appartient aux catégories dites « sensibles » de l’article 9.</p>
            <p>Le projet a, dès sa conception, choisi le secret par défaut, la pseudonymisation du Registre et la séparation physique des données d’identité dans un Coffre personnel chiffré. Ces choix sont des atouts. Ils ne dispensent pas de la discipline documentaire et des obligations formelles que le RGPD impose à tout responsable de traitement établi en France : information des personnes, registre des traitements, durées de conservation, encadrement des sous-traitants, gestion des transferts hors Union, procédure de violation, et — compte tenu du cumul patrimoine, identité, localisation et technologies nouvelles — analyse d’impact préalable.</p>
            <p>La note poursuit trois objectifs. La première partie rappelle le cadre applicable et tranche les questions de qualification. La deuxième partie constitue la politique proprement dite : elle est rédigée pour être adoptée telle quelle, puis déclinée en notice publique, en registre interne et en exigences produit. La troisième partie confronte cette politique au code des deux prototypes présents dans le dossier Application et dresse la liste des écarts à corriger avant qu’une donnée réelle ne soit chargée.</p>
          </section>

          <section id="essentiel" className="privacy-policy-section privacy-policy-summary">
            <h2>L’essentiel en bref</h2>
            <ul>{ESSENTIAL_POINTS.map((point) => <li key={point}>{point}</li>)}</ul>
            <BackToContents />
          </section>

          <section id="partie-1" className="privacy-policy-part">
            <h2>Partie I — Cadre juridique applicable</h2>
            <section id="textes" className="privacy-policy-section">
              <h3>1. Les textes</h3>
              <p>Le socle est le règlement (UE) 2016/679 du 27 avril 2016 (RGPD), d’application directe, complété en France par la loi n° 78-17 du 6 janvier 1978 relative à l’informatique, aux fichiers et aux libertés, dans sa rédaction issue de l’ordonnance n° 2018-1125 du 12 décembre 2018, et par son décret d’application n° 2019-536 du 29 mai 2019. La loi française ajoute au règlement plusieurs dispositions propres qui concernent directement Cartularia : l’article 82 sur les traceurs, qui transpose la directive ePrivacy et fonde la doctrine « cookies » de la CNIL ; l’article 45 qui fixe à quinze ans l’âge du consentement numérique ; les articles 84 à 86 sur le sort des données après le décès et les directives post-mortem, particulièrement pertinents pour un service de transmission patrimoniale ; et l’article 48 sur la compétence de la CNIL.</p>
              <p>S’y ajoutent la loi n° 2004-575 pour la confiance dans l’économie numérique (LCEN), dont l’article 6-III impose les mentions légales de tout service en ligne, le code de la consommation pour les clauses des CGU à destination des particuliers, et, pour les traceurs, les lignes directrices de la CNIL du 17 septembre 2020 et sa recommandation du même jour, complétées par sa position sur les outils de mesure d’audience exemptés et par la délibération SAN-2023-003 du 16 mars 2023 qui a qualifié Google reCAPTCHA de traceur soumis à consentement. Les transferts hors Union reposent sur le chapitre V du RGPD, sur la décision d’adéquation du 10 juillet 2023 relative au cadre de protection des données UE–États-Unis (Data Privacy Framework) et sur les clauses contractuelles types de la décision 2021/914.</p>
              <p>Le projet prévoit une offre en Suisse. La loi fédérale sur la protection des données révisée (nLPD), en vigueur depuis le 1er septembre 2023, suit une logique voisine sans être identique ; la présente politique retient le niveau le plus exigeant des deux lorsque les périmètres coexistent, conformément au choix déjà inscrit dans la note de conception du Cartulaire (chapitre « Protection des données personnelles — RGPD et LPD suisse »).</p>
            </section>

            <section id="qualifications" className="privacy-policy-section">
              <h3>2. Qualifications</h3>
              <h4>2.1 Cartularia est responsable de traitement</h4>
              <p>Cartularia détermine seule les finalités et les moyens des traitements liés aux comptes, à la conservation des Cartulaires, à la publication des Folios, au Registre, au Cercle, à la facturation, à la sécurité et au support. Elle en est responsable de traitement au sens de l’article 4-7. Google (Firebase, Cloud), DigiCert (horodatage), le fournisseur d’e-mail transactionnel et, demain, le prestataire de paiement et le fournisseur de modèle d’IA sont ses sous-traitants, liés par un contrat conforme à l’article 28.</p>
              <p>Deux situations appellent une qualification distincte. Lorsqu’un client professionnel — marchand, family office, assureur, notaire sous mandat — charge des dossiers pour ses propres clients, Cartularia agit en sous-traitant de ce professionnel et un accord de traitement (DPA) doit l’encadrer. Lorsque l’utilisateur lui-même publie un Folio ou partage un Cartulaire avec un tiers, il reste maître de cette décision ; Cartularia demeure responsable des moyens techniques mais n’est pas l’auteur de la diffusion. La politique le dit explicitement pour que la responsabilité de chacun soit lisible.</p>
              <h4>2.2 Les données traitées sont des données personnelles ordinaires mais hautement personnelles</h4>
              <p>Le numéro de série d’une montre, son prix d’achat, la facture, la photographie du coffre où elle est rangée ne sont pas des données « sensibles » de l’article 9. Elles n’en relèvent pas moins de la notion de données hautement personnelles retenue par le groupe de l’article 29 dans ses lignes directrices sur l’AIPD (WP248 rév. 01) : données financières, données de localisation du domicile, données relevant de la vie privée dont la compromission expose à un risque physique (cambriolage ciblé) ou patrimonial. Le registre des traitements les classe « secret patrimonial », niveau qui commande un chiffrement et une journalisation renforcés.</p>
              <h4>2.3 L’AIPD est obligatoire</h4>
              <p>L’article 35 impose une analyse d’impact lorsque le traitement est susceptible d’engendrer un risque élevé. Les lignes directrices WP248 retiennent qu’un traitement remplissant deux des neuf critères doit en principe y être soumis. Cartularia en réunit au moins trois : données hautement personnelles ; usage innovant de technologies (ancrage public sur Bitcoin via OpenTimestamps, horodatage RFC 3161, assistance IA en préparation) ; et croisement de jeux de données (identité, patrimoine, localisation, réseau de destinataires). L’AIPD doit être menée avant la mise en service, actualisée à chaque évolution substantielle, et conservée ; elle n’a pas à être transmise à la CNIL sauf si le risque résiduel demeure élevé (article 36).</p>
              <h4>2.4 Le délégué à la protection des données</h4>
              <p>La désignation d’un DPO n’est obligatoire (article 37) que si l’activité de base consiste en un suivi régulier et systématique à grande échelle ou en un traitement à grande échelle de données sensibles. Au stade du lancement, Cartularia n’atteint pas ces seuils. La politique prévoit néanmoins un référent vie privée nommément désigné et joignable, et recommande la désignation volontaire d’un DPO externe mutualisé dès que le nombre de comptes actifs dépasse quelques milliers ou dès l’ouverture du canal assurance, qui implique un traitement conjoint avec des porteurs de risque soumis à leurs propres obligations.</p>
              <h4>2.5 Blockchain et irréversibilité</h4>
              <p>L’ancrage public d’une racine de Merkle sur une chaîne publique n’est pas réversible et doit donc être conçu pour ne jamais contenir de donnée personnelle, même hachée. La position de la CNIL (septembre 2018, « Blockchain — premiers éléments d’analyse ») admet l’inscription d’une empreinte issue d’une fonction à clé ou d’un arbre de hachage dont les feuilles restent hors chaîne, dès lors que la suppression des données hors chaîne rend l’empreinte inexploitable. Le code actuel respecte ce schéma : seul le condensé d’un lot d’événements quitte l’infrastructure Cartularia. La politique en fait une règle permanente.</p>
            </section>
            <BackToContents />
          </section>

          <section id="partie-2" className="privacy-policy-part">
            <h2>Partie II — La politique</h2>
            <p>Les articles qui suivent forment la politique de protection des données de Cartularia. Ils sont rédigés au présent de l’indicatif et s’imposent au produit, aux équipes et aux prestataires. Les exigences produit correspondantes (préfixes DPR, LEG, SEC des notes de conception) sont rappelées entre crochets.</p>

            <section id="article-1" className="privacy-policy-section">
              <h3>Article 1 — Gouvernance</h3>
              <p><strong>1.1</strong> Cartularia, en sa qualité de responsable de traitement, désigne un référent vie privée. Son nom, une adresse électronique dédiée (privacy@cartularia.fr ou équivalent) et une adresse postale figurent dans la notice d’information et dans les mentions légales. Le référent tient le registre des traitements, le registre des violations, l’inventaire des sous-traitants et le dossier d’AIPD.</p>
              <p><strong>1.2</strong> Toute nouvelle fonctionnalité qui crée, étend ou modifie un traitement de données personnelles fait l’objet, avant développement, d’une fiche de traitement ajoutée au registre et d’une mise à jour de l’AIPD si le risque change. Aucune donnée réelle n’est chargée dans un environnement dont la fiche n’est pas validée. [DPR-001, DPR-010]</p>
              <p><strong>1.3</strong> La politique est revue au moins une fois par an et à chaque changement de prestataire, de région d’hébergement, de base légale ou de jurisprudence significative. Chaque version porte un numéro, une date d’effet et un résumé des changements ; les versions retirées sont archivées. [LEG-003, LEG-004]</p>
            </section>

            <section id="article-2" className="privacy-policy-section">
              <h3>Article 2 — Principes</h3>
              <p><strong>2.1 Secret par défaut.</strong> Un Cartulaire, ses sections, ses prix, ses évaluations, ses médias, ses rapports et ses résultats d’analyse sont secrets à la création. Toute exposition — Folio public, partage, Cercle, rapport — résulte d’un acte explicite du propriétaire, tracé et révocable.</p>
              <p><strong>2.2 Séparation identité / objet.</strong> L’identité civile du propriétaire, ses coordonnées, l’adresse précise des lieux de stockage, les destinataires de transmission et les documents d’identité sont conservés exclusivement dans le Coffre personnel, chiffré côté client. Le Registre et les Cartulaires ne contiennent qu’un pseudonyme et des codes de correspondance. Aucune jointure n’existe côté serveur entre les deux espaces. [SEC, personal-data-boundary]</p>
              <p><strong>2.3 Minimisation.</strong> Les formulaires ne collectent que les champs nécessaires à la finalité déclarée. Les journaux ne conservent pas de charge utile personnelle. Les prestataires ne reçoivent que le strict nécessaire à leur mission : une empreinte de lot pour l’horodatage, une adresse électronique pour une invitation, jamais le contenu d’un Cartulaire.</p>
              <p><strong>2.4 Loyauté et transparence.</strong> Les personnes sont informées avant ou au moment de la collecte, dans un langage clair, de l’identité du responsable, des finalités, des bases légales, des destinataires, des durées, des transferts et de leurs droits. Chaque formulaire renvoie à la section pertinente de la notice et à sa version. [DPR-002]</p>
              <p><strong>2.5 Protection des tiers.</strong> Le propriétaire qui charge un document ou une photographie où figure un tiers — ancien propriétaire, vendeur, héritier, personne visible — est averti de sa responsabilité ; le produit bloque la publication d’un dérivé public contenant un visage, un document nominatif, un domicile ou des métadonnées de localisation. [DPR-009]</p>
            </section>

            <section id="article-3" className="privacy-policy-section">
              <h3>Article 3 — Registre des traitements</h3>
              <p>Le registre ci-dessous est tenu au sens de l’article 30. Il décrit les traitements du périmètre de lancement et ceux annoncés par les notes de conception. Les lignes « à venir » ne sont activées qu’après validation de la fiche détaillée.</p>
              <PolicyTable caption="Registre des traitements T1 à T14" headers={PROCESSING_REGISTER_HEADERS} rows={PROCESSING_REGISTER_ROWS} />
            </section>

            <section id="article-4" className="privacy-policy-section">
              <h3>Article 4 — Durées de conservation</h3>
              <p><strong>4.1</strong> Les durées du registre sont appliquées par catégorie et par finalité, en base active puis en archivage intermédiaire lorsque la loi l’exige. La règle générale est la suivante : les données d’un compte sont conservées tant que le compte est actif ; le compte devient inactif lorsque son titulaire le demande, lorsqu’il résilie, ou automatiquement après vingt-quatre mois sans connexion et après deux rappels restés sans réponse ; les données sont alors purgées deux années civiles après la date d’inactivité, sauf gel juridique ou obligation légale de conservation. [DPR-005]</p>
              <p><strong>4.2</strong> Les publications ne survivent pas à la révocation. Les sauvegardes chiffrées ont un cycle de vie propre de trente jours glissants ; une donnée supprimée en base active disparaît des sauvegardes à l’issue de ce cycle. Les journaux d’intégrité et les reçus d’horodatage, qui ne contiennent que des empreintes, sont conservés sans limite car ils ne constituent plus des données personnelles une fois les données sources effacées.</p>
              <p><strong>4.3</strong> Un test de purge est exécuté avant mise en service puis à chaque trimestre ; il prouve la suppression de la base active, des objets de stockage, des dérivés, des index et l’expiration des sauvegardes. Le résultat est consigné.</p>
            </section>

            <section id="article-5" className="privacy-policy-section">
              <h3>Article 5 — Droits des personnes</h3>
              <p><strong>5.1</strong> Toute personne dispose des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité (articles 15 à 21), du droit de retirer un consentement, du droit de définir des directives relatives au sort de ses données après son décès (article 85 de la loi Informatique et Libertés) et du droit d’introduire une réclamation auprès de la CNIL (3 place de Fontenoy, TSA 80715, 75334 Paris cedex 07 ; www.cnil.fr).</p>
              <p><strong>5.2</strong> Les demandes sont reçues par le canal dédié (adresse privacy et formulaire dans l’espace Compte). Cartularia répond dans un délai d’un mois, prolongeable de deux mois pour les demandes complexes avec information de la personne. L’identité est vérifiée de manière proportionnée : la connexion au compte suffit pour une demande émanant de l’espace authentifié ; un justificatif n’est exigé qu’en cas de doute raisonnable et n’est pas conservé au-delà de la réponse. [DPR-004]</p>
              <p><strong>5.3</strong> Le produit offre en libre-service : l’accès et la rectification (édition du Cartulaire et du Coffre), la portabilité (export complet du compte dans un format structuré, lisible par machine — JSON accompagné des médias originaux — distinct du rapport PDF), la suppression du Coffre et de la copie privée, la révocation des publications et des partages, et la gestion des consentements optionnels.</p>
              <p><strong>5.4</strong> L’effacement connaît trois limites, annoncées dans la notice : les pièces comptables ; les preuves de cession et les journaux soumis à un gel juridique ; et les empreintes ancrées publiquement, qui ne sont pas des données personnelles. Les Folios déjà émis sont des actes distincts : leur révocation est proposée lors de la suppression mais n’est pas automatique, et la notice le dit.</p>
              <p><strong>5.5 Mort du titulaire.</strong> Conformément aux articles 84 à 86 de la loi Informatique et Libertés, le titulaire peut enregistrer dans son Coffre des directives désignant la personne habilitée à accéder au dossier après son décès. À défaut, les héritiers justifiant de leur qualité peuvent obtenir la clôture du compte et, dans la mesure nécessaire à la liquidation de la succession, l’accès aux informations utiles. Le module de transmission et de gel successoral (exigence SUC) met en œuvre ces dispositions.</p>
            </section>

            <section id="article-6" className="privacy-policy-section">
              <h3>Article 6 — Sous-traitants et transferts</h3>
              <p><strong>6.1</strong> Chaque sous-traitant est inscrit à l’inventaire avec sa finalité, sa localisation, les catégories de données reçues, le mécanisme de transfert, les garanties, les sous-traitants ultérieurs et la procédure de réversibilité. Un contrat conforme à l’article 28 est signé ou accepté avant tout flux de données réelles. [DPR-006]</p>
              <p><strong>6.2</strong> La région de référence est l’Espace économique européen. Tout service dont la localisation n’est pas européenne, ou dont le prestataire est soumis à une législation extraterritoriale, est traité comme un transfert et repose sur un mécanisme valide — décision d’adéquation, clauses contractuelles types complétées par une évaluation d’impact du transfert (TIA) — documenté dans l’inventaire. [DPR-007]</p>
              <p>Inventaire à la date de la note :</p>
              <PolicyTable caption="Inventaire des sous-traitants et transferts" headers={PROCESSOR_HEADERS} rows={PROCESSOR_ROWS} />
              <p><strong>6.3</strong> Le Data Privacy Framework est une décision d’adéquation en vigueur. Le recours en annulation de M. Latombe a été rejeté par le Tribunal de l’Union le 3 septembre 2025 (T-553/23) ; un pourvoi est pendant devant la Cour de justice. La politique ne s’appuie sur le DPF qu’à titre subsidiaire et exige que les clauses contractuelles types de Google restent actives en parallèle, de sorte qu’une invalidation n’interrompe pas le service. Elle impose surtout de ne pas créer de dépendance nouvelle : aucune donnée de contenu patrimonial ne doit être hébergée hors de l’Union.</p>
            </section>

            <section id="article-7" className="privacy-policy-section">
              <h3>Article 7 — Sécurité</h3>
              <p><strong>7.1</strong> Les mesures techniques et organisationnelles sont proportionnées au niveau « secret patrimonial » : chiffrement en transit (TLS 1.2 minimum) et au repos ; chiffrement applicatif côté client du Coffre personnel avec dérivation PBKDF2-SHA-256 à 600 000 itérations et AES-GCM 256 ; règles d’accès refusant tout par défaut ; écritures patrimoniales réservées aux fonctions serveur ; authentification renforcée (step-up) avant les actions sensibles ; verrouillage de session après trente minutes d’inactivité ou quinze minutes d’onglet masqué ; en-têtes de sécurité (CSP en mode bloquant, X-Frame-Options, Referrer-Policy, Permissions-Policy) ; validation des fichiers chargés ; journal d’audit chaîné et horodaté ; sauvegardes chiffrées testées ; moindre privilège et revue trimestrielle des habilitations.</p>
              <p><strong>7.2</strong> Le mot de passe du Coffre personnel n’est jamais transmis ni récupérable. La notice avertit l’utilisateur que sa perte entraîne la perte irrémédiable des données du Coffre, et le produit propose une phrase de récupération imprimable.</p>
              <p><strong>7.3</strong> Les environnements de développement, de recette et de production sont séparés. Aucune donnée réelle n’est utilisée en développement ; les jeux de démonstration (IWC, automobile) sont fictifs ou anonymisés.</p>
            </section>

            <section id="article-8" className="privacy-policy-section">
              <h3>Article 8 — Cookies et traceurs</h3>
              <p><strong>8.1</strong> Cartularia n’utilise aucun traceur publicitaire. Les seuls traceurs déposés sans consentement sont ceux strictement nécessaires au service au sens de l’article 82 de la loi Informatique et Libertés et des lignes directrices de la CNIL : jetons d’authentification et de session, marqueur de verrouillage de session, préférences de langue et d’affichage, stockage local du coffre et du journal d’intégrité, et mémorisation du choix de l’utilisateur en matière de traceurs.</p>
              <p><strong>8.2</strong> Tout autre traceur — mesure d’audience non exemptée, reCAPTCHA, vidéo tierce, bouton de partage social — requiert un consentement préalable, libre, spécifique, éclairé et univoque, recueilli par une interface où refuser est aussi simple qu’accepter, sans case pré-cochée ni consentement déduit de la poursuite de la navigation. Le choix, accepté ou refusé, est conservé six mois puis redemandé. La preuve du consentement est enregistrée.</p>
              <p><strong>8.3</strong> La protection contre les abus repose en priorité sur des mécanismes ne déposant pas de traceur tiers : limitation de débit côté serveur, App Check par attestation d’appareil sur mobile, défi visuel auto-hébergé ou déclenché uniquement sur signal de risque. Si reCAPTCHA Enterprise est maintenu sur le web, il n’est chargé qu’après consentement, sur les seules pages d’authentification, et le refus n’empêche pas d’utiliser le service par un chemin alternatif.</p>
              <p><strong>8.4</strong> Les polices de caractères, scripts et feuilles de style sont servis depuis les domaines de Cartularia ; aucun appel à un CDN tiers n’est effectué lors du chargement d’une page.</p>
            </section>

            <section id="article-9" className="privacy-policy-section">
              <h3>Article 9 — Violations de données</h3>
              <p><strong>9.1</strong> Toute suspicion de violation — accès non autorisé, perte, altération, divulgation, indisponibilité — est signalée immédiatement au référent vie privée, qui ouvre une fiche au registre des violations, coordonne le confinement selon le runbook d’incident, qualifie les personnes et données affectées et évalue le risque. [DPR-008]</p>
              <p><strong>9.2</strong> Lorsque la violation est susceptible d’engendrer un risque pour les personnes, Cartularia la notifie à la CNIL dans les soixante-douze heures suivant sa prise de connaissance, par le téléservice dédié, au besoin par étapes. Lorsque le risque est élevé — ce qui sera présumé pour toute fuite de données de Coffre, de lieux de stockage ou de plans de transmission — les personnes concernées sont informées individuellement et sans retard injustifié, avec des recommandations concrètes. Les sous-traitants sont tenus de notifier Cartularia sous vingt-quatre heures.</p>
              <p><strong>9.3</strong> Un exercice de simulation (fuite d’un mandat de partage) est réalisé avant la mise en service puis chaque année.</p>
            </section>

            <section id="article-10" className="privacy-policy-section">
              <h3>Article 10 — Protection dès la conception : règles produit</h3>
              <p>Les règles suivantes sont opposables aux équipes de développement et vérifiées par des tests automatisés.</p>
              <ul>{PRODUCT_RULES.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </section>

            <section id="article-11" className="privacy-policy-section">
              <h3>Article 11 — Information des personnes</h3>
              <p>La notice d’information publique reprend, dans l’ordre et en langage courant, l’identité du responsable et du référent, les finalités et bases légales par traitement, les destinataires et sous-traitants, les transferts et leurs garanties, les durées, les droits et la manière de les exercer, le droit de réclamation auprès de la CNIL, l’existence du chiffrement côté client et ses conséquences, le caractère irréversible des ancrages publics et la politique de traceurs. Une version courte de trois paragraphes est affichée au moment de la création du compte ; la version complète est accessible depuis toutes les pages. L’annexe A propose cette version courte.</p>
            </section>
            <BackToContents />
          </section>

          <section id="partie-3" className="privacy-policy-part">
            <h2>Partie III — Audit de conformité du code actuel</h2>
            <p>L’audit porte sur les deux prototypes présents dans le dossier Application à la date du 21 août 2026 : Prototype Antigravity (React, Vite, Firebase ; environ 330 fichiers source, 80 suites de tests, 26 ADR) et Prototype_Cartulaire_Test (squelette vinext sur Cloudflare Workers). Il a été réalisé par lecture du code, des règles de sécurité, des fichiers de configuration et des runbooks, sans exécution contre un projet Firebase réel. Chaque point est rapporté à un article de la politique et assorti d’un statut : Conforme, Partiel ou Écart.</p>

            <section id="audit-conforme" className="privacy-policy-section">
              <h3>1. Prototype Antigravity — ce qui est conforme</h3>
              <p>Le prototype traduit déjà dans le code une part significative de la politique. Ces points ne demandent qu’à être documentés et maintenus.</p>
              <PolicyTable caption="Constats de conformité du prototype Antigravity au 21 août 2026" headers={COMPLIANCE_HEADERS} rows={COMPLIANCE_ROWS} />
            </section>

            <section id="audit-ecarts" className="privacy-policy-section">
              <h3>2. Prototype Antigravity — écarts à corriger</h3>
              <p>Les écarts sont classés par priorité : P0 bloque toute donnée réelle ; P1 doit être résolu avant l’ouverture au public ; P2 avant la fin du pilote.</p>
              <PolicyTable caption="Seize écarts relevés dans la source v1.0" headers={GAP_HEADERS} rows={GAP_ROWS} />
            </section>

            <section id="audit-prototype-test" className="privacy-policy-section">
              <h3>3. Prototype_Cartulaire_Test</h3>
              <p>Ce second dépôt est un squelette vinext (Next.js compatible) destiné à Cloudflare Workers, avec une base D1 vide et une authentification déléguée à ChatGPT par lecture des en-têtes oai-authenticated-user-email et oai-authenticated-user-full-name. Aucune logique métier Cartularia ne s’y trouve. Trois remarques suffisent. D’abord, ce mode d’authentification transmet l’adresse et le nom complet de l’utilisateur depuis OpenAI vers l’application sans qu’aucun texte n’en informe la personne ; il n’est acceptable que pour un bac à sable. Ensuite, Cloudflare est un prestataire américain : son usage supposerait le même traitement de transfert que Google. Enfin, aucune donnée réelle ne doit y être chargée. La recommandation est de décommissionner ce prototype ou de le marquer explicitement comme environnement de test hors périmètre, et de ne jamais lui associer un domaine Cartularia public.</p>
            </section>

            <section id="audit-synthese" className="privacy-policy-section">
              <h3>4. Synthèse</h3>
              <p>Sur le fond, l’architecture d’Antigravity est déjà celle d’un produit « privacy by design » : elle n’a pas de dette structurelle. La dette est juridique et documentaire — textes, registres, AIPD, parcours des droits — et géographique : le choix américain, tenable en droit aujourd’hui, est fragile et contraire à l’engagement de confidentialité qui fonde la proposition de valeur. La décision de région doit être prise maintenant, parce qu’elle est irréversible pour Firestore et coûteuse à reprendre après le pilote.</p>
            </section>
            <BackToContents />
          </section>

          <section id="partie-4" className="privacy-policy-part">
            <h2>Partie IV — Plan d’action avant mise en service</h2>
            <PolicyTable caption="Plan d’action en dix étapes" headers={ACTION_HEADERS} rows={ACTION_ROWS} />
            <BackToContents />
          </section>

          <section id="annexe-a" className="privacy-policy-part privacy-policy-annex">
            <h2>Annexe A — Notice courte à afficher à la création du compte</h2>
            <div className="privacy-policy-short-notice">
              <p><strong>Vos données chez Cartularia.</strong> Cartularia [forme sociale, siège, RCS] est responsable du traitement de vos données. Nous les utilisons pour créer votre compte, conserver et prouver le dossier de vos objets, publier ce que vous décidez de publier, vous facturer et sécuriser le service. Vos nom, coordonnées, lieux de stockage et destinataires de transmission sont rangés dans un Coffre personnel chiffré sur votre appareil : nous ne pouvons pas les lire, et si vous perdez votre mot de passe de Coffre, nous ne pourrons pas les récupérer.</p>
              <p>Vos données sont hébergées dans l’Union européenne [ou : certaines données de connexion sont traitées aux États-Unis par Google, sous les garanties décrites dans notre politique]. Nous les conservons tant que votre compte est actif, puis deux ans après son inactivité, sauf obligation légale. Seules des empreintes numériques — jamais vos données — sont inscrites de manière permanente pour prouver l’intégrité de vos dossiers.</p>
              <p>Vous pouvez accéder à vos données, les corriger, les exporter, les supprimer, vous opposer à certains traitements, retirer vos consentements et définir ce qu’il en adviendra après votre décès, depuis votre espace Compte ou en écrivant à privacy@[domaine]. Vous pouvez saisir la CNIL (www.cnil.fr). Politique complète : [lien] — version [n°] du [date].</p>
            </div>
            <BackToContents />
          </section>

          <section id="annexe-b" className="privacy-policy-part privacy-policy-annex">
            <h2>Annexe B — Références</h2>
            <PolicyTable caption="Sources juridiques et documentaires" headers={REFERENCE_HEADERS} rows={REFERENCE_ROWS} />
            <BackToContents />
          </section>
        </article>
      </main>

      <PublicFooter />
    </div>
  );
}

export default PrivacyPolicyPage;
