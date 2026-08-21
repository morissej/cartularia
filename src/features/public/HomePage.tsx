import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  FolderLock,
  Gem,
  KeyRound,
  LifeBuoy,
  Menu,
  MessageSquareText,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import './public-site.css';

const SERVICES = [
  {
    icon: FolderLock,
    number: '01',
    title: 'Documenter chaque objet',
    text: 'Réunissez identité, état, provenance, documents, médias, valeur et historique dans un Cartulaire structuré.',
  },
  {
    icon: ScanSearch,
    number: '02',
    title: 'Garder la maîtrise',
    text: 'Le dossier reste secret par défaut. Vous choisissez les blocs à partager, à publier ou à conserver privés.',
  },
  {
    icon: Fingerprint,
    number: '03',
    title: 'Établir une continuité',
    text: 'Les versions, sources et preuves autorisées rendent l’histoire du bien plus lisible au fil du temps.',
  },
  {
    icon: Gem,
    number: '04',
    title: 'Piloter une collection',
    text: 'Le Registre rassemble vos Cartulaires, collections, échéances, accès et actions dans une vue transversale.',
  },
];

const STEPS = [
  ['Créer', 'Ouvrez votre compte et votre premier Cartulaire en mode Secret.'],
  ['Documenter', 'Ajoutez progressivement les faits, médias et documents utiles.'],
  ['Maintenir', 'Conservez un historique daté des évolutions, interventions et évaluations.'],
  ['Partager', 'Accordez un accès ciblé ou publiez uniquement les blocs que vous avez choisis.'],
] as const;

const USE_CASES = ['Assurance', 'Acquisition', 'Cession', 'Transmission', 'Gestion patrimoniale'];

