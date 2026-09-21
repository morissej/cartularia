import { useEffect, type ComponentType, type ReactNode } from 'react';
import {
  Aperture,
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  CarFront,
  Check,
  CircleDot,
  Coins,
  FileText,
  Fingerprint,
  Focus,
  Gem,
  Globe2,
  Images,
  Layers3,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  Mail,
  Palette,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Video,
  Wine,
} from 'lucide-react';
import { PublicFooter, PublicHeader } from './PublicChrome.tsx';
import {
  DELIVERABLE_DETAILS,
  OBJECT_CATEGORIES,
  PROFESSIONAL_MEDIA_HELP_REASON,
  deliverableFromPathname,
  type PublicIconName,
} from './publicContent.ts';
import './public-site.css';

type IconComponent = ComponentType<{ 'aria-hidden'?: boolean; className?: string }>;

const ICONS: Record<PublicIconName, IconComponent> = {
  archive: Archive,
  book: BookOpen,
  car: CarFront,
  circle: CircleDot,
  coins: Coins,
  file: FileText,
  fingerprint: Fingerprint,
  gem: Gem,
  globe: Globe2,
  image: Images,
  layers: Layers3,
  list: ListChecks,
  palette: Palette,
  scan: ScanLine,
  shield: ShieldCheck,
  sparkles: Sparkles,
  wine: Wine,
};

