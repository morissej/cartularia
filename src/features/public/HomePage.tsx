import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Eye,
  FileCheck,
  Fingerprint,
  FolderLock,
  Globe2,
  KeyRound,
  Layers3,
  LifeBuoy,
  Menu,
  MessageSquareText,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import './public-site.css';

const HERO_DEMO_TABS = [
  {
    id: 'synthese',
    label: 'Synthèse',
    title: 'Vue d’ensemble de la pièce',
    badge: 'Secret · Dossier Maître',
    metrics: [
      { label: 'Statut', value: 'Secret' },
      { label: 'Complétude', value: '100% documenté' },
      { label: 'Sceau d’intégrité', value: 'Ancré & daté' },
    ],
    highlight: 'Dossier centralisé : identité, boîte, papiers d’origine, facture d’achat et photographies d’expertise réunies au même endroit.',
  },
  {
    id: 'medias',
    label: 'Médias & 360°',
    title: 'Photographies macro & spin 360°',
    badge: '18 photographies HD',
    metrics: [
      { label: 'Vues nettes', value: 'Cadran, fond, calibre' },
      { label: 'Spin interactif', value: '360° progressif' },
      { label: 'Métadonnées', value: 'Horodatage EXIF vérifié' },
    ],
    highlight: 'Protocole visuel normé pour figer l’état cosmétique exact sans contestation possible lors d’une cession ou d’un sinistre.',
  },
  {
    id: 'technique',
    label: 'Fiche technique',
    title: 'Spécifications et conformité',
    badge: 'Calibre & Référence',
    metrics: [
      { label: 'Référence', value: 'IW377701' },
      { label: 'Numéro de série', value: 'Masqué par défaut' },
      { label: 'Boîtier / Matière', value: 'Acier · 43 mm' },
    ],
    highlight: 'Description minutieuse du mouvement, des complications et des éléments d’origine vérifiés face aux archives.',
  },
  {
    id: 'etat',
    label: 'État & Révisions',
    title: 'Carnet de santé de l’objet',
    badge: 'Historique tracé',
    metrics: [
      { label: 'Dernière révision', value: 'Horloger agréé' },
      { label: 'Test étanchéité', value: 'Conforme (6 bar)' },
      { label: 'Écart de marche', value: '+2 s / jour' },
    ],
    highlight: 'Historique daté des interventions, polissages, révisions et changements de composants avec factures associées.',
  },
  {
    id: 'valeur',
    label: 'Cote & Valeur',
    title: 'Valorisation argumentée',
    badge: 'Cote de marché active',
    metrics: [
      { label: 'Cote moyenne', value: 'Transactions vérifiées' },
      { label: 'Valeur déclarée', value: 'Prête pour assurance' },
      { label: 'Historique prix', value: 'Sources documentées' },
    ],
    highlight: 'Séparation rigoureuse entre prix de revient, cote réelle observée et valeur d’assurance pour éviter tout litige.',
  },
  {
    id: 'partage',
    label: 'Partage sélectif',
    title: 'Watch Website révocable',
    badge: 'Diffusion maîtrisée',
    metrics: [
      { label: 'Audience', value: 'Lien privé ou public' },
      { label: 'Blocs visibles', value: 'Choix granulaire' },
      { label: 'Identité civile', value: 'Strictement masquée' },
    ],
    highlight: 'Partagez une fiche de vente ou un état descriptif à un tiers sans jamais dévoiler votre identité, facture ni lieu de garde.',
  },
] as const;

