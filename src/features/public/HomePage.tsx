import { useEffect, useState, type FormEvent } from 'react';
import {
  Archive,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Check,
  CheckCheck,
  CircleDot,
  CircleHelp,
  Copy,
  FileText,
  Fingerprint,
  FolderLock,
  Globe2,
  HardDriveDownload,
  KeyRound,
  Layers3,
  LifeBuoy,
  ListChecks,
  MessageSquareText,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { PublicFooter, PublicHeader } from './PublicChrome.tsx';
import {
  DELIVERABLE_DETAILS,
  DEMO_SUBMARINER_HREF,
  HERO_BENEFITS,
  OBJECTS_FAQ_ANSWER,
  PROFESSIONAL_MEDIA_HELP_REASON,
  contactReasonFromSearch,
} from './publicContent.ts';
import './public-site.css';

const DELIVERABLE_ICONS = {
  cartulaire: BookOpen,
  registre: Archive,
  collection: Layers3,
  'mini-site': Globe2,
  'rapport-pdf': FileText,
  'sceau-integrite': Fingerprint,
  cercle: CircleDot,
  'todo-list': ListChecks,
  'logiciel-local': HardDriveDownload,
} as const;

const USE_CASES = [
  {
    icon: BookOpen,
    tag: 'Connaissance',
    title: "Connaître chaque pièce que l'on possède",
    text: "L'historique de la pièce, les caractéristiques techniques, ce qu'il faut savoir sur le modèle, ...",
    link: '/livrables/cartulaire',
    linkLabel: 'Voir le Cartulaire',
  },
  {
    icon: ShieldAlert,
    tag: 'Protection',
    title: 'Préparer son dossier avant un sinistre',
    text: 'Réunir photographies, vidéos, factures, état et valeurs documentées avant qu’un vol ou un dommage ne rende la collecte plus difficile.',
    link: '/livrables/rapport-pdf',
    linkLabel: 'Voir le rapport PDF',
  },
  {
    icon: Layers3,
    tag: 'Transmission',
    title: 'Transmettre ou céder avec un dossier lisible',
    text: 'Présenter l’histoire et les preuves choisies sans ouvrir tout le dossier privé ni exposer son identité civile.',
    link: '/livrables/mini-site',
    linkLabel: 'Voir le Mini Site',
  },
  {
    icon: ListChecks,
    tag: 'Suivi',
    title: 'Identifier et suivre les actions à mener',
    text: 'Planifier la recherche de documents manquants, les contrôles, les entretiens et les prochaines échéances rattachés à chaque objet.',
    link: '/livrables/todo-list',
    linkLabel: 'Voir la todo list',
  },
  {
    icon: BarChart3,
    tag: 'Vue globale',
    title: 'Voir son patrimoine d’objets de collection',
    text: 'Rassembler les objets dans le Registre et lire les données disponibles à l’échelle d’une Collection ou du patrimoine documenté.',
    link: '/livrables/registre',
    linkLabel: 'Voir le Registre',
  },
  {
    icon: Scale,
    tag: 'Décision',
    title: "Faites évoluer votre collection avec des vraies données d'ensemble",
    text: 'Comparer les faits, les sources, l’état et les valeurs disponibles pour éclairer une décision, sans recommandation automatique ni service de transaction.',
    link: '/livrables/collection',
    linkLabel: 'Voir la Collection',
  },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'Rassembler',
    lead: 'Pour commencer',
    text: "Ouvrez un Cartulaire pour une pièce et réunissez ses papiers, photographies, factures et documents d'origine. Le dossier démarre en mode Secret, sans publication automatique.",
  },
  {
    num: '02',
    title: 'Voir ce qui manque',
    lead: 'Le premier gain',
    text: 'La liste de ce qui manque est ce qui a de la valeur : la todo list la tient, pièce par pièce, avec les contrôles et échéances à venir.',
  },
  {
    num: '03',
    title: 'Dater et mettre à jour',
    lead: 'Dans la durée',
    text: "Enregistrez les interventions, l'état et la valeur à une date ; le Sceau d'intégrité permet de vérifier qu'une version documentée n'a pas changé.",
  },
  {
    num: '04',
    title: 'Compléter pour mieux valoriser',
    lead: 'Au fil de vos avancées',
    text: 'Utilisez la todo list pour rechercher les documents manquants, enrichir chaque dossier et suivre vos progrès. Complétez votre documentation au fur et à mesure pour mieux valoriser chaque pièce et votre collection.',
  },
  {
    num: '05',
    title: "Décider avec la vue d'ensemble",
    lead: "À l'échelle de la collection",
    text: 'Le Registre rassemble la composition, les valeurs documentées et les échéances : garder, compléter, vendre — avec les données disponibles, sans recommandation automatique.',
  },
  {
    num: '06',
    title: 'Répondre le jour même',
    lead: 'Sous votre contrôle',
    text: 'Un rapport pour votre assureur, un lien sécurisé pour un acquéreur, une sélection pour un notaire — sans exposer votre identité.',
  },
];