function EditorialShell({ title, kicker, intro, children }: { title: string; kicker: string; intro: string; children: ReactNode }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} · Cartularia`;
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <div className="public-site public-editorial-site">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <PublicHeader />
      <main id="main-content" tabIndex={-1}>
        <header className="public-editorial-hero">
          <a className="public-back-link" href="/"><ArrowLeft aria-hidden="true" /> Retour à l’accueil</a>
          <p className="public-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p>{intro}</p>
        </header>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

function ObjectsPage() {
  return (
    <EditorialShell
      title="Les objets documentés dans Cartularia"
      kicker="Objets patrimoniaux"
      intro="Sept catégories illustrent le périmètre visé. Le statut de chaque parcours reste explicite pour ne pas confondre une catégorie prévue avec une création déjà disponible."
    >
      <section className="public-editorial-section" aria-labelledby="object-availability-title">
        <div className="public-editorial-callout">
          <ShieldCheck aria-hidden="true" />
          <div>
            <h2 id="object-availability-title">Deux Cartulaires dédiés sont disponibles dans le pilote</h2>
            <p>Les montres et les voitures disposent d’un parcours de création adapté. La fiche standard destinée aux autres objets n’est pas encore ouverte : un bijou, un lingot, un vin ou une œuvre ne doit pas être enregistré sous un profil inadapté.</p>
          </div>
        </div>

        <div className="public-object-grid">
          {OBJECT_CATEGORIES.map((category) => {
            const Icon = ICONS[category.icon];
            return (
              <article key={category.slug} id={category.slug} className="public-object-card">
                <div className="public-object-card__illustration"><Icon aria-hidden={true} /></div>
                <div className="public-object-card__body">
                  <span className={`public-status-chip public-status-chip--${category.availability}`}>{category.availabilityLabel}</span>
                  <h2>{category.name}</h2>
                  <p className="public-object-card__examples">{category.examples}</p>
                  <p>{category.summary}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="public-editorial-cta" aria-labelledby="objects-next-title">
        <div>
          <p className="public-kicker">Préparer le dossier</p>
          <h2 id="objects-next-title">Commencer par des images et des documents lisibles</h2>
          <p>La méthode de prise de vue explique comment constituer une base utile avant de créer un dossier.</p>
        </div>
        <a className="public-solid-button" href="/aide-documentaire">Voir l’aide photo et vidéo <ArrowRight aria-hidden="true" /></a>
      </section>
    </EditorialShell>
  );
}

const WATCH_SHOTS = [
  ['Vue générale et trois-quarts', 'Photographiez la montre entière, droite puis légèrement tournée, avec les proportions visibles.'],
  ['Cadran, aiguilles et index', 'Cadrez de face et ajoutez des détails nets des inscriptions, index, aiguilles et éventuels défauts.'],
  ['Verre et lunette', 'Variez légèrement l’angle de la lumière pour faire apparaître rayures, éclats ou marques sans les masquer.'],
  ['Profils du boîtier et couronne', 'Documentez les deux flancs, la couronne, les poussoirs présents et les arêtes du boîtier.'],
  ['Fond de boîte', 'Photographiez le fond sans ouvrir la montre, avec les gravures visibles lorsqu’elles ne sont pas confidentielles.'],
  ['Bracelet et fermoir', 'Montrez l’extérieur, l’intérieur, les maillons, la boucle et leurs marques d’usage.'],
  ['Gravures et références visibles', 'Ajoutez les références accessibles sans démontage et masquez les numéros à ne pas partager.'],
  ['Marques d’usure', 'Prenez une vue d’ensemble puis un détail de chaque rayure, choc, oxydation ou manque constaté.'],
  ['Boîte, accessoires et documents', 'Photographiez séparément boîte, surboîte, maillons, outils et documents, après avoir masqué les données personnelles.'],
] as const;

const WATCH_VIDEOS = [
  ['Tour complet de l’objet', 'Une rotation lente et stable montre les volumes, les reflets et l’état apparent.'],
  ['Fonctionnement visible', 'Filmez le mouvement des aiguilles, la date ou le chronographe lorsqu’ils sont présents et utilisables.'],
  ['Commandes et complications', 'Montrez seulement les manipulations normales que vous maîtrisez, sans forcer une couronne ou un poussoir.'],
] as const;

function DocumentationHelpPage() {
  const contactHref = `/?motif=${encodeURIComponent(PROFESSIONAL_MEDIA_HELP_REASON)}#contact`;
  return (
    <EditorialShell
      title="Besoin d’aide pour créer la base documentaire de vos objets : photos et vidéos ?"
      kicker="Aide documentaire"
      intro="Une série cohérente d’images facilite l’identification, le suivi de l’état et la lecture du dossier. Cette liste décrit une montre ; adaptez les prises de vue aux fonctions réellement présentes."
    >
      <section className="public-editorial-section public-media-checklist" aria-labelledby="photos-title">
        <div className="public-editorial-heading">
          <Camera aria-hidden="true" />
          <div><p className="public-kicker">Photographies</p><h2 id="photos-title">Les vues à réunir</h2></div>
        </div>
        <div className="public-check-grid">
          {WATCH_SHOTS.map(([title, text]) => <article key={title}><Check aria-hidden="true" /><div><h3>{title}</h3><p>{text}</p></div></article>)}
        </div>
      </section>

      <section className="public-editorial-section public-media-checklist public-media-checklist--video" aria-labelledby="videos-title">
        <div className="public-editorial-heading">
          <Video aria-hidden="true" />
          <div><p className="public-kicker">Vidéos</p><h2 id="videos-title">Les séquences utiles</h2></div>
        </div>
        <div className="public-check-grid public-check-grid--three">
          {WATCH_VIDEOS.map(([title, text]) => <article key={title}><Check aria-hidden="true" /><div><h3>{title}</h3><p>{text}</p></div></article>)}
        </div>
        <p className="public-safety-note"><LockKeyhole aria-hidden="true" /><span><strong>Mouvement :</strong> ne demandez pas au propriétaire d’ouvrir sa montre. Ajoutez une photographie du mouvement uniquement s’il est déjà visible ou si elle a été réalisée par un professionnel compétent.</span></p>
        <p>Selon le modèle, complétez avec les éléments présents : poussoirs, valve, correcteurs, fond transparent, bracelet interchangeable, complications, écran ou accessoires dédiés.</p>
      </section>

      <section className="public-editorial-section" aria-labelledby="choose-help-title">
        <div className="public-editorial-heading"><Lightbulb aria-hidden="true" /><div><p className="public-kicker">Deux parcours</p><h2 id="choose-help-title">Choisir comment constituer la base</h2></div></div>
        <div className="public-path-grid">
          <article>
            <Smartphone aria-hidden="true" />
            <h3>Prendre les photos et vidéos vous-même</h3>
            <p>Préparez l’objet, maîtrisez les reflets et conservez les fichiers originaux, même avec un smartphone.</p>
            <a className="public-link-button" href="/conseils-photo-video">Lire le guide complet <ArrowRight aria-hidden="true" /></a>
          </article>
          <article>
            <Aperture aria-hidden="true" />
            <h3>Demander l’aide d’un professionnel</h3>
            <p>Préparez une demande à Cartularia avec le motif déjà sélectionné. Le site ouvre votre messagerie et n’envoie rien automatiquement.</p>
            <a className="public-solid-button" href={contactHref}><Mail aria-hidden="true" /> Préparer la demande</a>
          </article>
        </div>
      </section>
    </EditorialShell>
  );
}

