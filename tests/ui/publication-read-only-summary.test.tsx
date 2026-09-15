import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PublicationReadOnlySummary } from '../../src/features/cartulary/components/PublicationReadOnlySummary';
import { PUBLISHED_BLOCK_IDS } from '../../src/domain/publication';

const everything = {
  website: PUBLISHED_BLOCK_IDS,
  collection: PUBLISHED_BLOCK_IDS,
  community: PUBLISHED_BLOCK_IDS,
  report: PUBLISHED_BLOCK_IDS,
};
const previewUrl = 'http://localhost/watch-website?preview=local&cartularyId=cart_demo_object';
// Blocs réellement publiés par scripts/lib/demo-publication-command.mjs (DEFAULT_DEMO_WEBSITE_BLOCKS, 8 blocs).
const onlineBlocks = ['cover-watch', 'media-hero', 'media-library', 'reference-history', 'reference-specs', 'reference-checks', 'condition-description', 'condition-summary'];
const publishedUrl = 'https://cartularia.example/watch-website?publicCode=DEMO-ROL-124060';

const articleOf = (heading: string) => {
  const article = screen.getByRole('heading', { name: heading }).closest('article');
  if (!article) throw new Error(`article ${heading} introuvable`);
  return article;
};
const countOf = (heading: string) => within(articleOf(heading))
  .getByText((_, element) => element?.classList.contains('publication-summary__count') ?? false).textContent;
const columnHeaders = (table: HTMLElement) => {
  const head = table.querySelector('thead');
  if (!head) throw new Error('thead introuvable');
  return within(head as HTMLElement).getAllByRole('columnheader').map((cell) => cell.textContent);
};