const ETHICAL_POINTS = {
  does: [
    'Structure et protège l’ensemble de vos preuves documentaires.',
    'Conserve vos dossiers en mode Secret par défaut.',
    'Distingue rigoureusement faits déclarés, pièces jointes et observations.',
    'Sépare la documentation de l’objet d’une éventuelle transaction.',
    'Propose le téléchargement des médias disponibles et une synthèse imprimable en PDF.',
  ],
  doesNot: [
    'N’achète ni ne vend aucune montre ou objet (pas de marketplace).',
    "Ne délivre ni expertise agréée ni certificat d'authenticité.",
    'Ne prend aucune commission sur les transactions entre collectionneurs.',
    'Exclut les champs personnels de la projection publique ; vos pièces jointes restent à vérifier avant partage.',
    'Ne monétise ni ne revend aucune information confidentielle.',
  ],
};

const FAQ_ITEMS = [
  {
    question: 'Je connais mes pièces par cœur. À quoi sert un dossier ?',
    answer: "À vérifier ce que l'on croit savoir. En ouvrant leur registre, beaucoup de collectionneurs découvrent une facture qui était une proforma, une révision dont la date s'est perdue, un numéro jamais vérifié. Le dossier n'ajoute rien à votre mémoire : il établit ce que vous avez, à une date, et ce qui manque.",
  },
  {
    question: 'Puis-je découvrir le service sans créer de compte ?',
    answer: 'Oui. Le Cartulaire de démonstration permet d’explorer six pages sans inscription. Le Registre démo présente cinq objets fictifs en lecture seule ; il ne permet pas de modifier ou publier vos données réelles.',
  },
  {
    question: 'Comment Cartularia m’aide-t-il auprès de mon assureur ?',
    answer: 'Cartularia aide à réunir photographies, factures et observations dans un dossier daté et lisible. Votre assureur détermine les pièces nécessaires et l’indemnisation selon votre contrat ; le service ne garantit ni couverture ni absence de contestation.',
  },
  {
    question: 'Pourquoi existe-t-il deux espaces (Registre et Coffre personnel) ?',
    answer: 'Le Registre gère les dossiers d’objets ; le Coffre conserve les informations personnelles chiffrées dans un projet séparé, avec son propre accès. Cette séparation réduit les rapprochements possibles, sans garantir un risque nul. Vérifiez aussi vos pièces jointes avant de les partager : un document peut lui-même contenir une identité.',
  },
  {
    question: 'Cartularia certifie-t-il l’authenticité d’un objet ?',
    answer: 'Non. Cartularia refuse les promesses trompeuses : nous structurons les preuves matérielles et leur historique, mais nous ne remplaçons ni un examen physique par un horloger agréé, ni une expertise judiciaire, ni un titre de propriété légale.',
  },
  {
    question: 'Quels types d’objets puis-je documenter ?',
    answer: OBJECTS_FAQ_ANSWER,
  },
];