const PHOTO_GUIDE_SECTIONS = [
  ['Préparer l’objet et l’espace', 'Nettoyez seulement avec une méthode adaptée que vous maîtrisez. Travaillez sur une surface stable, propre et non abrasive. Retirez du cadre les papiers, badges, adresses et écrans qui pourraient révéler une information privée.'],
  ['Choisir une lumière diffuse', 'Placez-vous près d’une grande fenêtre sans soleil direct ou utilisez deux sources diffusées. Évitez le flash frontal, les ombres dures et les mélanges de températures de couleur.'],
  ['Contrôler les reflets', 'Déplacez la lumière ou l’objet par petites étapes plutôt que de masquer les reflets en retouche. Une carte blanche ou noire tenue hors champ aide à dessiner les surfaces polies.'],
  ['Obtenir la netteté', 'Nettoyez l’objectif, touchez la zone importante pour faire le point et stabilisez le téléphone. Utilisez le retardateur ou une télécommande lorsque la vitesse devient lente.'],
  ['Faire les détails et la macro', 'Gardez une distance suffisante pour éviter la déformation. Utilisez le mode macro seulement s’il reste net, puis contrôlez les inscriptions et les marques à 100 % avant de ranger l’objet.'],
  ['Choisir le fond et les angles', 'Préférez un fond uni, mat et contrasté avec l’objet. Conservez une vue frontale, deux trois-quarts, les profils et le dos ; ajoutez les angles propres au modèle.'],
  ['Cadrer avec constance', 'Laissez une marge régulière autour de l’objet, gardez l’horizon droit et évitez le zoom numérique. Reprenez le même cadrage pour suivre une évolution d’état.'],
  ['Filmer utilement', 'Filmez en plan fixe ou avec un mouvement lent, en orientation constante. Commencez et terminez par deux secondes immobiles ; limitez chaque séquence à une fonction ou un tour complet.'],
  ['Conserver les originaux', 'Gardez les fichiers originaux avant recadrage ou compression. Une copie indépendante reste nécessaire ; le pilote ne doit pas devenir le seul lieu de conservation.'],
  ['Nommer et classer', 'Utilisez une convention simple, par exemple date_objet_vue_numéro. Séparez vues générales, détails, état, documents et vidéos pour faciliter l’import et les mises à jour.'],
  ['Vérifier les informations privées', 'Avant tout partage, inspectez l’image elle-même : nom, adresse, numéro de série, certificat, reflet d’écran, géolocalisation ou document visible peuvent révéler plus que le champ Cartularia.'],
] as const;

