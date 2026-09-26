import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import { describe, expect, it, vi } from 'vitest';
import { PublicationSelectionTable } from '../../src/features/cartulary/components/PublicationSelectionTable';
import { PublicationReadOnlySummary } from '../../src/features/cartulary/components/PublicationReadOnlySummary';
import { publicationBlockIdsFor, PUBLISHED_BLOCK_IDS, type PublishedBlockId } from '../../src/domain/publication';

const everything = {
  website: PUBLISHED_BLOCK_IDS,
  collection: PUBLISHED_BLOCK_IDS,
  community: PUBLISHED_BLOCK_IDS,
  report: PUBLISHED_BLOCK_IDS,
};
const nothing = { website: [], collection: [], community: [], report: [] };
const partial = {
  website: ['media-hero', 'cover-owner'] as PublishedBlockId[],
  collection: [] as PublishedBlockId[],
  community: ['reference-history', 'value-cost-basis'] as PublishedBlockId[],
  report: ['value-cost-basis'] as PublishedBlockId[],
};

const renderTable = (props: Partial<Parameters<typeof PublicationSelectionTable>[0]> = {}) => {
  const onToggle = vi.fn();
  const onReplace = vi.fn();
  const view = render(<PublicationSelectionTable language="FR" selections={everything} canEdit onToggle={onToggle} onReplace={onReplace} {...props} />);
  return { ...view, onToggle, onReplace };
};
const columnHeaders = (table: HTMLElement) => {
  const head = table.querySelector('thead');
  if (!head) throw new Error('thead introuvable');
  return within(head as HTMLElement).getAllByRole('columnheader').map((cell) => cell.querySelector('span[id]')?.textContent ?? cell.textContent);
};
const rowOf = (table: HTMLElement, title: string) => {
  const row = within(table).getByRole('rowheader', { name: title }).closest('tr');
  if (!row) throw new Error(`ligne ${title} introuvable`);
  return row;
};
const checkboxes = () => Array.from(document.querySelectorAll('tbody input[type=checkbox]')) as HTMLInputElement[];