export function HomePage() {
  const [copied, setCopied] = useState(false);
  const [contactStatus, setContactStatus] = useState('');
  const [preparedMessage, setPreparedMessage] = useState('');
  const selectedContactReason = contactReasonFromSearch(window.location.search);

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Cartularia · Le dossier de propriété de vos objets de valeur';
    if (description) {
      description.content =
        "Pour chaque pièce, ses papiers, son état daté, son historique, sa valeur à une date. Pour la collection, une vue d'ensemble. Privé par défaut, prêt le jour où l'on vous demande.";
    }
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, []);

  const copyContactEmail = async () => {
    try {
      await navigator.clipboard.writeText('contact@cartularia.com');
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const sendContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = `Contact Cartularia · ${String(form.get('reason') || 'Demande générale')}`;
    const body = [
      `Nom : ${String(form.get('name') || '')}`,
      `Email : ${String(form.get('email') || '')}`,
      `Organisation : ${String(form.get('organization') || 'Non renseignée')}`,
      `Territoire : ${String(form.get('territory') || 'Non renseigné')}`,
      '',
      String(form.get('message') || ''),
    ].join('\n');
    setPreparedMessage(`À : contact@cartularia.com\nObjet : ${subject}\n\n${body}`);
    setContactStatus('Une ouverture de votre messagerie a été demandée. Aucun message n’a été envoyé par ce site : vérifiez puis envoyez l’email, ou copiez le texte ci-dessous.');
    window.location.href = `mailto:contact@cartularia.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <PublicHeader />

      <main id="main-content" tabIndex={-1}>
        {/* HERO SECTION */}
        <section className="public-hero" aria-labelledby="home-title">
          <div className="public-hero__copy">
            <p className="public-kicker">
              <Sparkles aria-hidden="true" /> DOSSIER PATRIMONIAL POUR OBJET D'EXCEPTION
            </p>
            <h1 id="home-title">L'histoire de vos pièces de valeur mérite un dossier complet et ordonné</h1>
            <p className="public-hero__lead">
              Cartularia réunit la description, l’état, les révisions, les factures et les estimations de vos objets de collection dans un dossier structuré — privé par défaut, avec un partage choisi.
            </p>

            <div className="public-hero__actions">
              <a className="public-solid-button public-solid-button--large" href={DEMO_SUBMARINER_HREF}>
                Explorer le Cartulaire Submariner <ArrowRight aria-hidden="true" />
              </a>
              <a className="public-link-button public-link-button--large" href="/account/create">
                Créer mon dossier <ArrowRight aria-hidden="true" />
              </a>
            </div>

            <ul className="public-proof-list" aria-label="Bénéfices et portée du service">
              {HERO_BENEFITS.map((benefit) => (
                <li key={benefit.label}>
                  <Check aria-hidden="true" />
                  <span><strong>{benefit.label}</strong><small>{benefit.detail}</small></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="public-hero__product" role="group" aria-label="Capture du Cartulaire fictif et accès à la démonstration">
            <figure className="public-hero-capture">
              <a href="/assets/public/captures/cartulaire-accueil.webp" target="_blank" rel="noreferrer" aria-label="Agrandir la capture du Cartulaire fictif Rolex Submariner">
                <img
                  src="/assets/public/captures/cartulaire-accueil.webp"
                  alt="Cartulaire de démonstration Rolex Submariner en lecture seule, avec navigation en six pages et données fictives"
                  width="1440"
                  height="900"
                  fetchPriority="high"
                />
                <span>Agrandir la capture</span>
              </a>
              <figcaption>
                Interface réellement rendue avec un dossier fictif. <a href={DEMO_SUBMARINER_HREF}>Explorer la démonstration en lecture seule</a>.
              </figcaption>
            </figure>

            <div className="public-proof-card">
              <ShieldCheck aria-hidden="true" />
              <span>
                <small>Partage sélectif révocable</small>
                <strong>Vous décidez exactement qui voit quoi</strong>
              </span>
            </div>
          </div>
        </section>

        {/* INTRO BAND */}
        <section className="public-intro-band" aria-label="Positionnement fondateur">
          <p>
            Cartularia s'adresse aux <strong>collectionneurs passionnés</strong> qui veulent comprendre et maîtriser leur collection pour en profiter pleinement et sereinement : <strong>connaître</strong> chaque pièce, tenir l'ensemble prêt avant l'urgence, <strong>décider</strong> avec de vraies données.
          </p>
        </section>

        {/* SIX MOMENTS */}
        <section className="public-section" id="portes" aria-labelledby="doors-title">
          <div className="public-section__heading">
            <p className="public-kicker">Connaître, Maîtriser, Décider</p>
            <h2 id="doors-title">Collectionner est une passion. Maîtrisez-en tous les aspects dans les moindres détails</h2>
          </div>

          <div className="public-doors-grid">
            {USE_CASES.map(({ icon: Icon, tag, title, text, link, linkLabel }) => (
              <article key={title} className="public-door-card">
                <header><div className="public-door-icon"><Icon aria-hidden="true" /></div><span className="public-door-tag">{tag}</span></header>
                <h3>{title}</h3>
                <p className="public-door-summary">{text}</p>
                <footer className="public-door-footer"><a className="public-text-link" href={link}>{linkLabel} <ArrowRight aria-hidden="true" /></a></footer>
              </article>
            ))}
          </div>
        </section>

        {/* LES LIVRABLES */}
        <section className="public-section public-deliverables-section" id="livrables" aria-labelledby="deliverables-title">
          <div className="public-section__heading">
            <p className="public-kicker">Ce que vous obtenez</p>
            <h2 id="deliverables-title">Huit livrables pour suivre vos collections</h2>
            <p>Ouvrez chaque page pour voir son rôle, ses fonctions réellement disponibles et une capture.</p>
          </div>

          <div className="public-deliverables-grid">
            {DELIVERABLE_DETAILS.filter((item) => item.slug !== 'logiciel-local').map((item, index) => {
              const Icon = DELIVERABLE_ICONS[item.slug as keyof typeof DELIVERABLE_ICONS];
              return (
              <a key={item.slug} className="public-deliverable-card" href={`/livrables/${item.slug}`}>
                <header>
                  <span className="public-deliverable-tag">{String(index + 1).padStart(2, '0')} · Livrable</span>
                  <Icon aria-hidden="true" />
                </header>
                <h3>{item.title}</h3>
                <p className="public-deliverable-desc">{item.summary}</p>
                <ul className="public-deliverable-bullets">
                  {item.features.slice(0, 3).map((feature) => (
                    <li key={feature}><Check aria-hidden="true" /> {feature}</li>
                  ))}
                </ul>
                <span className="public-deliverable-card__link">Voir la page de détail <ArrowRight aria-hidden="true" /></span>
              </a>
            );})}
          </div>

        </section>

        {/* MODE D'EMPLOI & METHODE */}
        <section className="public-section public-how" id="methode" aria-labelledby="how-title">
          <div className="public-section__heading">
            <p className="public-kicker">Méthode pas à pas</p>
            <h2 id="how-title">Six gestes. Commencez par une seule pièce.</h2>
            <p>La première chose à faire n'est pas de tout renseigner : choisissez la pièce qui compte le plus et rassemblez ce que vous avez sur elle. Le registre vous dira ce qui manque.</p>
          </div>

          <ol className="public-steps-list">
            {STEPS.map(({ num, title, lead, text }) => (
              <li key={num}>
                <span className="public-step-number">{num}</span>
                <div>
                  <small className="public-step-lead">{lead}</small>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* DEONTOLOGIE & LIMITES (CE QUE NOUS FAISONS / CE QUE NOUS NE FAISONS PAS) */}
        <section className="public-section public-ethics" id="confiance" aria-labelledby="ethics-title">
          <div className="public-section__heading">
            <p className="public-kicker">Déontologie & Indépendance</p>
            <h2 id="ethics-title">La confiance se gagne par la clarté des limites.</h2>
            <p>
              Nous défendons exclusivement l’intérêt du propriétaire. Cela implique des engagements forts et des limites explicites.
            </p>
            <p className="public-safety-note"><ShieldCheck aria-hidden="true" /><span>Ceci n'est pas une expertise agréée. Nous n'achetons pas votre montre. Nous ne sommes payés par aucun acheteur. Nous tenons votre registre.</span></p>
          </div>

          <div className="public-ethics-grid">
            <article className="public-ethics-card public-ethics-card--does">
              <header>
                <BadgeCheck aria-hidden="true" />
                <h3>Ce que fait Cartularia</h3>
              </header>
              <ul>
                {ETHICAL_POINTS.does.map((item) => (
                  <li key={item}><Check aria-hidden="true" /> <span>{item}</span></li>
                ))}
              </ul>
            </article>

            <article className="public-ethics-card public-ethics-card--doesnot">
              <header>
                <Scale aria-hidden="true" />
                <h3>Ce que nous ne faisons pas</h3>
              </header>
              <ul>
                {ETHICAL_POINTS.doesNot.map((item) => (
                  <li key={item}><X aria-hidden="true" /> <span>{item}</span></li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        {/* ARCHITECTURE DOUBLE COFFRE */}
        <section className="public-spaces" id="securite" aria-labelledby="spaces-title">
          <div className="public-section__heading public-section__heading--light">
            <p className="public-kicker">Architecture de protection étanche</p>
            <h2 id="spaces-title">Vos objets d’un côté. Votre identité de l’autre.</h2>
            <p>
              Pour votre sécurité, Cartularia sépare physiquement vos dossiers d’objets et vos informations d’état civil. Aucun lien direct n’associe publiquement vos biens à vos coordonnées réelles.
            </p>
          </div>

          <div className="public-space-grid">
            <article>
              <KeyRound aria-hidden="true" />
              <span className="public-space-grid__number">01</span>
              <h3>Le Registre</h3>
              <p className="public-space-lead">L’espace de pilotage de vos collections</p>
              <p>Gérez vos Cartulaires, fiches techniques, photographies HD, cotes marchandes, échéances d’entretien et projections autorisées.</p>
              <a href="/account/sign-in?space=registry">
                Accéder au Registre <ArrowRight aria-hidden="true" />
              </a>
            </article>

            <article>
              <FolderLock aria-hidden="true" />
              <span className="public-space-grid__number">02</span>
              <h3>Le Coffre Personnel</h3>
              <p className="public-space-lead">L’espace chiffré de vos données civiles</p>
                <p>Conservez vos noms réels, adresses de stockage et intentions de transmission dans un coffre chiffré séparé. Les pièces jointes et contrats n’y sont pas stockés dans cette version.</p>
              <a href="/account/sign-in?space=vault">
                Accéder au Coffre <ArrowRight aria-hidden="true" />
              </a>
            </article>

            <article>
              <HardDriveDownload aria-hidden="true" />
              <span className="public-space-grid__number">03</span>
              <h3>Le logiciel local</h3>
              <p className="public-space-lead">Vos dossiers sur votre ordinateur</p>
              <p>Une option en préparation pour conserver et consulter vos dossiers sur votre poste, sans connexion au web. Aucun installateur n’est encore disponible ; le pilote actuel utilise des services en ligne.</p>
              <a href="/livrables/logiciel-local">
                Découvrir l’option locale <ArrowRight aria-hidden="true" />
              </a>
            </article>
          </div>
        </section>

        {/* FAQ SECTION */}
        <section className="public-section public-faq" id="faq" aria-labelledby="faq-title">
          <div className="public-section__heading">
            <p className="public-kicker">Questions fréquentes</p>
            <h2 id="faq-title">Tout ce que vous devez savoir avant de démarrer.</h2>
            <p>Une question spécifique ? N’hésitez pas à nous contacter directement.</p>
          </div>

          <div className="public-faq-list">
            {FAQ_ITEMS.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  <span>{question}</span>
                  <CircleHelp aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CONTACT SECTION */}
        <section className="public-contact" id="contact" aria-labelledby="contact-title">
          <div className="public-contact__intro">
            <p className="public-kicker">Échanger avec Cartularia</p>
            <h2 id="contact-title">Une question, un besoin particulier ou un projet patrimonial ?</h2>
            <p>
              Nous répondons à toute demande générale. Par mesure de sécurité, ne transmettez aucune facture, numéro de série ou donnée patrimoniale sensible par ce formulaire.
            </p>

            <div className="public-contact-direct-card">
              <LifeBuoy aria-hidden="true" />
              <div>
                <strong>Adresse directe de l’équipe</strong>
                <p>contact@cartularia.com</p>
                <button
                  type="button"
                  className="public-copy-email-btn"
                  onClick={copyContactEmail}
                  aria-live="polite"
                >
                  {copied ? <CheckCheck aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied ? 'Adresse copiée !' : 'Copier l’adresse email'}
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={sendContact} aria-label="Formulaire de prise de contact">
            <p>Ce formulaire prépare un email dans votre logiciel de messagerie ; il ne l’envoie pas. Si aucun logiciel ne s’ouvre, vous pourrez copier le message complet.</p>
            <label>
              Motif de votre demande
              <select name="reason" required defaultValue={selectedContactReason}>
                <option value="" disabled>Choisir un motif</option>
                <option value="Propriétaire">Propriétaire de montres ou d’objets</option>
                <option value="Patrimoine constitué">Patrimoine constitué / Collection importante</option>
                <option value="Professionnel">Professionnel (Assureur, Courtier, Notaire, Horloger)</option>
                <option value={PROFESSIONAL_MEDIA_HELP_REASON}>Aide professionnelle photo et vidéo</option>
                <option value="Presse">Presse & Médias</option>
                <option value="Sécurité">Sécurité & Confidentialité</option>
                <option value="Support">Support technique</option>
              </select>
            </label>

            <div className="public-contact__row">
              <label>
                Votre nom complet
                <input name="name" autoComplete="name" required placeholder="ex. Jean Dupont" />
              </label>
              <label>
                Adresse électronique
                <input name="email" type="email" autoComplete="email" required placeholder="jean.dupont@domaine.com" />
              </label>
            </div>

            <div className="public-contact__row">
              <label>
                Organisation <span>(facultatif)</span>
                <input name="organization" autoComplete="organization" placeholder="Étude, Cabinet, Société…" />
              </label>
              <label>
                Territoire / Ville <span>(facultatif)</span>
                <input name="territory" autoComplete="country-name" placeholder="France, Suisse, Belgique…" />
              </label>
            </div>

            <label>
              Votre message
              <textarea
                name="message"
                rows={5}
                maxLength={2000}
                required
                placeholder="Décrivez votre besoin général sans joindre ni recopier de donnée patrimoniale confidentielle."
              />
            </label>

            <label className="public-contact__consent">
              <input type="checkbox" required />
              <span>J’accepte d’être recontacté au sujet de cette demande conformément à la <a href="/confidentialite">politique de confidentialité</a>.</span>
            </label>

            <button className="public-solid-button public-solid-button--large" type="submit">
              <MessageSquareText aria-hidden="true" /> Préparer le message
            </button>

            {contactStatus && <p className="public-form-status" role="status">{contactStatus}</p>}
            {preparedMessage && <div><label htmlFor="prepared-contact">Message à copier</label><textarea id="prepared-contact" readOnly value={preparedMessage} rows={9} /><button type="button" className="public-link-button" onClick={async () => { try { await navigator.clipboard.writeText(preparedMessage); setContactStatus('Message copié. Collez-le dans votre messagerie pour l’envoyer.'); } catch { setContactStatus('Copie automatique indisponible : sélectionnez et copiez le texte du message.'); } }}>Copier le message complet</button></div>}
          </form>
        </section>

        <section className="public-section" aria-labelledby="service-status-title">
          <p className="public-kicker">Disponibilité du service</p>
          <h2 id="service-status-title">Une version pilote à découvrir avec des données fictives.</h2>
          <p>La démonstration est accessible sans frais ni inscription. Aucun paiement en ligne n’est proposé dans cette version. Les offres définitives, quotas contractuels et engagements de conservation ou de disponibilité ne sont pas encore annoncés.</p>
          <p>Conservez une copie indépendante de vos documents importants. Le pilote ne doit pas devenir leur unique lieu de conservation.</p>
          <a className="public-link-button" href="/service">Voir les fonctions disponibles et les limites</a>
        </section>

        {/* FINAL CALL TO ACTION */}
        <section className="public-final-cta">
          <p className="public-kicker">Connaître, tenir, décider</p>
          <h2>Commencez par une pièce. Le jour où l'on vous demande, vous répondrez le jour même.</h2>
          <div className="public-final-cta__actions">
            <a className="public-solid-button public-solid-button--large" href={DEMO_SUBMARINER_HREF}>
              Explorer la démo en direct <ArrowRight aria-hidden="true" />
            </a>
            <a className="public-link-button public-link-button--light" href="/account/create">
              Créer mon compte
            </a>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