describe('résumé de publication en lecture seule', () => {
  it('rend les quatre destinations, une seule table et aucune commande d’édition', () => {
    render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} demonstration />);

    for (const heading of ['Mini-site de votre objet', 'Publiez votre objet dans une Collection', 'Publiez votre objet dans Le Cercle', 'Rapport PDF']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText(/^0[1-4]$/).map((node) => node.textContent)).toEqual(['01', '02', '03', '04']);
    expect(countOf('Mini-site de votre objet')).toBe('14 contenus');
    // D4-B : la Collection renvoie au mini-site de l’objet ; aucun compteur, aucune sélection propre.
    expect(articleOf('Publiez votre objet dans une Collection').querySelector('.publication-summary__count')).toBeNull();
    expect(countOf('Publiez votre objet dans Le Cercle')).toBe('20 contenus');
    expect(countOf('Rapport PDF')).toBe('23 contenus');

    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(1);
    expect(columnHeaders(tables[0])).toEqual(['Contenu', 'Mini-site', 'Le Cercle', 'Rapport PDF']);
    expect(within(tables[0]).getAllByRole('rowheader')).toHaveLength(23);
    expect(tables[0].querySelectorAll('.publication-summary__group th').length).toBe(5);
    expect(within(tables[0]).getAllByText('Inclus')).toHaveLength(14 + 20 + 23);
    expect(tables[0].parentElement?.getAttribute('style')).toContain('overflow-x: auto');

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/Collections indisponibles/)).toBeNull();
    expect(screen.queryByText(/Tout sélectionner/)).toBeNull();
    expect(screen.queryByText(/Connexion requise/)).toBeNull();

    for (const privateTitle of ['Propriétaire', 'Transmission', 'Stockage']) {
      expect(within(tables[0]).queryByText(privateTitle)).toBeNull();
    }
    expect(screen.getByText(/Propriétaire, Transmission et Stockage restent privés/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Démonstration en lecture seule');
    expect(screen.getByText(/Collection de démonstration : Les cinq icônes — la Collection renvoie au mini-site de l’objet ; aucune sélection de contenus propre\./)).toBeTruthy();
    expect(screen.queryByText(/non simulée/)).toBeNull();
    // D6 (a) : même vérité que l’éditeur — aucune commande serveur reliée au Cercle.
    expect(within(articleOf('Publiez votre objet dans Le Cercle')).getByText('Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l’aperçu local.')).toBeTruthy();
  });

  it('reflète la sélection réelle et non le catalogue entier', () => {
    render(<PublicationReadOnlySummary language="FR" selections={{ website: ['media-hero', 'cover-owner'], collection: [], community: [], report: [] }} previewUrl={previewUrl} collectionName="Collection privée" publishedWebsiteUrl={null} />);
    expect(countOf('Mini-site de votre objet')).toBe('1 contenu');
    expect(articleOf('Publiez votre objet dans une Collection').querySelector('.publication-summary__count')).toBeNull();
    expect(countOf('Publiez votre objet dans Le Cercle')).toBe('0 contenu');
    expect(countOf('Rapport PDF')).toBe('0 contenu');
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Inclus')).toHaveLength(1);
    const heroRow = within(table).getByRole('rowheader', { name: 'Présentation principale' }).closest('tr');
    expect(heroRow && within(heroRow).getAllByText('Inclus')).toHaveLength(1);
    expect(screen.getByRole('note').textContent).toContain('Lecture seule : voici ce qui serait publié');
    expect(screen.queryByText(/Démonstration/)).toBeNull();
  });

  it('n’affiche un lien de mini-site que lorsque la publication réelle est constatée', () => {
    const { unmount } = render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} demonstration />);
    expect(screen.queryByRole('link', { name: /Ouvrir le mini-site/ })).toBeNull();
    expect(screen.queryByText(/Publié/)).toBeNull();
    expect(within(articleOf('Mini-site de votre objet')).getByText(/Ce qui serait publié : 14 contenus/)).toBeTruthy();
    const preview = screen.getByRole('link', { name: /Ouvrir l’aperçu local du mini-site/ });
    expect(preview.getAttribute('href')).toBe(previewUrl);
    unmount();

    render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={publishedUrl} publishedWebsiteBlockIds={onlineBlocks} demonstration />);
    const published = screen.getByRole('link', { name: /Ouvrir le mini-site/ });
    expect(published.getAttribute('href')).toContain('publicCode=DEMO-ROL-124060');
    const website = articleOf('Mini-site de votre objet');
    // Le compte « en ligne » est celui des blocs réellement publiés (8), jamais celui de la sélection démo (14).
    expect(within(website).getByText(/Publié/).closest('p')?.textContent).toBe('Publié : 8 contenus en ligne.');
    expect(countOf('Mini-site de votre objet')).toBe('8 contenus');
    expect(website.textContent).not.toContain('14');
    expect(within(website).queryByText(/Ce qui serait publié/)).toBeNull();
    expect(within(website).getByText(/colonne Mini-site de la table reflète les contenus effectivement en ligne/)).toBeTruthy();
    expect(within(website).getByRole('link', { name: /Ouvrir l’aperçu local du mini-site/ })).toBeTruthy();
    // La colonne Mini-site de la table suit les blocs en ligne ; les autres colonnes gardent la sélection.
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Inclus')).toHaveLength(8 + 20 + 23);
    const libraryRow = within(table).getByRole('rowheader', { name: 'Bibliothèque média' }).closest('tr');
    expect(libraryRow && within(libraryRow).getAllByRole('cell')[0].classList.contains('is-included')).toBe(true);
    const slideshowRow = within(table).getByRole('rowheader', { name: 'Diaporama' }).closest('tr');
    expect(slideshowRow && within(slideshowRow).getAllByRole('cell')[0].classList.contains('is-excluded')).toBe(true);
    // Le Cercle reste « ce qui serait publié » et la Collection renvoie au mini-site : une seule vérité par destination.
    expect(within(articleOf('Publiez votre objet dans une Collection')).getByText(/renvoie au mini-site de l’objet/)).toBeTruthy();
    expect(within(articleOf('Publiez votre objet dans une Collection')).queryByText(/Ce qui serait publié/)).toBeNull();
    expect(within(articleOf('Publiez votre objet dans Le Cercle')).getByText(/Ce qui serait publié : 20 contenus/)).toBeTruthy();
  });

  it('n’annonce aucun compte quand la publication est constatée mais la liste des blocs en ligne inconnue', () => {
    render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={publishedUrl} publishedWebsiteBlockIds={null} demonstration />);
    const website = articleOf('Mini-site de votre objet');
    expect(within(website).getByText(/Publié/).closest('p')?.textContent).toBe('Publié : ouvrez le mini-site pour consulter les contenus en ligne.');
    expect(website.querySelector('.publication-summary__count')).toBeNull();
    expect(within(website).getByRole('link', { name: /Ouvrir le mini-site/ })).toBeTruthy();
    expect(within(website).queryByText(/Ce qui serait publié/)).toBeNull();
    // Sans liste en ligne, la table garde la sélection : aucun faux compte n'est déduit.
    expect(within(screen.getByRole('table')).getAllByText('Inclus')).toHaveLength(14 + 20 + 23);
  });

  it('conserve le rapport PDF comme seule action, pilotée par l’état fourni', async () => {
    const onPrintReport = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} onPrintReport={onPrintReport} reportState={{ phase: 'idle' }} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('Préparer le rapport PDF');
    await user.click(buttons[0]);
    expect(onPrintReport).toHaveBeenCalledTimes(1);

    rerender(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} onPrintReport={onPrintReport} reportState={{ phase: 'loading' }} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button').textContent).toContain('Préparation des images');

    rerender(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} onPrintReport={onPrintReport} reportState={{ phase: 'ready', message: 'Demande d’impression envoyée au navigateur.' }} />);
    expect(screen.getByRole('button').textContent).toContain('Imprimer / Enregistrer en PDF');
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      'Demande d’impression envoyée au navigateur.',
      'Images chargées. Vous pouvez maintenant imprimer le rapport.',
    ]);
  });

  it('distingue une cellule interdite par la politique d’une cellule décochée, avec le vocabulaire de l’éditeur (V4 relecture A6)', () => {
    render(<PublicationReadOnlySummary language="FR" selections={everything} previewUrl={previewUrl} collectionName="Les cinq icônes" publishedWebsiteUrl={null} />);
    const table = screen.getByRole('table');
    const costBasisRow = within(table).getByRole('rowheader', { name: 'Prix de revient' }).closest('tr')!;
    // Prix de revient : interdit pour Mini-site et Le Cercle, admis pour le rapport.
    expect(Array.from(costBasisRow.querySelectorAll('td .sr-only')).map((node) => node.textContent)).toEqual(['Non proposé pour cette destination', 'Non proposé pour cette destination', 'Inclus']);
    expect(Array.from(costBasisRow.querySelectorAll('td')).map((cell) => cell.className)).toEqual(['is-unavailable', 'is-unavailable', 'is-included']);
    expect(within(table).queryAllByText('Exclu')).toHaveLength(0);
    expect(within(table).getAllByText('Non proposé pour cette destination')).toHaveLength(12);
    // Le conteneur défilant est une région nommée (aria-label interdit sur un conteneur générique), tabulable, avec le tiret masqué aux lecteurs d'écran.
    const scroller = table.parentElement!;
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.getAttribute('aria-label')).toBe('Contenus par destination, défilement horizontal possible');
    for (const cell of Array.from(table.querySelectorAll('td.is-unavailable'))) expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
  });

  it('nomme « Exclu » une cellule admise mais décochée, et « Ouvrir le mini-site public » le lien publié', () => {
    render(<PublicationReadOnlySummary language="FR" selections={{ website: [], collection: [], community: [], report: [] }} previewUrl={previewUrl} collectionName="Collection privée" publishedWebsiteUrl={publishedUrl} publishedWebsiteBlockIds={[]} />);
    const table = screen.getByRole('table');
    const heroRow = within(table).getByRole('rowheader', { name: 'Présentation principale' }).closest('tr')!;
    expect(Array.from(heroRow.querySelectorAll('td .sr-only')).map((node) => node.textContent)).toEqual(['Exclu', 'Exclu', 'Exclu']);
    expect(within(table).getAllByText('Exclu')).toHaveLength(14 + 20 + 23);
    expect(screen.getByRole('link', { name: 'Ouvrir le mini-site public' }).getAttribute('href')).toBe(publishedUrl);
  });

  it('traduit les en-têtes et les textes contextuels en anglais', () => {
    render(<PublicationReadOnlySummary language="EN" selections={everything} previewUrl={previewUrl} collectionName="The five icons" publishedWebsiteUrl={null} demonstration />);
    expect(columnHeaders(screen.getByRole('table'))).toEqual(['Content', 'Website', 'The Circle', 'PDF report']);
    expect(countOf('Your object website')).toBe('14 items');
    expect(screen.getByRole('heading', { name: 'Your object website' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'PDF report' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('Read-only demonstration');
    expect(within(screen.getByRole('table')).getAllByText('Included')).toHaveLength(57);
    expect(within(screen.getByRole('table')).getAllByText('Not offered for this destination')).toHaveLength(12);
    expect(screen.getByText(/remain private and appear in no destination/)).toBeTruthy();
    expect(screen.getByText(/Demonstration collection: The five icons — the Collection links to the object website; it has no content selection of its own\./)).toBeTruthy();
    expect(within(articleOf('Publish your object in The Circle')).getByText('Publication in The Circle is not available: no server command is connected; the selection serves the local preview.')).toBeTruthy();
    expect(screen.queryByText(/not simulated/)).toBeNull();
  });
});
