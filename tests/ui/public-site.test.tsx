import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HomePage } from '../../src/features/public/HomePage.tsx';
import { PROFESSIONAL_MEDIA_HELP_REASON } from '../../src/features/public/publicContent.ts';

describe('Accueil public Cartularia', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('affiche les textes exacts du premier écran et les deux actions principales', () => {
    render(<HomePage />);
    expect(screen.getByText("DOSSIER PATRIMONIAL POUR OBJET D'EXCEPTION")).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("L'histoire de vos pièces de valeur mérite un dossier complet et ordonné");
    expect(screen.getByRole('link', { name: /Explorer le Cartulaire Submariner/i }).getAttribute('href')).toBe('/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#cover');
    expect(screen.getByRole('link', { name: /Créer mon dossier/i }).getAttribute('href')).toBe('/account/create');
    expect(screen.queryByText(/Découverte instantanée sans création de compte requise/i)).toBeNull();
  });

  it('montre une capture fidèle et agrandissable de la vraie démo', () => {
    render(<HomePage />);
    const group = screen.getByRole('group', { name: /Capture du Cartulaire fictif/i });
    const image = screen.getByRole('img', { name: /Cartulaire de démonstration Rolex Submariner/i });
    expect(group.contains(image)).toBe(true);
    expect(image.getAttribute('src')).toBe('/assets/public/captures/cartulaire-accueil.webp');
    expect(screen.getByRole('link', { name: /Agrandir la capture du Cartulaire fictif/i }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1');
  });

  it('présente les six bénéfices demandés avec leurs limites et le partage sélectif dans la carte de preuve', () => {
    render(<HomePage />);
    for (const label of [
      'Tout au même endroit', 'Chaque pièce connue', "Une vue d'ensemble pour décider",
      'Secret et sécurisé par défaut', 'Analyse assistée, revue humaine', 'Preuve d’intégrité datée',
    ]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText('Bénéfices et portée du service').querySelectorAll('li')).toHaveLength(6);
    expect(screen.getByText('Partage sélectif révocable')).toBeTruthy();
    expect(screen.getByText('Vous décidez exactement qui voit quoi')).toBeTruthy();
    expect(screen.getByText(/Le pilote ne produit pas de diagnostic automatique/i)).toBeTruthy();
    expect(screen.getByText(/sans certifier l’authenticité de l’objet/i)).toBeTruthy();
  });

  it('présente six usages homogènes avec la connaissance en premier', () => {
    render(<HomePage />);
    const section = screen.getByRole('heading', { level: 2, name: "Le jour où l'on vous demande — et tous les jours d'avant." }).closest('section');
    const cards = Array.from(section?.querySelectorAll<HTMLElement>('.public-door-card') ?? []);
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual([
      "Connaître chaque pièce que l'on possède",
      'Préparer son dossier avant un sinistre',
      'Transmettre ou céder avec un dossier lisible',
      'Voir son patrimoine d’objets de collection',
      'Identifier et suivre les actions à mener',
      'Garder, compléter ou vendre avec de vraies données',
    ]);
  });

  it('applique le récit de marque à la méthode, la déontologie, la FAQ et l’appel final', () => {
    render(<HomePage />);
    expect(screen.getByText(/Cartularia s'adresse aux collectionneurs passionnés/i)).toBeTruthy();
    const method = screen.getByRole('heading', { level: 2, name: 'Cinq gestes. Commencez par une seule pièce.' }).closest('section');
    expect(method?.querySelectorAll('.public-steps-list > li')).toHaveLength(5);
    for (const title of ['Rassembler', 'Voir ce qui manque', 'Dater et mettre à jour', "Décider avec la vue d'ensemble", 'Répondre le jour même']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeTruthy();
    }
    expect(screen.getByText("Ceci n'est pas une expertise agréée. Nous n'achetons pas votre montre. Nous ne sommes payés par aucun acheteur. Nous tenons votre registre.")).toBeTruthy();
    expect(screen.getByText("Ne délivre ni expertise agréée ni certificat d'authenticité.")).toBeTruthy();
    expect(screen.getByText('Je connais mes pièces par cœur. À quoi sert un dossier ?')).toBeTruthy();
    expect(document.querySelectorAll('.public-faq-list > details')).toHaveLength(6);
    expect(screen.getByRole('heading', { level: 2, name: "Commencez par une pièce. Le jour où l'on vous demande, vous répondrez le jour même." })).toBeTruthy();
    expect(document.title).toBe('Cartularia · Le dossier de propriété de vos objets de valeur');
  });

  it('applique la méta description de l’accueil et restaure sa valeur au démontage', () => {
    const description = document.createElement('meta');
    description.name = 'description';
    description.content = 'Description précédente';
    document.head.append(description);
    const view = render(<HomePage />);
    expect(description.content).toBe("Pour chaque pièce, ses papiers, son état daté, son historique, sa valeur à une date. Pour la collection, une vue d'ensemble. Privé par défaut, prêt le jour où l'on vous demande.");
    view.unmount();
    expect(description.content).toBe('Description précédente');
    description.remove();
  });

  it('affiche huit livrables dans le bon ordre avec une vraie route de détail', () => {
    render(<HomePage />);
    const section = screen.getByRole('heading', { level: 2, name: 'Huit livrables pour suivre vos collections' }).closest('section');
    const links = Array.from(section?.querySelectorAll<HTMLAnchorElement>('.public-deliverable-card') ?? []);
    expect(links.map((link) => link.querySelector('h3')?.textContent)).toEqual([
      'Le Cartulaire', 'Le Registre', 'La Collection', 'Le Mini Site (extrait de Cartulaire ou Collection)',
      'Le rapport PDF', "Le Sceau d'intégrité", 'Le Cercle', 'Une todo list pour gérer votre patrimoine',
    ]);
    expect(links.every((link) => link.getAttribute('href')?.startsWith('/livrables/'))).toBe(true);
  });

  it('conserve les limites éthiques et décrit honnêtement les catégories futures', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 3, name: /Ce que fait Cartularia/i })).toBeTruthy();
    expect(screen.getByText(/N’achète ni ne vend aucune montre ou objet/i)).toBeTruthy();
    expect(screen.getByText(/Dans le pilote actuel, ce parcours standard n’est pas encore ouvert/i)).toBeTruthy();
    expect(screen.queryByText(/Secret absolu|Ne transmet jamais vos données|Garantit une indépendance totale/i)).toBeNull();
  });

  it('préselectionne le motif d’aide professionnelle et le conserve dans le message préparé', () => {
    window.history.replaceState({}, '', `/?motif=${encodeURIComponent(PROFESSIONAL_MEDIA_HELP_REASON)}#contact`);
    render(<HomePage />);
    const select = screen.getByRole('combobox', { name: /Motif de votre demande/i }) as HTMLSelectElement;
    expect(select.value).toBe(PROFESSIONAL_MEDIA_HELP_REASON);
    fireEvent.change(screen.getByRole('textbox', { name: /Votre nom complet/i }), { target: { value: 'Camille Test' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Adresse électronique/i }), { target: { value: 'camille@example.test' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Votre message/i }), { target: { value: 'Aide demandée sans donnée privée.' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(screen.getByRole('form', { name: /Formulaire de prise de contact/i }));
    expect((screen.getByLabelText('Message à copier') as HTMLTextAreaElement).value).toContain(`Objet : Contact Cartularia · ${PROFESSIONAL_MEDIA_HELP_REASON}`);
    expect(screen.getByText(/Aucun message n’a été envoyé par ce site/i)).toBeTruthy();
  });

  it('propose les nouvelles pages dans le menu et retire le bloc de neuf liens du pied de page', () => {
    render(<HomePage />);
    const trigger = screen.getByRole('button', { name: /Ouvrir le menu/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('link', { name: 'Objets' }).getAttribute('href')).toBe('/objets');
    expect(screen.getByRole('link', { name: 'Aide photo et vidéo' }).getAttribute('href')).toBe('/aide-documentaire');
    expect(screen.getByRole('link', { name: 'Démo Submariner' }).getAttribute('href')).toBe('/cartulary-demo?cartularyId=cart_demo_rolex_submariner_124060#cover');
    expect(screen.getByRole('link', { name: 'Registre démo · 5 montres' }).getAttribute('href')).toBe('/account/sign-in?demo=1');
    expect(screen.queryByRole('navigation', { name: /Navigation de pied de page/i })).toBeNull();
    expect(screen.getByText('Le dossier vivant de vos objets patrimoniaux.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Confidentialité/i }).some((link) => link.getAttribute('href') === '/confidentialite')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
});