const DELIVERABLES = [
  {
    icon: FolderLock,
    tag: '01 · Dossier vivant',
    title: 'Le Cartulaire Numérique',
    text: 'Le dossier maître structuré en cinq volets : Synthèse, Médias HD/360°, Référence technique, État & Révisions, et Cote de marché.',
    bullets: ['Fiche technique complète et horodatée', 'Protocole photo haute fidélité', 'Carnet d’entretien et révisions'],
  },
  {
    icon: FileCheck,
    tag: '02 · Document normé',
    title: 'Le Rapport PDF Opposable',
    text: 'Un rapport de synthèse téléchargeable en un clic, formaté pour être directement recevable par les compagnies d’assurance, courtiers et notaires.',
    bullets: ['Conforme aux attentes des experts', 'Pièces justificatives indexées', 'Synthèse claire de l’état et de la valeur'],
  },
  {
    icon: Globe2,
    tag: '03 · Partage sécurisé',
    title: 'Le Watch Website Projeté',
    text: 'Une page web élégante générée à la demande pour un acheteur ou un tiers, accessible par lien révocable sans exposer vos données privées.',
    bullets: ['Contrôle bloc par bloc', 'Identité du propriétaire protégée', 'Révocation immédiate en un clic'],
  },
  {
    icon: Fingerprint,
    tag: '04 · Preuve technique',
    title: 'Le Sceau d’Intégrité',
    text: 'Une empreinte cryptographique et un horodatage vérifiables qui prouvent l’antériorité et la non-altération du dossier sans divulguer son contenu.',
    bullets: ['Horodatage certifié', 'Preuve indépendante de la plateforme', 'Conservation dans la durée'],
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Créer le dossier',
    lead: 'En quelques secondes',
    text: 'Ouvrez un Cartulaire pour chaque pièce importante. Le dossier démarre en mode Secret absolu.',
  },
  {
    num: '02',
    title: 'Rassembler les preuves',
    lead: 'À votre rythme',
    text: 'Ajoutez photographies, numéros masqués, documents d’origine, factures d’achat et certificats d’entretien.',
  },
  {
    num: '03',
    title: 'Suivre & Dater',
    lead: 'Dans la durée',
    text: 'Enregistrez les interventions, suivez l’évolution de la cote et ancrez l’historique avec une trace datée.',
  },
  {
    num: '04',
    title: 'Partager ou Transmettre',
    lead: 'Sous votre contrôle',
    text: 'Générez un rapport pour votre assureur ou un lien sécurisé pour un acquéreur sans exposer votre identité.',
  },
];

const ETHICAL_POINTS = {
  does: [
    'Structure et protège l’ensemble de vos preuves documentaires.',
    'Conserve vos dossiers en mode Secret par défaut.',
    'Distingue rigoureusement faits déclarés, pièces jointes et observations.',
    'Garantit une indépendance totale vis-à-vis des marchands et acheteurs.',
    'Permet l’exportation intégrale de vos données et rapports PDF.',
  ],
  doesNot: [
    'N’achète ni ne vend aucune montre ou objet (pas de marketplace).',
    'Ne délivre pas de faux certificat juridique d’authenticité à distance.',
    'Ne prend aucune commission sur les transactions entre collectionneurs.',
    'Ne transmet jamais vos données personnelles, prix d’achat ou localisation.',
    'Ne monétise ni ne revend aucune information confidentielle.',
  ],
};

