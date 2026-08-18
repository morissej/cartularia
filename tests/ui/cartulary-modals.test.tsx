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
    await user.click(screen.getByRole('button', { name: 'Média suivant' }));
    await user.click(screen.getByRole('button', { name: 'Documentation' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer ce fichier' }));
    expect(onMove).toHaveBeenCalledWith(1);
    expect(onToggleTag).toHaveBeenCalledWith('asset-document', 'documentation');
    expect(onDelete).toHaveBeenCalledWith('asset-document');
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