function PhotoVideoGuidePage() {
  return (
    <EditorialShell
      title="Prendre vos photos et vidéos vous-même"
      kicker="Guide pratique"
      intro="Un smartphone récent suffit souvent pour constituer une base claire. La régularité, la lumière et la vérification finale comptent davantage qu’un effet spectaculaire."
    >
      <section className="public-editorial-section" aria-labelledby="photo-guide-title">
        <h2 id="photo-guide-title" className="sr-only">Guide photo et vidéo en onze étapes</h2>
        <div className="public-guide-grid">
          {PHOTO_GUIDE_SECTIONS.map(([title, text], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><h2>{title}</h2><p>{text}</p></div>
            </article>
          ))}
        </div>
      </section>
      <section className="public-editorial-cta" aria-labelledby="guide-checklist-title">
        <div><p className="public-kicker">Avant de commencer</p><h2 id="guide-checklist-title">Revenir à la liste des vues recommandées</h2><p>Utilisez la liste comme plan de séance et adaptez-la aux éléments réellement présents sur votre montre.</p></div>
        <a className="public-solid-button" href="/aide-documentaire">Ouvrir la liste photo et vidéo <ArrowRight aria-hidden="true" /></a>
      </section>
    </EditorialShell>
  );
}

function DeliverablePage() {
  const item = deliverableFromPathname(window.location.pathname);
  if (!item) {
    return (
      <EditorialShell title="Livrable introuvable" kicker="Livrables" intro="Cette adresse ne correspond à aucun des huit livrables présentés par Cartularia.">
        <section className="public-editorial-section"><a className="public-solid-button" href="/#livrables">Retour aux livrables</a></section>
      </EditorialShell>
    );
  }
  const Icon = ICONS[item.icon];
  return (
    <EditorialShell title={item.title} kicker="Livrable Cartularia" intro={item.summary}>
      <section className="public-editorial-section public-deliverable-detail" aria-labelledby="deliverable-use-title">
        <div className="public-deliverable-detail__copy">
          <Icon aria-hidden={true} className="public-deliverable-detail__icon" />
          <div>
            <p className="public-kicker">À quoi sert ce livrable ?</p>
            <h2 id="deliverable-use-title">{item.utility}</h2>
          </div>
          <h3>Fonctions effectives</h3>
          <ul>{item.features.map((feature) => <li key={feature}><Check aria-hidden="true" /> {feature}</li>)}</ul>
          <h3>Exemple fictif</h3>
          <p>{item.example}</p>
          {item.limit && <p className="public-safety-note"><ShieldCheck aria-hidden="true" /><span><strong>Limite :</strong> {item.limit}</span></p>}
        </div>

        <figure className="public-detail-capture">
          <a href={item.screenshot} target="_blank" rel="noreferrer" aria-label={`Agrandir : ${item.screenshotAlt}`}>
            <img src={item.screenshot} alt={item.screenshotAlt} loading="eager" />
            <span><Focus aria-hidden="true" /> Agrandir la capture</span>
          </a>
          <figcaption>{item.screenshotCaption}</figcaption>
        </figure>
      </section>
      <section className="public-editorial-cta public-editorial-cta--links" aria-label="Continuer">
        <a className="public-link-button" href="/#livrables"><ArrowLeft aria-hidden="true" /> Retour aux livrables</a>
        <a className="public-solid-button" href={item.directHref}>{item.directLabel} <ArrowRight aria-hidden="true" /></a>
        <a className="public-text-link" href="/">Retour à l’accueil</a>
      </section>
      <nav className="public-deliverable-index" aria-label="Les huit livrables">
        {DELIVERABLE_DETAILS.map((entry) => <a key={entry.slug} href={`/livrables/${entry.slug}`} aria-current={entry.slug === item.slug ? 'page' : undefined}>{entry.shortTitle}</a>)}
      </nav>
    </EditorialShell>
  );
}

export function PublicEditorialPage() {
  const pathname = window.location.pathname.replace(/\/$/, '');
  if (pathname === '/objets') return <ObjectsPage />;
  if (pathname === '/aide-documentaire') return <DocumentationHelpPage />;
  if (pathname === '/conseils-photo-video') return <PhotoVideoGuidePage />;
  return <DeliverablePage />;
}
