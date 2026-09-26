import { useEffect } from 'react';
import { PublicFooter, PublicHeader } from './PublicChrome.tsx';
import './public-site.css';

const CONTENTS = [
  ['essentiel', 'Vos données en bref'],
  ['article-1', 'Votre interlocuteur'],
  ['article-3', 'Les données utilisées et leurs finalités'],
  ['article-2', 'Vos choix de partage'],
  ['article-6', 'Hébergement et prestataires'],
  ['article-4', 'Conservation et suppression'],
  ['article-7', 'Protection de vos dossiers'],
  ['article-8', 'Cookies et stockage sur votre appareil'],
  ['article-5', 'Exercer vos droits'],
] as const;

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
          <p className="privacy-policy-eyebrow">Votre vie privée</p>
          <h1>Politique de protection des données personnelles</h1>
          <p className="privacy-policy-subtitle">Comprendre quelles informations vous confiez à Cartularia, comment elles sont utilisées et comment garder la maîtrise de vos dossiers.</p>
          <p className="privacy-policy-metadata">Information des utilisateurs · Mise à jour du 26 septembre 2026</p>
        </header>

        <section id="essentiel" className="privacy-policy-section privacy-policy-summary" aria-labelledby="essentiel-titre">
          <h2 id="essentiel-titre">Vos données en bref</h2>
          <ul>
            <li>Vos Cartulaires sont secrets à leur création. Vous choisissez les contenus que vous souhaitez partager.</li>
            <li>Le Registre documente vos objets ; le Coffre personnel conserve séparément les informations personnelles que vous y renseignez, sous forme chiffrée.</li>
            <li>Une facture ou une photographie peut révéler une identité ou une adresse. Vérifiez vos pièces jointes avant tout partage.</li>
            <li>Pour une question ou une demande concernant vos données, écrivez à <a href="mailto:contact@cartularia.com">contact@cartularia.com</a>.</li>
          </ul>
        </section>

        <nav id="sommaire" className="privacy-policy-toc" aria-labelledby="sommaire-titre">
          <h2 id="sommaire-titre">Sommaire</h2>
          <ol className="privacy-policy-toc__list">
            {CONTENTS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
          </ol>
        </nav>

        <article className="privacy-policy-document" aria-label="Informations sur vos données personnelles">
          <section id="article-1" className="privacy-policy-section">
            <h2>Votre interlocuteur</h2>
            <p>Adressez vos questions sur l’utilisation de vos données à l’équipe Cartularia : <a href="mailto:contact@cartularia.com">contact@cartularia.com</a>. Précisez l’objet de votre demande sans joindre votre mot de passe ni votre kit de secours.</p>
            <p>L’identité juridique complète et l’adresse postale du responsable de traitement restent à préciser. Le nom Cartularia désigne ici le service.</p>
          </section>

          <section id="article-3" className="privacy-policy-section">
            <h2>Les données utilisées et leurs finalités</h2>
            <ul>
              <li><strong>Votre compte :</strong> vos identifiants de connexion et votre pseudonyme permettent de vous authentifier, de gérer vos accès et de vous fournir le service demandé.</li>
              <li><strong>Vos objets :</strong> descriptions, photographies, vidéos, documents, historique, valeurs et tâches servent à constituer et à suivre vos Cartulaires et Collections. Vous choisissez les informations que vous y ajoutez.</li>
              <li><strong>Votre Coffre personnel :</strong> les identités, coordonnées, lieux de stockage et intentions de transmission que vous renseignez sont conservés séparément de la documentation des objets.</li>
              <li><strong>Les partages et invitations :</strong> les contenus sélectionnés, les destinataires et les autorisations permettent de donner les accès que vous demandez.</li>
              <li><strong>La sécurité :</strong> les informations techniques de connexion et les traces d’actions servent à protéger les comptes, à détecter les abus et à vérifier l’intégrité des dossiers.</li>
              <li><strong>Vos demandes :</strong> vos coordonnées et le contenu de vos échanges permettent de vous répondre et de traiter l’exercice de vos droits. Le formulaire de contact prépare un email dans votre messagerie ; il ne l’envoie pas automatiquement.</li>
            </ul>
            <p>La fourniture du service et les opérations que vous demandez reposent sur l’exécution du contrat ; la protection du service sur l’intérêt légitime à en assurer la sécurité ; le traitement de vos droits sur les obligations légales applicables. Lorsqu’un traitement facultatif nécessite votre consentement, vous pouvez le retirer.</p>
            <p>Les champs obligatoires sont indiqués dans les formulaires. Sans les informations nécessaires à la création du compte, l’accès à votre espace ne peut pas être ouvert. Les informations relatives à vos objets proviennent principalement de vous ; certains documents peuvent aussi contenir des données sur des tiers.</p>
          </section>

          <section id="article-2" className="privacy-policy-section">
            <h2>Vos choix de partage</h2>
            <p>Un nouveau Cartulaire reste en mode Secret. Une publication ou un partage porte sur les contenus que vous sélectionnez et confirmez. Les destinataires autorisés accèdent aux contenus partagés ; un Mini Site public peut être consulté par toute personne disposant de son adresse.</p>
            <p>Les champs personnels du Coffre ne sont pas inclus dans les publications d’objets. Cette séparation ne retire pas les informations nominatives présentes dans vos documents ou vos images : masquez-les avant publication.</p>
            <p>Vous pouvez révoquer une publication. Cette action ferme l’accès proposé par Cartularia, mais ne permet pas d’effacer une copie déjà téléchargée par un destinataire.</p>
          </section>

          <section id="article-6" className="privacy-policy-section">
            <h2>Hébergement et prestataires</h2>
            <p>Le service utilise Google Firebase et Google Cloud pour les comptes, l’hébergement, le stockage et les fonctions nécessaires à son fonctionnement. La configuration actuelle prévoit un hébergement aux États-Unis pour les dossiers et médias ; les données de connexion sont également traitées par Firebase Authentication. Le service ne propose donc pas aujourd’hui un hébergement exclusivement européen.</p>
            <p>Les prestataires techniques peuvent traiter les données nécessaires à leurs services. L’administration de Cartularia peut gérer les accès et les correspondances entre comptes ; elle ne déchiffre pas le contenu du Coffre personnel.</p>
            <p>Lorsqu’un horodatage externe est demandé, une empreinte est transmise au service d’horodatage, pas le contenu du dossier. Un ancrage public confirmé est durable et ne peut pas être retiré comme une publication ordinaire.</p>
            <p>Les informations contractuelles détaillées sur les transferts hors de l’Union européenne restent à compléter. Vous pouvez demander les précisions disponibles à <a href="mailto:contact@cartularia.com">contact@cartularia.com</a> avant de confier des informations personnelles au service.</p>
          </section>

          <section id="article-4" className="privacy-policy-section">
            <h2>Conservation et suppression</h2>
            <p>Vos dossiers sont conservés pendant l’utilisation de votre compte. La règle prévue pour les données privées est une conservation de deux années civiles après le passage du compte à l’état inactif, sous réserve des obligations de conservation et des demandes d’effacement. Cette durée reste en cours de validation ; une absence de connexion ne déclenche pas à elle seule la suppression automatique de votre compte.</p>
            <p>Les durées des sauvegardes et des journaux techniques ne sont pas encore précisées. La suppression d’une copie privée depuis un Cartulaire ne vaut pas suppression complète du compte, de ses publications et de toutes ses preuves d’intégrité.</p>
            <p>Pour demander un effacement complet, contactez-nous en précisant les données concernées. Certaines informations peuvent devoir être conservées lorsqu’une obligation légale ou la défense de droits le justifie ; les empreintes déjà ancrées sur un réseau public ne peuvent pas en être retirées.</p>
          </section>

          <section id="article-7" className="privacy-policy-section">
            <h2>Protection de vos dossiers</h2>
            <p>Le service associe des contrôles d’accès, un verrouillage de session et une séparation entre les informations des objets et celles du Coffre personnel. Le contenu de ce Coffre est chiffré sur votre appareil avant son enregistrement.</p>
            <p>Conservez vos mots de passe et vos kits de secours dans un endroit sûr. Le kit du Registre et celui du Coffre sont distincts ; sans le secret et le secours appropriés, les informations chiffrées peuvent devenir inaccessibles.</p>
            <p>Des copies de travail peuvent rester dans votre navigateur. Sur un appareil partagé, verrouillez votre session et utilisez les commandes d’effacement des copies privées lorsque vous avez terminé. Aucune mesure de sécurité ne permet de promettre un risque nul.</p>
          </section>

          <section id="article-8" className="privacy-policy-section">
            <h2>Cookies et stockage sur votre appareil</h2>
            <p>Cartularia utilise le stockage du navigateur pour les sessions, les préférences et les copies locales nécessaires aux parcours proposés. Le site n’intègre pas de traceur publicitaire ni d’outil de mesure d’audience dans sa version actuelle ; ses polices sont servies avec le site.</p>
            <p>La protection Google reCAPTCHA Enterprise peut être chargée sur les parcours connectés lorsqu’elle est activée. Elle implique des échanges techniques avec Google. La version actuelle ne propose pas encore de réglage de consentement dédié à ce service.</p>
          </section>

          <section id="article-5" className="privacy-policy-section">
            <h2>Exercer vos droits</h2>
            <p>Selon votre situation et les conditions prévues par la réglementation, vous pouvez demander l’accès à vos données, leur rectification, leur effacement, la limitation du traitement, vous y opposer ou demander leur portabilité. Vous pouvez retirer un consentement et définir des directives concernant vos données après votre décès.</p>
            <p>Écrivez à <a href="mailto:contact@cartularia.com?subject=Demande%20relative%20%C3%A0%20mes%20donn%C3%A9es">contact@cartularia.com</a> en indiquant votre demande et les informations permettant de retrouver votre compte. Un justificatif proportionné peut être demandé en cas de doute sur votre identité ; ne transmettez jamais votre mot de passe.</p>
            <p>Le délai légal de réponse est en principe d’un mois. Il peut être prolongé de deux mois si la demande est complexe ou si les demandes sont nombreuses ; vous devez alors être informé de cette prolongation dans le premier mois.</p>
            <p>Les exports et suppressions proposés dans l’interface ne couvrent pas encore tous les éléments du compte. Le rapport PDF est une synthèse du dossier ; il ne remplace pas une demande de portabilité complète.</p>
            <p>Si votre demande reste sans réponse ou si la réponse ne vous satisfait pas, vous pouvez <a href="https://www.cnil.fr/fr/adresser-une-plainte">adresser une réclamation à la CNIL</a>. Vous pouvez également consulter <a href="https://www.cnil.fr/fr/passer-laction/les-droits-des-personnes-sur-leurs-donnees">la présentation de vos droits par la CNIL</a>.</p>
          </section>
          <a className="privacy-policy-back-link" href="#sommaire">Retour au sommaire</a>
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}
