import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Original à la demande (contrat V3, K4/K6) : la visionneuse affiche la variante de scène et ne transfère
 * l'original qu'après « Afficher l'original » ; la séquence 360° ne précharge que des variantes ; l'écran
 * de succès de la création annonce honnêtement les médias sans aperçu. Propriétaire simulé hors fixtures.
 */
const resolveOriginal = vi.hoisted(() => vi.fn());
const resolvePresentation = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/privateMedia.ts', () => ({ acquirePrivateMediaObjectUrl: resolveOriginal, acquirePrivatePresentationObjectUrl: resolvePresentation }));

import { MediaViewerModal } from '../../src/features/cartulary/modals/CartularyModals.tsx';
import { Spin360 } from '../../src/components/Spin360.tsx';
// Import statique du module simulé : les imports dynamiques concurrents des composants retombent sûrement sur la simulation.
import { acquirePrivateMediaObjectUrl, acquirePrivatePresentationObjectUrl } from '../../src/services/privateMedia.ts';
import type { Asset } from '../../src/types/index.ts';

const CARTULARY = 'cart_on_demand_v3';
const presentationOf = (binaryId: string): NonNullable<Asset['privatePresentation']> => ({
  binaryId, version: 'presentation-v3',
  variants: [768, 1200].map((width) => ({ width, height: Math.round(width * 3 / 4), storagePath: `private-derivatives/owner_on_demand/${CARTULARY}/${binaryId}/presentation-v3-${width}.webp`, sha256: `sha256:${'c'.repeat(64)}`, size: width * 8, mimeType: 'image/webp' as const })),
  thumbnail: null,
});
const photo = (index: number): Asset => ({
  id: `photo_${index}`, cartularyId: CARTULARY, binaryId: `bin_photo_${index}`, name: `Photographie ${index}`,
  url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', type: 'image', mimeType: 'image/jpeg', hash: `hash_${index}`,
  status: 'Archived', visibility: 'Secret', tags: [], fileSize: '3,2 Mo', privatePresentation: presentationOf(`bin_photo_${index}`),
});
const modal = (asset: Asset, extra: Partial<Parameters<typeof MediaViewerModal>[0]> = {}) => (
  <MediaViewerModal asset={asset} assetCount={2} position={0} audience="Secret" language="FR" mediaTags={[]} dialogRef={createRef()} onClose={() => undefined} onMove={() => undefined} onToggleTag={() => undefined} onDelete={() => undefined} {...extra} />
);

beforeEach(() => {
  expect(acquirePrivateMediaObjectUrl).toBe(resolveOriginal);
  expect(acquirePrivatePresentationObjectUrl).toBe(resolvePresentation);
  resolveOriginal.mockReset(); resolvePresentation.mockReset();
  resolvePresentation.mockImplementation(async ({ binaryId, role }: { binaryId: string; role: string }) => ({ url: `blob:${role}-${binaryId}`, release: vi.fn() }));
  resolveOriginal.mockImplementation(async (binaryId: string) => ({ url: `blob:original-${binaryId}`, release: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('visionneuse : original à la demande', () => {
  it('affiche la variante de scène avec le miroir de l’asset, puis l’original une seule fois après « Afficher l’original (taille) »', async () => {
    render(modal(photo(1)));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photographie 1' }).getAttribute('src')).toBe('blob:stage-bin_photo_1'));
    expect(resolvePresentation).toHaveBeenCalledWith({ binaryId: 'bin_photo_1', cartularyId: CARTULARY, asset: { privatePresentation: presentationOf('bin_photo_1') }, role: 'stage' });
    expect(resolveOriginal).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Afficher l’original (3,2 Mo)' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photographie 1' }).getAttribute('src')).toBe('blob:original-bin_photo_1'));
    expect(resolveOriginal).toHaveBeenCalledTimes(1);
    expect(resolveOriginal).toHaveBeenCalledWith('bin_photo_1', CARTULARY);
    expect(screen.queryByRole('button', { name: /Afficher l’original/ })).toBeNull();
    expect(screen.getByText('Original privé affiché.')).toBeTruthy();
  });

  it('la navigation vers une autre photo repart de sa variante : l’original n’est jamais transféré sans nouveau clic', async () => {
    const { rerender } = render(modal(photo(1)));
    fireEvent.click(await screen.findByRole('button', { name: /Afficher l’original/ }));
    await waitFor(() => expect(resolveOriginal).toHaveBeenCalledTimes(1));
    rerender(modal(photo(2)));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photographie 2' }).getAttribute('src')).toBe('blob:stage-bin_photo_2'));
    expect(resolveOriginal).toHaveBeenCalledTimes(1);
    expect(resolvePresentation).toHaveBeenLastCalledWith(expect.objectContaining({ binaryId: 'bin_photo_2', role: 'stage' }));
    expect(screen.getByRole('button', { name: /Afficher l’original/ })).toBeTruthy();
  });

  it('sans variante, « Aperçu en préparation » reste affiché et le bouton d’original est la seule voie vers l’original', async () => {
    const { MediaFailure } = await import('../../src/utils/mediaFailure.ts');
    resolvePresentation.mockRejectedValue(new MediaFailure('derivative-pending'));
    render(modal({ ...photo(3), privatePresentation: undefined, fileSize: undefined }));
    const pending = await screen.findByText('Aperçu en préparation');
    expect(pending.getAttribute('data-media-failure')).toBe('derivative-pending');
    expect(resolveOriginal).not.toHaveBeenCalled();
    expect(screen.queryByText(/Accès restreint/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Afficher l’original' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photographie 3' }).getAttribute('src')).toBe('blob:original-bin_photo_3'));
    expect(resolveOriginal).toHaveBeenCalledTimes(1);
  });

  it('aucun bouton d’original pour un média du bundle (sans binaire) ni quand l’original n’est pas offert', () => {
    render(modal({ ...photo(4), binaryId: undefined, privatePresentation: undefined, url: '/assets/demo-watches/rolex-submariner/main.jpg' }));
    expect(screen.queryByRole('button', { name: /Afficher l’original/ })).toBeNull();
    render(modal(photo(5), { originalOnDemand: false }));
    expect(screen.queryByRole('button', { name: /Afficher l’original/ })).toBeNull();
    expect(resolveOriginal).not.toHaveBeenCalled();
  });
});

describe('séquence 360° privée', () => {
  it('précharge et affiche les vues par leurs variantes de scène : aucun original transféré', async () => {
    class InstantImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) { if (value) window.setTimeout(() => this.onload?.(), 1); }
    }
    vi.stubGlobal('Image', InstantImage);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    const views = [1, 2, 3].map((index) => ({ ...photo(index), url: '' }));
    render(<Spin360 images={views} posterImageUrl="" language="FR" />);
    // Trois préchargements (concurrence bornée à 2) + la vue affichée : quatre acquisitions de variantes, toutes en « stage ».
    await waitFor(() => expect(resolvePresentation.mock.calls.filter(([request]) => request.role === 'stage').length).toBeGreaterThanOrEqual(4));
    await waitFor(() => expect(screen.getByAltText('Vue 1/3 · Photographie 1').getAttribute('src')).toBe('blob:stage-bin_photo_1'));
    for (const index of [1, 2, 3]) {
      expect(resolvePresentation).toHaveBeenCalledWith({ binaryId: `bin_photo_${index}`, cartularyId: CARTULARY, asset: views[index - 1], role: 'stage' });
    }
    expect(resolveOriginal).not.toHaveBeenCalled();
  });
});
