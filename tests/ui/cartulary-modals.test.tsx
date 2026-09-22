import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DeletionDialog,
  MediaViewerModal,
} from '../../src/features/cartulary/modals/CartularyModals.tsx';
import type { Asset } from '../../src/types/index.ts';

const documentAsset: Asset = {
  id: 'asset-document',
  name: 'Facture d’achat',
  originalFileName: 'facture.pdf',
  url: '/facture.pdf',
  type: 'document',
  hash: '1234567890abcdef1234567890abcdef',
  status: 'Archived',
  visibility: 'Secret',
  tags: ['documentation'],
  mimeType: 'application/pdf',
  metadataTimestamp: '2026-08-17T12:00:00Z',
};

describe('visionneuse média extraite', () => {
  it('conserve navigation, catégories et suppression', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const onToggleTag = vi.fn();
    const onDelete = vi.fn();
    render(<MediaViewerModal
      asset={documentAsset}
      assetCount={2}
      position={0}
      audience="Secret"
      language="FR"
      mediaTags={[{ id: 'documentation', label: 'Documentation' }]}
      dialogRef={createRef<HTMLDivElement>()}
      onClose={vi.fn()}
      onMove={onMove}
      onToggleTag={onToggleTag}
      onDelete={onDelete}
    />);

    expect(screen.getByRole('dialog', { name: 'Facture d’achat' })).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Catégories' })).toBeTruthy();
    const download = screen.getByRole('link', { name: 'Télécharger le média : Facture d’achat' });
    expect(download.getAttribute('href')).toBe('/facture.pdf');
    expect(download.getAttribute('download')).toBe('facture.pdf');
    await user.click(screen.getByRole('button', { name: 'Média suivant' }));
    await user.click(screen.getByRole('button', { name: 'Documentation' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer ce fichier' }));
    expect(onMove).toHaveBeenCalledWith(1);
    expect(onToggleTag).toHaveBeenCalledWith('asset-document', 'documentation');
    expect(onDelete).toHaveBeenCalledWith('asset-document');
  });

  // V5 point 1 (coherence.md M5) : readOnly={!canEdit} depuis App.tsx — un lecteur consulte et navigue, sans catégoriser,
  // sans changer la visibilité ni supprimer ; aucun texte « démonstration » dans la modale.
  // V5 relecture (H2) : M5 figeait sept boutons de catégories grisés ; en lecture, les catégories actives sont du texte
  // (V-D1 « texte pur, sans contrôle »), le fieldset n'est pas monté et aucun bouton désactivé ne subsiste.
  it('en lecture seule, conserve la consultation et retire toute commande d’édition', () => {
    const onChangeVisibility = vi.fn();
    render(<MediaViewerModal
      asset={documentAsset}
      assetCount={2}
      position={0}
      audience="Secret"
      language="FR"
      mediaTags={[{ id: 'documentation', label: 'Documentation' }]}
      dialogRef={createRef<HTMLDivElement>()}
      onClose={vi.fn()}
      onMove={vi.fn()}
      onToggleTag={vi.fn()}
      onChangeVisibility={onChangeVisibility}
      onDelete={vi.fn()}
      readOnly
    />);

    expect(screen.getByRole('dialog', { name: 'Facture d’achat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Média suivant' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Télécharger le média : Facture d’achat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Documentation' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Catégories' })).toBeNull();
    expect(document.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect(screen.getByText('Catégories')).toBeTruthy();
    expect(screen.getByText('Documentation').closest('dd')?.getAttribute('data-ai-field')).toBe('media.assets[].tags');
    expect(screen.queryByRole('button', { name: /Supprimer ce fichier/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Autorisation de publication du média/)).toBeNull();
    expect(screen.queryByText(/démonstration/i)).toBeNull();
    expect(onChangeVisibility).not.toHaveBeenCalled();
  });

  it('en lecture seule sans catégorie connue (site public), aucune ligne « Catégories » ni bouton', () => {
    render(<MediaViewerModal
      asset={documentAsset}
      assetCount={1}
      position={0}
      audience="Tous"
      language="FR"
      mediaTags={[]}
      dialogRef={createRef<HTMLDivElement>()}
      onClose={vi.fn()}
      onMove={vi.fn()}
      onToggleTag={vi.fn()}
      onDelete={vi.fn()}
      readOnly
    />);
    expect(screen.queryByText('Catégories')).toBeNull();
    expect(document.querySelectorAll('fieldset, button[disabled]')).toHaveLength(0);
  });
});

describe('confirmation de suppression extraite', () => {
  it('sépare clairement conservation et confirmation', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeletionDialog
      deletion={{ title: 'Supprimer le document', description: 'Cette action est annulable.', targetLabel: 'facture.pdf', onConfirm: vi.fn() }}
      error={null}
      submitting={false}
      language="FR"
      dialogRef={createRef<HTMLDivElement>()}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />);

    expect(screen.getByRole('alertdialog', { name: 'Supprimer le document' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Conserver' }));
    await user.click(screen.getByRole('button', { name: 'Confirmer la suppression' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