export function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactStatus, setContactStatus] = useState('');

  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Cartularia · Le dossier vivant de vos objets patrimoniaux';
    if (description) description.content = 'Cartularia structure, protège et fait vivre le dossier numérique de vos objets patrimoniaux.';
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, []);

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
    setContactStatus('Votre messagerie va s’ouvrir avec la demande préparée. Aucun document patrimonial n’est transmis par ce formulaire.');
    window.location.href = `mailto:contact@cartularia.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="public-site">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <header className="public-header">
        <BrandLogo href="/" />
        <button className="public-menu-trigger" type="button" aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen((current) => !current)}>
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
        </button>
        <nav id="public-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navigation principale">
          <a href="#services" onClick={() => setMenuOpen(false)}>Services</a>
          <a href="#mode-emploi" onClick={() => setMenuOpen(false)}>Mode d’emploi</a>
          <a href="#confiance" onClick={() => setMenuOpen(false)}>Confiance</a>
          <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
        </nav>
        <div className="public-header__actions">
          <a className="public-link-button" href="/account/sign-in">Se connecter</a>
          <a className="public-solid-button" href="/account/create">Créer un compte</a>
        </div>
      </header>

      <main id="main-content">
        <section className="public-hero" aria-labelledby="home-title">
          <div className="public-hero__copy">
            <p className="public-kicker"><Sparkles aria-hidden="true" /> Dossier patrimonial numérique</p>
            <h1 id="home-title">L’histoire de vos objets mérite mieux qu’un dossier dispersé.</h1>
            <p className="public-hero__lead">Cartularia réunit les informations, preuves et décisions qui font vivre un objet patrimonial — sous votre contrôle, dans la durée.</p>
            <div className="public-hero__actions">
              <a className="public-solid-button public-solid-button--large" href="/account/create">Créer un compte <ArrowRight aria-hidden="true" /></a>
              <a className="public-link-button public-link-button--large" href="/account/sign-in">Déjà un compte <ArrowRight aria-hidden="true" /></a>
            </div>
            <a className="public-text-link public-hero__learn" href="#mode-emploi">Découvrir le fonctionnement <ChevronRight aria-hidden="true" /></a>
            <ul className="public-proof-list" aria-label="Principes du service">
              <li><Check aria-hidden="true" /> Secret par défaut</li>
              <li><Check aria-hidden="true" /> Partage sélectif</li>
              <li><Check aria-hidden="true" /> Méthode explicite</li>
            </ul>
          </div>

          <div className="public-hero__product" aria-label="Aperçu du fonctionnement Cartularia">
            <div className="public-product-window">
              <header><span /><span /><span /><small>Cartulaire · Pièce 01</small></header>
              <div className="public-product-window__body">
                <aside><BrandLogo href="/" variant="symbol" decorative /><span className="is-active">Synthèse</span><span>Médias</span><span>Référence</span><span>État</span><span>Valeur</span><span>Publication</span></aside>
                <article>
                  <div className="public-object-visual"><Fingerprint aria-hidden="true" /><span>Objet documenté</span></div>
                  <p className="public-kicker">Dossier maître</p>
                  <h2>Un Cartulaire par objet.</h2>
                  <dl>
                    <div><dt>Statut</dt><dd>Secret</dd></div>
                    <div><dt>Complétude</dt><dd>Essentiel documenté</dd></div>
                    <div><dt>Dernière trace</dt><dd>Aujourd’hui</dd></div>
                  </dl>
                </article>
              </div>
            </div>
            <div className="public-proof-card"><ShieldCheck aria-hidden="true" /><span><small>Contrôle d’accès</small><strong>Vous décidez qui voit quoi</strong></span></div>
          </div>
        </section>

        <section className="public-intro-band" aria-label="Positionnement">
          <p>Pour les propriétaires, collectionneurs et familles qui veulent <strong>documenter avant l’urgence</strong>, transmettre avec clarté et garder la maîtrise de leurs données.</p>
        </section>

        <section className="public-section" id="services" aria-labelledby="services-title">
          <div className="public-section__heading">
            <p className="public-kicker">Les services</p>
            <h2 id="services-title">Du dossier d’un objet à la vision d’ensemble.</h2>
            <p>Chaque surface a un rôle précis. Le Cartulaire documente une pièce ; le Registre pilote la collection ; le Coffre personnel conserve les informations civiles à part.</p>
          </div>
          <div className="public-service-grid">
            {SERVICES.map(({ icon: Icon, number, title, text }) => (
              <article key={number}>
                <header><span>{number}</span><Icon aria-hidden="true" /></header>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="public-spaces" aria-labelledby="spaces-title">
          <div className="public-section__heading public-section__heading--light">
            <p className="public-kicker">Un compte, deux espaces protégés</p>
            <h2 id="spaces-title">Le même nom utilisateur. Deux mots de passe distincts.</h2>
            <p>Cette séparation évite qu’un seul secret n’ouvre à la fois vos dossiers d’objets et vos informations personnelles.</p>
          </div>
          <div className="public-space-grid">
            <article>
              <KeyRound aria-hidden="true" />
              <span className="public-space-grid__number">01</span>
              <h3>Le Registre</h3>
              <p>Vos collections, Cartulaires, échéances, accès et publications autorisées.</p>
              <a href="/account/sign-in?space=registry">Accéder au Registre <ArrowRight aria-hidden="true" /></a>
            </article>
            <article>
              <FolderLock aria-hidden="true" />
              <span className="public-space-grid__number">02</span>
              <h3>Le Coffre personnel</h3>
              <p>Vos identités, coordonnées, lieux réels, gestionnaires et intentions de transmission, chiffrés séparément.</p>
              <a href="/account/sign-in?space=vault">Accéder au Coffre <ArrowRight aria-hidden="true" /></a>
            </article>
          </div>
        </section>

        <section className="public-section public-how" id="mode-emploi" aria-labelledby="how-title">
          <div className="public-section__heading">
            <p className="public-kicker">Mode d’emploi</p>
            <h2 id="how-title">Commencer simplement. Enrichir quand cela compte.</h2>
          </div>
          <ol>
            {STEPS.map(([title, text], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{text}</p></div>
              </li>
            ))}
          </ol>
          <div className="public-use-cases">
            <span>Utile pour</span>
            <ul>{USE_CASES.map((useCase) => <li key={useCase}>{useCase}</li>)}</ul>
          </div>
        </section>

        <section className="public-trust" id="confiance" aria-labelledby="trust-title">
          <div>
            <p className="public-kicker">Confiance par conception</p>
            <h2 id="trust-title">Une preuve a un périmètre. Une donnée a une audience.</h2>
            <p>Cartularia distingue ce que vous déclarez, ce qui est documenté, ce qui est observé et ce qui reste à vérifier. Le service ne transforme pas un dossier en certificat d’authenticité ou de propriété.</p>
            <a className="public-text-link public-text-link--light" href="/cartulary#publication">Voir une démonstration <ArrowRight aria-hidden="true" /></a>
          </div>
          <ul>
            <li><ShieldCheck aria-hidden="true" /><span><strong>Secret par défaut</strong><small>Aucune publication sans sélection explicite.</small></span></li>
            <li><BookOpenCheck aria-hidden="true" /><span><strong>Sources et dates visibles</strong><small>Les faits, estimations et avis restent distingués.</small></span></li>
            <li><Fingerprint aria-hidden="true" /><span><strong>Intégrité vérifiable</strong><small>Les traces techniques prouvent un état, pas l’authenticité de l’objet.</small></span></li>
          </ul>
        </section>

        <section className="public-section public-faq" aria-labelledby="faq-title">
          <div className="public-section__heading">
            <p className="public-kicker">Questions fréquentes</p>
            <h2 id="faq-title">Avant de commencer.</h2>
          </div>
          <div>
            <details><summary>Pourquoi deux mots de passe ? <CircleHelp aria-hidden="true" /></summary><p>Le Registre et le Coffre personnel utilisent des authentifications distinctes. Le même pseudonyme relie votre parcours, sans faire d’un seul mot de passe une clé universelle.</p></details>
            <details><summary>Mes données sont-elles publiques ? <CircleHelp aria-hidden="true" /></summary><p>Non. Un Cartulaire est secret par défaut. Seuls les blocs que vous sélectionnez peuvent être partagés ou publiés.</p></details>
            <details><summary>Cartularia certifie-t-il l’authenticité ? <CircleHelp aria-hidden="true" /></summary><p>Non. Cartularia structure les informations et leurs preuves, mais ne remplace ni une expertise physique, ni un titre juridique, ni l’avis d’un professionnel compétent.</p></details>
            <details><summary>Puis-je commencer avec peu d’informations ? <CircleHelp aria-hidden="true" /></summary><p>Oui. L’identité de la pièce, une photographie de référence et une preuve d’acquisition suffisent pour ouvrir un dossier initial, à enrichir progressivement.</p></details>
          </div>
        </section>

        <section className="public-contact" id="contact" aria-labelledby="contact-title">
          <div className="public-contact__intro">
            <p className="public-kicker">Parler à Cartularia</p>
            <h2 id="contact-title">Une question, un patrimoine constitué ou un projet professionnel ?</h2>
            <p>Décrivez uniquement votre besoin général. Les factures, numéros de série, photographies et documents personnels doivent rester dans un espace authentifié.</p>
            <div><LifeBuoy aria-hidden="true" /><span><strong>Besoin d’aide sur un compte ?</strong><small>Précisez « Support » dans le motif, sans communiquer votre mot de passe.</small></span></div>
          </div>
          <form onSubmit={sendContact}>
            <label>Motif<select name="reason" required defaultValue=""><option value="" disabled>Choisir un motif</option><option>Propriétaire</option><option>Patrimoine constitué</option><option>Professionnel</option><option>Presse</option><option>Sécurité</option><option>Support</option></select></label>
            <div className="public-contact__row"><label>Nom<input name="name" autoComplete="name" required /></label><label>Adresse électronique<input name="email" type="email" autoComplete="email" required /></label></div>
            <div className="public-contact__row"><label>Organisation <span>(facultatif)</span><input name="organization" autoComplete="organization" /></label><label>Territoire <span>(facultatif)</span><input name="territory" autoComplete="country-name" /></label></div>
            <label>Votre besoin général<textarea name="message" rows={5} maxLength={2000} required placeholder="Décrivez le contexte sans joindre ni recopier de donnée patrimoniale sensible." /></label>
            <label className="public-contact__consent"><input type="checkbox" required /> <span>J’accepte d’être recontacté au sujet de cette demande.</span></label>
            <button className="public-solid-button public-solid-button--large" type="submit"><MessageSquareText aria-hidden="true" /> Préparer le message</button>
            {contactStatus && <p className="public-form-status" role="status">{contactStatus}</p>}
          </form>
        </section>

        <section className="public-final-cta">
          <p className="public-kicker">Votre patrimoine, mieux documenté</p>
          <h2>Commencez par un objet. Construisez une continuité.</h2>
          <div><a className="public-solid-button public-solid-button--large" href="/account/create">Créer un compte <ArrowRight aria-hidden="true" /></a><a className="public-link-button public-link-button--light" href="/account/sign-in">Se connecter</a></div>
        </section>
      </main>

      <footer className="public-footer">
        <div><BrandLogo href="/" variant="inverse" /><p>Le dossier vivant de vos objets patrimoniaux.</p></div>
        <nav aria-label="Navigation de pied de page"><a href="#services">Services</a><a href="#mode-emploi">Mode d’emploi</a><a href="#confiance">Confiance</a><a href="#contact">Contact</a><a href="/account/sign-in">Connexion</a></nav>
        <div className="public-footer__legal"><span>© {new Date().getFullYear()} Cartularia</span><span>Confidentialité · Conditions · Accessibilité</span></div>
      </footer>
    </div>
  );
}