describe('table de sélection « Contenus par destination »', () => {
  it('rend une seule table, 23 lignes, 5 groupes, 57 cases et aucun details', () => {
    const { container } = renderTable();
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Contenus par destination' })).toBeTruthy();
    expect(columnHeaders(tables[0])).toEqual(['Contenu', 'Mini-site', 'Le Cercle', 'Rapport PDF']);
    expect(within(tables[0]).getAllByRole('rowheader')).toHaveLength(23);
    expect(tables[0].querySelectorAll('.publication-summary__group th').length).toBe(5);
    expect(checkboxes()).toHaveLength(57);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(container.querySelectorAll('[data-ai-field="publishing.blocks.website"]')).toHaveLength(14);
    expect(container.querySelectorAll('[data-ai-field="publishing.blocks.report"]')).toHaveLength(23);
    expect(container.querySelectorAll('[data-ai-field]')).toHaveLength(14 + 23);
    const circleBoxes = checkboxes().filter((box) => box.getAttribute('aria-labelledby')?.endsWith('-col-community'));
    expect(circleBoxes).toHaveLength(20);
    for (const box of circleBoxes) expect(box.hasAttribute('data-ai-field')).toBe(false);
    expect(tables[0].parentElement?.getAttribute('style')).toContain('overflow-x: auto');
    expect(tables[0].parentElement?.getAttribute('aria-label')).toBe('Contenus par destination, défilement horizontal possible');
    // V4 relecture A4/A10 : région nommée (aria-label interdit sur un conteneur générique), arrêt de tabulation conservé.
    expect(tables[0].parentElement?.getAttribute('role')).toBe('region');
    expect(tables[0].parentElement?.getAttribute('tabindex')).toBe('0');
    expect(tables[0].querySelector('caption')?.textContent).toBe('Choisir les contenus inclus dans chaque destination');
    expect(container.querySelector('[data-publication-selection="editable"]')).toBeTruthy();
    // V4 relecture A8 : chaque case est enveloppée d'un label de cellule (cible tactile), sans texte : le nom reste celui d'aria-labelledby.
    const cellLabels = container.querySelectorAll('label.publication-summary__cell');
    expect(cellLabels).toHaveLength(57);
    for (const label of Array.from(cellLabels)) { expect(label.textContent).toBe(''); expect(label.querySelector('input[type="checkbox"]')).toBeTruthy(); }
  });

  it('nomme chaque case par son contenu et sa destination', () => {
    renderTable();
    expect(screen.getByRole('checkbox', { name: 'Accueil de l’objet Mini-site' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Accueil de l’objet Rapport PDF' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Accueil de l’objet Le Cercle' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Prix de revient Rapport PDF' })).toBeTruthy();
    const names = checkboxes().map((box) => computeAccessibleName(box));
    expect(new Set(names).size).toBe(57);
    for (const name of names) {
      expect(name).not.toBe('');
      expect(name).not.toBe('on');
      expect(name).toMatch(/ (Mini-site|Le Cercle|Rapport PDF)$/);
    }
    expect(screen.getByRole('button', { name: 'Tout décocher — Mini-site' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tout décocher — Le Cercle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tout décocher — Rapport PDF' })).toBeTruthy();
  });

  it('ne propose jamais un bloc interdit et ne coche jamais hors politique', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(checkboxes().every((box) => box.checked)).toBe(true);
    expect(checkboxes()).toHaveLength(57);
    const costBasisRow = rowOf(table, 'Prix de revient');
    expect(within(costBasisRow).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(costBasisRow).getAllByText('Non proposé pour cette destination')).toHaveLength(2);
    expect(costBasisRow.querySelectorAll('td.is-unavailable')).toHaveLength(2);
    // V4 relecture A10 : le tiret décoratif est masqué aux lecteurs d'écran dans chaque cellule non proposée.
    for (const cell of Array.from(table.querySelectorAll('td.is-unavailable'))) expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    for (const privateTitle of ['Propriétaire', 'Transmission', 'Stockage']) {
      expect(within(table).queryByRole('rowheader', { name: privateTitle })).toBeNull();
    }
    expect(screen.getByText('Propriétaire, Transmission et Stockage restent privés et ne figurent dans aucune destination.')).toBeTruthy();
    expect(screen.getByText(/Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l’aperçu local\./)).toBeTruthy();
    const footer = table.querySelector('tfoot');
    expect(footer?.textContent).toContain('Sélection');
    expect(Array.from(footer?.querySelectorAll('td > span') ?? []).map((node) => node.textContent)).toEqual(['14/14', '20/20', '23/23']);
    expect(within(footer as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual(['Tout décocher', 'Tout décocher', 'Tout décocher']);
  });

  it('reflète la sélection reçue, ligne par ligne, et compte seulement les identifiants autorisés', () => {
    renderTable({ selections: partial });
    const table = screen.getByRole('table');
    expect(checkboxes().filter((box) => box.checked).map((box) => computeAccessibleName(box))).toEqual([
      'Présentation principale Mini-site',
      'Origines Le Cercle',
      'Prix de revient Rapport PDF',
    ]);
    // cover-owner et value-cost-basis (Cercle) figurent dans les tranches mais ne sont ni cochés ni comptés.
    expect(Array.from(table.querySelectorAll('tfoot td > span')).map((node) => node.textContent)).toEqual(['1/14', '1/20', '1/23']);
    expect(within(table.querySelector('tfoot') as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual(['Tout sélectionner', 'Tout sélectionner', 'Tout sélectionner']);
    expect(within(rowOf(table, 'Présentation principale')).getAllByRole('cell')[0].classList.contains('is-included')).toBe(true);
    expect(within(rowOf(table, 'Diaporama')).getAllByRole('cell')[0].classList.contains('is-excluded')).toBe(true);
  });

  it('délègue les commandes sans les réinterpréter', async () => {
    const user = userEvent.setup();
    const { onToggle, onReplace, rerender } = renderTable({ selections: nothing });
    await user.click(screen.getByRole('checkbox', { name: 'Présentation principale Mini-site' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('website', 'media-hero');
    expect(onReplace).not.toHaveBeenCalled();
    // V4 relecture F3 (M29) : chaque colonne transmet sa propre destination.
    await user.click(screen.getByRole('checkbox', { name: 'Diaporama Rapport PDF' }));
    expect(onToggle).toHaveBeenLastCalledWith('report', 'media-slideshow');
    await user.click(screen.getByRole('checkbox', { name: 'Origines Le Cercle' }));
    expect(onToggle).toHaveBeenLastCalledWith('community', 'reference-history');
    expect(onToggle).toHaveBeenCalledTimes(3);
    // Le label de cellule étend la cible : un clic sur le label bascule la case.
    await user.click(screen.getByRole('checkbox', { name: 'Accueil de l’objet Mini-site' }).closest('label')!);
    expect(onToggle).toHaveBeenLastCalledWith('website', 'cover-watch');
    expect(onToggle).toHaveBeenCalledTimes(4);

    await user.click(screen.getByRole('button', { name: 'Tout sélectionner — Le Cercle' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
    expect(onReplace.mock.calls[0][0]).toBe('community');
    expect(onReplace.mock.calls[0][1]([])).toEqual(publicationBlockIdsFor('community'));
    expect(onToggle).toHaveBeenCalledTimes(4);

    rerender(<PublicationSelectionTable language="FR" selections={everything} canEdit onToggle={onToggle} onReplace={onReplace} />);
    await user.click(screen.getByRole('button', { name: 'Tout décocher — Le Cercle' }));
    expect(onReplace).toHaveBeenCalledTimes(2);
    expect(onReplace.mock.calls[1][0]).toBe('community');
    expect(onReplace.mock.calls[1][1](publicationBlockIdsFor('community'))).toEqual([]);
  });

  it('désactive tout en lecture (canEdit=false)', async () => {
    const user = userEvent.setup();
    const { onToggle, onReplace } = renderTable({ canEdit: false });
    const boxes = checkboxes();
    expect(boxes).toHaveLength(57);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    await user.click(boxes[0]);
    await user.click(buttons[0]);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('partage colonnes, lignes et cellules avec le rendu lecture', () => {
    const editor = render(<PublicationSelectionTable language="FR" selections={partial} canEdit onToggle={vi.fn()} onReplace={vi.fn()} />);
    const reader = render(<PublicationReadOnlySummary language="FR" selections={partial} previewUrl="http://localhost/watch-website?preview=local&cartularyId=cart_test" collectionName="Collection de test" publishedWebsiteUrl={null} />);
    const editorTable = within(editor.container).getByRole('table');
    const readerTable = within(reader.container).getByRole('table');
    expect(columnHeaders(editorTable)).toEqual(columnHeaders(readerTable));
    const rowTitles = (table: HTMLElement) => within(table).getAllByRole('rowheader').map((cell) => cell.querySelector('span[id]')?.textContent ?? cell.textContent);
    expect(rowTitles(editorTable)).toEqual(rowTitles(readerTable));
    expect(rowTitles(editorTable)).toHaveLength(23);
    expect(editorTable.querySelectorAll('.publication-summary__group th').length).toBe(readerTable.querySelectorAll('.publication-summary__group th').length);

    const includedCells = (table: HTMLElement) => Array.from(table.querySelectorAll('tbody tr')).flatMap((row) => {
      const title = row.querySelector('th[scope="row"]')?.textContent;
      if (!title) return [];
      return Array.from(row.querySelectorAll('td')).flatMap((cell, index) => (cell.classList.contains('is-included') ? [`${title} · ${index}`] : []));
    });
    const checkedCells = Array.from(editorTable.querySelectorAll('tbody tr')).flatMap((row) => {
      const title = row.querySelector('th[scope="row"]')?.textContent;
      if (!title) return [];
      return Array.from(row.querySelectorAll('td')).flatMap((cell, index) => ((cell.querySelector('input') as HTMLInputElement | null)?.checked ? [`${title} · ${index}`] : []));
    });
    expect(checkedCells).toEqual(['Présentation principale · 0', 'Origines · 1', 'Prix de revient · 2']);
    expect(includedCells(readerTable)).toEqual(checkedCells);
    expect(includedCells(editorTable)).toEqual(checkedCells);
    // D6 (a) : la note du Cercle est la même phrase dans l'éditeur et dans le résumé lecture.
    const circleNote = 'Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l’aperçu local.';
    expect(within(editor.container).getByText(circleNote)).toBeTruthy();
    expect(within(reader.container).getByText(circleNote)).toBeTruthy();
    const privateNote = 'Propriétaire, Transmission et Stockage restent privés et ne figurent dans aucune destination.';
    expect(within(editor.container).getByText(privateNote)).toBeTruthy();
    expect(within(reader.container).getByText(privateNote)).toBeTruthy();
  });

  it('traduit en anglais', () => {
    const { container } = renderTable({ language: 'EN', selections: nothing });
    const table = screen.getByRole('table');
    expect(screen.getByRole('heading', { name: 'Content by destination' })).toBeTruthy();
    expect(columnHeaders(table)).toEqual(['Content', 'Website', 'The Circle', 'PDF report']);
    expect(table.querySelector('caption')?.textContent).toBe('Choose the content included in each destination');
    expect(table.parentElement?.getAttribute('aria-label')).toBe('Content by destination, horizontal scrolling available');
    expect(screen.getByRole('checkbox', { name: 'Accueil de l’objet Website' })).toBeTruthy();
    expect(within(rowOf(table, 'Prix de revient')).getAllByText('Not offered for this destination')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Select all — The Circle' }).textContent).toBe('Select all');
    expect(Array.from(table.querySelectorAll('tfoot td > span')).map((node) => node.textContent)).toEqual(['0/14', '0/20', '0/23']);
    expect(table.querySelector('tfoot td')?.textContent).toBe('Selection');
    expect(screen.getByText(/remain private and appear in no destination/)).toBeTruthy();
    expect(screen.getByText('Publication in The Circle is not available: no server command is connected; the selection serves the local preview.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Contenus par destination|Tout sélectionner|Non proposé|Sélection\b/);
  });
});

it('Jam 22 : les cases en tête sélectionnent seulement la colonne autorisée et signalent une sélection partielle', async () => {
  const { onReplace } = renderTable({ selections: partial });
  const all = screen.getByRole('checkbox', { name: 'Sélectionner tous les contenus — Mini-site' }) as HTMLInputElement;
  expect(all.indeterminate).toBe(true);
  await userEvent.click(all);
  expect(onReplace).toHaveBeenCalledOnce();
  expect(onReplace.mock.calls[0][0]).toBe('website');
  const next = onReplace.mock.calls[0][1]([]);
  expect(next).toEqual(publicationBlockIdsFor('website'));
  expect(next).not.toContain('cover-owner');
  expect(next).not.toContain('value-cost-basis');
});
