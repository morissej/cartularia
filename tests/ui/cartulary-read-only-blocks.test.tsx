import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import * as blocks from '../../src/features/cartulary/components/CartularyReadOnlyBlocks.tsx';
import {
  AnalysisRowsReadOnly,
  CostBasisReadOnly,
  CoverFactsReadOnly,
  DocumentationRegisterReadOnly,
  ExitAssumptionsReadOnly,
  MarketDepthReadOnly,
  OwnershipHistoryReadOnly,
  ValuationLevelsReadOnly,
  VaultCodeListReadOnly,
} from '../../src/features/cartulary/components/CartularyReadOnlyBlocks.tsx';

// V5 point 1 (V-D1, P-D6) : chaque bloc de lecture rend ses valeurs dans le texte de la page, sans aucun contrôle
// de formulaire ni affordance d'édition, avec une ancre IA sur l'élément texte. Fixtures neutres, aucune marque réelle.

const EXPECTED_EXPORTS = [
  'AnalysisRowsReadOnly',
  'CostBasisReadOnly',
  'CoverFactsReadOnly',
  'DocumentationRegisterReadOnly',
  'ExitAssumptionsReadOnly',
  'MarketDepthReadOnly',
  'OwnershipHistoryReadOnly',
  'ValuationLevelsReadOnly',
  'VaultCodeListReadOnly',
];

const cases: Array<{ name: string; element: ReactElement; values: string[] }> = [
  {
    name: 'CoverFactsReadOnly',
    element: <CoverFactsReadOnly assetKindLabel="Montre" statusLabel="Patrimonial" collectionName="Collection d’essai" language="FR" />,
    values: ['Type de bien', 'Montre', 'Statut', 'Patrimonial', 'Collection d’essai'],
  },
  {
    name: 'OwnershipHistoryReadOnly',
    element: <OwnershipHistoryReadOnly language="FR" entries={[
      { id: 'p1', fromYear: '1985', toYear: '2003', description: 'Achat neuf, facture conservée.', firstOwner: true },
      { id: 'p2', fromYear: '2003', toYear: '', description: '', firstOwner: false },
    ]} />,
    values: ['De 1985 à 2003', 'Premier propriétaire', 'Achat neuf, facture conservée.', 'De 2003 à —', 'Description non renseignée.'],
  },
  {
    name: 'VaultCodeListReadOnly',
    element: <VaultCodeListReadOnly language="FR" emptyLabel="Aucun lieu sélectionné." aiField="condition.storage.codeNames[]" items={[
      { id: 's1', correspondenceCode: 'LOC-0001', codeName: 'Résidence secondaire', note: 'Coffre du bureau' },
      { id: 's2', correspondenceCode: 'LOC-0002', codeName: '', note: '' },
      { id: 's3', correspondenceCode: '', codeName: '', note: '' },
    ]} />,
    values: ['01', 'Résidence secondaire', 'Coffre du bureau', '02', 'LOC-0002', '03', 'Non renseigné'],
  },
  {
    name: 'DocumentationRegisterReadOnly',
    element: <DocumentationRegisterReadOnly language="FR" categoryLabel={(category) => category} stateLabel={(state) => `État : ${state}`} items={[
      { id: 'd1', category: 'Facture', description: 'Facture d’origine datée', state: 'Présent' },
      { id: 'd2', category: 'Boîte', description: '', state: 'Manquant' },
    ]} />,
    values: ['Facture', 'Facture d’origine datée', 'État : Présent', 'Boîte', 'Description non renseignée.', 'État : Manquant'],
  },
  {
    name: 'MarketDepthReadOnly',
    element: <MarketDepthReadOnly language="FR" currency="EUR" marketDepth={{ analysisDate: '2026-08-01', activeListings: 7, transactions12m: 3, medianDaysOnMarket: 41, lowValue: 11000, midValue: 12500, highValue: 14000 }} />,
    values: ['Analyse du 01/08/2026', '7', 'Annonces actives', '3', 'Transactions identifiées', '41 j', 'Délai médian estimé', 'Fourchette actuelle', '11 000 €', '14 000 €', 'VALEUR MÉDIANE', '12 500 €'],
  },
  {
    name: 'ValuationLevelsReadOnly',
    element: <ValuationLevelsReadOnly language="FR" currency="EUR" currentValue={12500} net={11800} netAfterTax={11300} retained={{ amount: 12800, saleCostAmount: 1000, taxAmount: 500, explanation: 'Complet, révisé récemment.' }} />,
    values: ['Valorisation brute', '12 800 €', 'Valeur actuelle', '12 500 €', 'Frais de vente estimés', '1 000 €', 'Valorisation nette après frais de vente', '11 800 €', 'Impôts estimés', '500 €', 'Valorisation nette après impôts', '11 300 €', 'Explication de la valeur retenue', 'Complet, révisé récemment.'],
  },
  {
    name: 'AnalysisRowsReadOnly',
    element: <AnalysisRowsReadOnly language="FR" rows={[{ id: 'a1', angle: 'Prix affichés', finding: 'Stables', reading: 'Échantillon restreint.' }]} />,
    values: ['Angle d’analyse', 'Constat', 'Lecture', 'Prix affichés', 'Stables', 'Échantillon restreint.'],
  },
  {
    name: 'CostBasisReadOnly',
    element: <CostBasisReadOnly language="FR" currency="EUR" kindLabel={(kind) => kind} purchase={{ date: '2020-03-15', purchasePrice: 9000 }} expenses={[
      { id: 'e1', kind: 'Révision', date: '2024-05-02', label: 'Révision complète', amount: 650 },
      { id: 'e2', kind: 'Autre', date: '', label: '', amount: 0 },
    ]} />,
    values: ['Achat · 15/03/2020', '9 000 €', 'Révision · Révision complète · 02/05/2024', '650 €', 'Autre · Dépense sans libellé · Date non renseignée', '0 €'],
  },
  {
    name: 'ExitAssumptionsReadOnly',
    element: <ExitAssumptionsReadOnly language="FR" currency="EUR" exit={{ saleDate: '2027-01-10', salePrice: 13000, disposalCostPct: 12.5 }} />,
    values: ['10/01/2027', 'Date de vente', '13 000 €', 'Prix de vente', '12.5 %', 'Coût de cession'],
  },
];