const FAQ_ITEMS = [
  {
    question: 'Puis-je découvrir le service sans créer de compte ?',
    answer: 'Oui. Le Cartulaire de démonstration est accessible immédiatement depuis l’accueil en un clic. Vous pouvez explorer les cinq volets, le protocole photographique et la projection publique sans inscription préalable.',
  },
  {
    question: 'Comment Cartularia m’aide-t-il auprès de mon assureur ?',
    answer: 'En cas de sinistre ou de vol, l’assureur exige des preuves d’existence, de possession et d’état antérieures. Cartularia génère un rapport PDF normé, horodaté et documenté avec photos macro, factures et valorisations, réduisant drastiquement les délais et contestations d’indemnisation.',
  },
  {
    question: 'Pourquoi existe-t-il deux espaces (Registre et Coffre personnel) ?',
    answer: 'Pour votre sécurité. Le Registre gère vos dossiers d’objets (fiches techniques, cotes, photos), tandis que le Coffre personnel conserve séparément vos données civiles (identité, adresse réelle, contrat d’assurance, intentions successorales). Ce cloisonnement garantit qu’aucune fuite technique sur un objet ne peut révéler l’identité de son propriétaire.',
  },
  {
    question: 'Cartularia certifie-t-il l’authenticité d’un objet ?',
    answer: 'Non. Cartularia refuse les promesses trompeuses : nous structurons les preuves matérielles et leur historique, mais nous ne remplaçons ni un examen physique par un horloger agréé, ni une expertise judiciaire, ni un titre de propriété légale.',
  },
  {
    question: 'Quels types d’objets puis-je documenter ?',
    answer: 'L’horlogerie de collection et d’exception constitue notre verticale de référence, mais Cartularia est conçu pour accueillir tout objet à forte valeur patrimoniale, sentimentale ou de transmission (bijouterie, instruments, pièces de collection).',
  },
];

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [contactStatus, setContactStatus] = useState('');

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Cartularia · Le dossier vivant de vos objets patrimoniaux & horlogers';
    if (description) {
      description.content =
        'Cartularia structure, protège et valorise le dossier numérique de vos montres et objets patrimoniaux. Secret par défaut, opposable pour l’assurance, clair pour la transmission.';
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
    setContactStatus('Votre client de messagerie a été préparé avec votre demande. Vous pouvez également nous écrire directement à contact@cartularia.com.');
    window.location.href = `mailto:contact@cartularia.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const currentTabInfo = HERO_DEMO_TABS[activeTab] ?? HERO_DEMO_TABS[0];

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>

      {/* HEADER NAVIGATION */}
      <header className="public-header">
        <BrandLogo href="/" />
        <button
          className="public-menu-trigger"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="public-navigation"
          onClick={() => setMenuOpen((current) => !current)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
        </button>

        <nav id="public-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navigation principale">
          <a href="#portes" onClick={() => setMenuOpen(false)}>Usages</a>
          <a href="#livrables" onClick={() => setMenuOpen(false)}>Livrables</a>
          <a href="#methode" onClick={() => setMenuOpen(false)}>Méthode</a>
          <a href="#confiance" onClick={() => setMenuOpen(false)}>Engagements</a>
          <a href="#securite" onClick={() => setMenuOpen(false)}>Sécurité</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
          {menuOpen && (
            <div className="public-header__mobile-actions">
              <a className="public-link-button" href="/cartulary#cover" onClick={() => setMenuOpen(false)}>
                Explorer la démo
              </a>
              <a className="public-link-button" href="/account/sign-in" onClick={() => setMenuOpen(false)}>
                Se connecter
              </a>
              <a className="public-solid-button" href="/account/create" onClick={() => setMenuOpen(false)}>
                Créer un compte
              </a>
            </div>
          )}
        </nav>

        <div className="public-header__actions">
          <a className="public-text-link" href="/cartulary#cover" title="Tester sans inscription">
            <Eye aria-hidden="true" /> Démo directe
          </a>
          <a className="public-link-button" href="/account/sign-in">Se connecter</a>
          <a className="public-solid-button" href="/account/create">Créer un compte</a>
        </div>
      </header>

      <main id="main-content">
        {/* HERO SECTION */}
        <section className="public-hero" aria-labelledby="home-title">
          <div className="public-hero__copy">
            <p className="public-kicker">
              <Sparkles aria-hidden="true" /> Dossier patrimonial & horlogerie d’exception
            </p>
            <h1 id="home-title">L’histoire de vos pièces de valeur mérite mieux qu’un dossier dispersé.</h1>
            <p className="public-hero__lead">
              Cartularia réunit l’identité, l’état, les révisions, les factures et la cote de vos objets de collection dans un dossier structuré et opposable — sous votre contrôle exclusif, dans la durée.
            </p>

            <div className="public-hero__actions">
              <a className="public-solid-button public-solid-button--large" href="/cartulary#cover">
                Explorer un Cartulaire de démo <ArrowRight aria-hidden="true" />
              </a>
              <a className="public-link-button public-link-button--large" href="/account/create">
                Créer mon dossier <ArrowRight aria-hidden="true" />
              </a>
            </div>

            <div className="public-hero__sub-action">
              <span className="public-hero__hint">
                <Check aria-hidden="true" /> Découverte instantanée sans création de compte requise
              </span>
            </div>

            <ul className="public-proof-list" aria-label="Garanties du service">
              <li><Check aria-hidden="true" /> Secret par défaut</li>
              <li><Check aria-hidden="true" /> Rapport opposable pour l’assureur</li>
              <li><Check aria-hidden="true" /> Partage sélectif révocable</li>
              <li><Check aria-hidden="true" /> Preuve d’intégrité datée</li>
            </ul>
          </div>

          {/* HERO INTERACTIVE DEMO PREVIEW */}
          <div className="public-hero__product" aria-label="Aperçu interactif d'un Cartulaire">
            <div className="public-product-window">
              <header>
                <span />
                <span />
                <span />
                <small>Cartulaire · IWC Pilot Chrono · Exemplaire 01</small>
              </header>

              <div className="public-product-window__body">
                <aside aria-label="Onglets du dossier">
                  <BrandLogo href="/" variant="symbol" decorative />
                  {HERO_DEMO_TABS.map((tab, idx) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`public-tab-btn ${activeTab === idx ? 'is-active' : ''}`}
                      onClick={() => setActiveTab(idx)}
                      aria-pressed={activeTab === idx}
                    >
                      {tab.label}
                    </button>
                  ))}
                </aside>

                <article>
                  <div className="public-product-preview-header">
                    <span className="public-preview-badge">{currentTabInfo.badge}</span>
                    <a className="public-preview-direct-link" href="/cartulary#cover">
                      Ouvrir en plein écran <ExternalLink aria-hidden="true" />
                    </a>
                  </div>

                  <h2>{currentTabInfo.title}</h2>
                  <p className="public-preview-highlight">{currentTabInfo.highlight}</p>

                  <dl className="public-preview-metrics">
                    {currentTabInfo.metrics.map((m) => (
                      <div key={m.label}>
                        <dt>{m.label}</dt>
                        <dd>{m.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="public-preview-cta-bar">
                    <a className="public-preview-action" href="/cartulary#cover">
                      Tester ce Cartulaire en direct <ChevronRight aria-hidden="true" />
                    </a>
                  </div>
                </article>
              </div>
            </div>

            <div className="public-proof-card">
              <ShieldCheck aria-hidden="true" />
              <span>
                <small>Contrôle d’accès granulaire</small>
                <strong>Vous décidez exactement qui voit quoi</strong>
              </span>
            </div>
          </div>
        </section>

        {/* INTRO BAND */}
        <section className="public-intro-band" aria-label="Positionnement fondateur">
          <p>
            Pour les propriétaires et familles qui veulent <strong>documenter avant l’urgence</strong>, prouver sans litige auprès de leur assureur et transmettre avec une clarté irréprochable.
          </p>
        </section>

        {/* LES DEUX PORTES D'ENTREE */}
        <section className="public-section" id="portes" aria-labelledby="doors-title">
          <div className="public-section__heading">
            <p className="public-kicker">Deux situations concrètes</p>
            <h2 id="doors-title">Deux portes d’entrée pensées pour le propriétaire.</h2>
            <p>
              Cartularia s’adresse à deux moments décisifs de la vie d’une pièce de valeur. L’outil s’adapte à votre besoin immédiat.
            </p>
          </div>

          <div className="public-doors-grid">
            <article className="public-door-card">
              <header>
                <div className="public-door-icon"><ShieldAlert aria-hidden="true" /></div>
                <span className="public-door-tag">Porte 01 · Protection & Sinistre</span>
              </header>
              <h3>Être couvert et indemnisé sans contestation</h3>
              <p className="public-door-summary">
                En cas de vol, cambriolage ou dommage, l’expert d’assurance exige des preuves formelles d’existence, de possession et d’état.
              </p>
              <div className="public-door-details">
                <div className="public-door-block">
                  <strong>Le problème fréquent :</strong>
                  <p>Factures égarées, photographies floues sur smartphone, cote marchande contestée par l’assureur.</p>
                </div>
                <div className="public-door-block">
                  <strong>La réponse Cartularia :</strong>
                  <p>Un dossier horodaté exhaustif avec photos macro d’état, révisions et cote justifiée, exportable en rapport PDF opposable.</p>
                </div>
              </div>
              <footer className="public-door-footer">
                <a className="public-text-link" href="#livrables">
                  Voir le rapport pour assureurs <ArrowRight aria-hidden="true" />
                </a>
              </footer>
            </article>

            <article className="public-door-card">
              <header>
                <div className="public-door-icon"><Layers3 aria-hidden="true" /></div>
                <span className="public-door-tag">Porte 02 · Transmission & Cession</span>
              </header>
              <h3>Transmettre ou céder en toute sérénité</h3>
              <p className="public-door-summary">
                Lors d’une succession familiale ou d’une vente de gré à gré, prouver l’histoire de la pièce sans révéler sa vie privée est essentiel.
              </p>
              <div className="public-door-details">
                <div className="public-door-block">
                  <strong>Le problème fréquent :</strong>
                  <p>Méfiance d’un acheteur sur l’historique, risque d’exposer ses factures d’achat ou son identité civile.</p>
                </div>
                <div className="public-door-block">
                  <strong>La réponse Cartularia :</strong>
                  <p>Le Watch Website révocable : partagez un lien élégant présentant l’état et la conformité, sans jamais dévoiler vos données personnelles.</p>
                </div>
              </div>
              <footer className="public-door-footer">
                <a className="public-text-link" href="/cartulary#publication">
                  Voir la projection de partage <ArrowRight aria-hidden="true" />
                </a>
              </footer>
            </article>
          </div>
        </section>

        {/* LES 4 LIVRABLES CONCRETS */}
        <section className="public-section public-deliverables-section" id="livrables" aria-labelledby="deliverables-title">
          <div className="public-section__heading">
            <p className="public-kicker">Ce que vous obtenez</p>
            <h2 id="deliverables-title">Quatre livrables tangibles pour chaque objet.</h2>
            <p>
              Cartularia n’est pas un simple tableau de bord : vous disposez d’outils concrets, prêts à être utilisés ou transmis à vos interlocuteurs.
            </p>
          </div>

          <div className="public-deliverables-grid">
            {DELIVERABLES.map(({ icon: Icon, tag, title, text, bullets }) => (
              <article key={title} className="public-deliverable-card">
                <header>
                  <span className="public-deliverable-tag">{tag}</span>
                  <Icon aria-hidden="true" />
                </header>
                <h3>{title}</h3>
                <p className="public-deliverable-desc">{text}</p>
                <ul className="public-deliverable-bullets">
                  {bullets.map((b) => (
                    <li key={b}><Check aria-hidden="true" /> {b}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          <div className="public-deliverables-cta">
            <p>Tous ces livrables sont générés depuis votre espace sécurisé, modifiables et exportables à tout moment.</p>
            <a className="public-solid-button" href="/cartulary#cover">
              Tester les livrables dans la démo <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </section>

        {/* MODE D'EMPLOI & METHODE */}
        <section className="public-section public-how" id="methode" aria-labelledby="how-title">
          <div className="public-section__heading">
            <p className="public-kicker">Méthode pas à pas</p>
            <h2 id="how-title">Commencer simplement. Enrichir avec le temps.</h2>
            <p>Pas besoin de tout remplir le premier jour : commencez avec les éléments dont vous disposez.</p>
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
              <p>Conservez vos noms réels, adresses de stockage, contrats d’assurance et intentions de transmission dans un coffre chiffré séparé.</p>
              <a href="/account/sign-in?space=vault">
                Accéder au Coffre <ArrowRight aria-hidden="true" />
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
            <label>
              Motif de votre demande
              <select name="reason" required defaultValue="">
                <option value="" disabled>Choisir un motif</option>
                <option value="Propriétaire">Propriétaire de montres ou d’objets</option>
                <option value="Patrimoine constitué">Patrimoine constitué / Collection importante</option>
                <option value="Professionnel">Professionnel (Assureur, Courtier, Notaire, Horloger)</option>
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
              <span>J’accepte d’être recontacté au sujet de cette demande conformément à la politique de confidentialité.</span>
            </label>

            <button className="public-solid-button public-solid-button--large" type="submit">
              <MessageSquareText aria-hidden="true" /> Préparer le message
            </button>

            {contactStatus && <p className="public-form-status" role="status">{contactStatus}</p>}
          </form>
        </section>

        {/* FINAL CALL TO ACTION */}
        <section className="public-final-cta">
          <p className="public-kicker">Votre patrimoine, mieux protégé</p>
          <h2>Commencez par un objet. Construisez une continuité dans le temps.</h2>
          <div className="public-final-cta__actions">
            <a className="public-solid-button public-solid-button--large" href="/cartulary#cover">
              Explorer la démo en direct <ArrowRight aria-hidden="true" />
            </a>
            <a className="public-link-button public-link-button--light" href="/account/create">
              Créer mon compte
            </a>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="public-footer">
        <div>
          <BrandLogo href="/" variant="inverse" />
          <p>Le dossier vivant de vos objets patrimoniaux et horlogers.</p>
        </div>
        <nav aria-label="Navigation de pied de page">
          <a href="#portes">Usages</a>
          <a href="#livrables">Livrables</a>
          <a href="#methode">Méthode</a>
          <a href="#confiance">Engagements</a>
          <a href="#securite">Sécurité</a>
          <a href="#faq">FAQ</a>
          <a href="#contact">Contact</a>
          <a href="/cartulary#cover">Démonstrateur</a>
          <a href="/account/sign-in">Connexion</a>
        </nav>
        <div className="public-footer__legal">
          <span>© {new Date().getFullYear()} Cartularia · Tous droits réservés</span>
          <span>Confidentialité · Conditions d’utilisation · Accessibilité WCAG AA</span>
        </div>
      </footer>
    </div>
  );
}