const normalize = (value: string | null) => (value ?? '').replace(/[\u00a0\u202f]/g, ' ');

describe('blocs de lecture du Cartulaire', () => {
  it('exporte exactement les neuf composants attendus', () => {
    expect(Object.keys(blocks).sort()).toEqual([...EXPECTED_EXPORTS].sort());
  });

  for (const { name, element, values } of cases) {
    it(`${name} : valeurs dans le texte, aucun contrôle, ancre IA présente`, () => {
      const { container } = render(element);
      const text = normalize(container.textContent);
      for (const value of values) expect(text, `${name} : « ${value} » absent`).toContain(value);
      for (const role of ['textbox', 'combobox', 'button', 'checkbox'] as const) expect(screen.queryAllByRole(role), `${name} : rôle ${role}`).toHaveLength(0);
      expect(container.querySelectorAll('input, select, textarea, fieldset, button')).toHaveLength(0);
      expect(container.querySelector('[data-ai-field]')).not.toBeNull();
      expect(container.querySelector('.editable-click-target, .editable-fact, [role="button"]')).toBeNull();
    });
  }

  it('affiche les replis « Aucun … » quand la liste est vide', () => {
    const history = render(<OwnershipHistoryReadOnly entries={[]} language="FR" />);
    expect(history.container.textContent).toContain('Aucun propriétaire précédent renseigné.');
    history.unmount();
    const codes = render(<VaultCodeListReadOnly items={[]} emptyLabel="Aucune personne sélectionnée." language="FR" />);
    expect(codes.container.textContent).toContain('Aucune personne sélectionnée.');
    codes.unmount();
    const documents = render(<DocumentationRegisterReadOnly items={[]} categoryLabel={(category) => category} stateLabel={(state) => state} language="FR" />);
    expect(documents.container.textContent).toContain('Aucun élément associé renseigné.');
    documents.unmount();
    const analysis = render(<AnalysisRowsReadOnly rows={[]} language="FR" />);
    expect(analysis.container.textContent).toContain('Aucune ligne d’analyse renseignée.');
  });

  it('rend chaque libellé en anglais quand la langue est EN (parité M2)', () => {
    const { container } = render(<>
      <CoverFactsReadOnly assetKindLabel="Watch" statusLabel="Collection asset" collectionName="Test collection" language="EN" />
      <OwnershipHistoryReadOnly entries={[{ id: 'p1', fromYear: '1985', toYear: '', description: '', firstOwner: true }]} language="EN" />
      <VaultCodeListReadOnly items={[{ id: 's1', correspondenceCode: '', codeName: '', note: '' }]} emptyLabel="No location selected." language="EN" />
      <DocumentationRegisterReadOnly items={[{ id: 'd1', category: 'Autre', description: '', state: 'À vérifier' }]} categoryLabel={() => 'Other'} stateLabel={() => 'To be checked'} language="EN" />
      <MarketDepthReadOnly marketDepth={{ analysisDate: '', activeListings: 1, transactions12m: 1, medianDaysOnMarket: 5, lowValue: 1, midValue: 2, highValue: 3 }} language="EN" />
      <ValuationLevelsReadOnly retained={{ amount: 1, saleCostAmount: 0, taxAmount: 0, explanation: '' }} currentValue={1} net={1} netAfterTax={1} language="EN" />
      <AnalysisRowsReadOnly rows={[{ id: 'a1', angle: 'A', finding: 'B', reading: 'C' }]} language="EN" />
      <CostBasisReadOnly purchase={{ date: '', purchasePrice: 1 }} expenses={[{ id: 'e1', kind: 'Autre', date: '', label: '', amount: 1 }]} kindLabel={() => 'Other'} language="EN" />
      <ExitAssumptionsReadOnly exit={{ saleDate: '', salePrice: 1, disposalCostPct: 0 }} language="EN" />
    </>);
    const text = normalize(container.textContent);
    for (const english of ['Asset type', 'Status', 'From 1985 to —', 'First owner', 'Description not provided.', 'Not specified', 'Market depth', 'Date not provided', 'Active listings', 'Transactions identified · 12 months', '5 d', 'Estimated median time', 'Current range', 'MEDIAN VALUE', 'Gross valuation', 'Current value', 'Estimated selling costs', 'Net valuation after selling costs', 'Estimated taxes', 'Net valuation after taxes', 'Retained value explanation', 'No explanation provided.', 'Analysis angle', 'Finding', 'Interpretation', 'Purchase · Date not provided', 'Untitled expense', 'Sale date', 'Not provided', 'Sale price', 'Disposal cost']) {
      expect(text, `« ${english} » absent`).toContain(english);
    }
    for (const french of ['Type de bien', 'Premier propriétaire', 'Non renseigné', 'Profondeur de marché', 'Annonces actives', 'Fourchette actuelle', 'Valorisation brute', 'Angle d’analyse', 'Achat ·', 'Date de vente', 'Coût de cession']) {
      expect(text, `« ${french} » présent en anglais`).not.toContain(french);
    }
  });
});
