import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportPrintImage } from '../../src/components/ReportMediaItem';
import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import { inspectReportMedia, useReportPreparation } from '../../src/hooks/useReportPreparation';
import type { Asset } from '../../src/types';

/**
 * Tour 5, point 4 : les blocs publiés `cover-watch`, `media-hero` et `condition-documentation` sont imprimés par
 * `renderWatchWebsiteBlock(blockId, forPrint)` ; leur image suit le même ternaire que la bibliothèque —
 * `forPrint ? <ReportPrintImage …/> : <PrivateMediaImage … role=…/>` (motif verrouillé par le contrat « V3 tour 5 »).
 * Ce test rejoue ce motif à l'identique sur les trois blocs : en lecture (forPrint = false), une photo sans variante
 * reste « Aperçu en préparation » sans jamais demander l'original ; sous la préparation explicite du rapport, l'original
 * remplace les copies absentes (pending ET failed) et le rapport devient imprimable (`inspectReportMedia` → 'ready').
 * Le service réel `privateMedia.ts` tourne sur des doublures Firebase.
 */
const api = vi.hoisted(() => ({ blob: vi.fn(), downloadUrl: vi.fn(), getDoc: vi.fn(), fetch: vi.fn() }));
const UID = 'owner_print_blocks_v3';
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {}, auth: { authStateReady: async () => undefined, currentUser: { uid: 'owner_print_blocks_v3' } } }));
vi.mock('../../src/persistence/localVault.ts', () => ({ cartulariaLocalVault: null }));
vi.mock('firebase/storage', () => ({ getBlob: api.blob, getDownloadURL: api.downloadUrl, ref: (_storage: unknown, path: string) => path }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: api.getDoc }));

const CARTULARY = 'cart_print_blocks_v3';
type Kind = 'ready' | 'pending' | 'failed';
const digestOf = (text: string) => `sha256:${createHash('sha256').update(Buffer.from(text)).digest('hex')}`;
const blobOf = (text: string, type = 'image/webp') => new NodeBlob([Buffer.from(text)], { type }) as unknown as Blob;
const variantPath = (binaryId: string) => `private-derivatives/${UID}/${CARTULARY}/${binaryId}/presentation-v3-768.webp`;
const originalPath = (binaryId: string) => `private-drafts/${UID}/${CARTULARY}/${binaryId}/${'a'.repeat(64)}/original`;
const photo = (name: string, kind: Kind, tags: string[]): Asset => ({
  id: `photo_${name}`, cartularyId: CARTULARY, binaryId: `bin_${kind}_${name}`, name,
  url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', type: 'image', mimeType: 'image/jpeg', hash: `hash_${name}`,
  status: 'Archived', visibility: 'Secret', tags,
});
const manifestOf = (binaryId: string) => ({
  deleted: false, fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 10, sha256: '', storagePath: originalPath(binaryId), clientUpdatedAt: 1,
  uploadStatus: 'ready', verificationStatus: 'accepted',
  presentationDerivative: binaryId.startsWith('bin_ready')
    ? { variantsVersion: 'presentation-v3', variants: [{ width: 768, height: 512, storagePath: variantPath(binaryId), sha256: digestOf(`v768-${binaryId}`), size: 12, mimeType: 'image/webp' }], thumbnail: null, variantsFailure: null }
    : binaryId.startsWith('bin_failed') ? { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'invalid_dimensions' } : null,
});
/** Originaux demandés (chemins distincts, triés) : couverture et hero partagent un binaire, chaque image le demande pour elle-même. */
const originalUrls = () => [...new Set(api.downloadUrl.mock.calls.map(([path]) => String(path)))].sort();
const variantUrl = (binaryId: string) => `blob:image/webp:${Buffer.byteLength(`v768-${binaryId}`)}`;
const originalUrl = (binaryId: string) => `blob:image/jpeg:${Buffer.byteLength(`original-${binaryId}`)}`;

/** Les trois blocs, au motif exact d'App.tsx (`renderWatchWebsiteBlock`) : ternaire forPrint sur chaque image. */
function PublishedBlocks({ mainPhoto, documentationAssets, forPrint }: { mainPhoto: Asset; documentationAssets: Asset[]; forPrint: boolean }) {
  const language = 'FR' as const;
  return <>
    <section className="cover-sheet">
      <div className="cover-sheet__photo">
        {forPrint
          ? <ReportPrintImage asset={mainPhoto} alt="Couverture" sizes="(max-width: 720px) 100vw, 55vw" language={language} />
          : <PrivateMediaImage asset={mainPhoto} alt="Couverture" sizes="(max-width: 720px) 100vw, 55vw" eager role="stage" />}
      </div>
    </section>
    <section className="watch-website__hero">
      {forPrint
        ? <ReportPrintImage asset={mainPhoto} alt="Hero" sizes="(max-width: 720px) 100vw, 50vw" language={language} />
        : <PrivateMediaImage asset={mainPhoto} alt="Hero" sizes="(max-width: 720px) 100vw, 50vw" eager role="stage" />}
    </section>
    <section>
      <div className="documentation-media__grid watch-website__document-media">
        {documentationAssets.map((asset) => (
          <a key={asset.id} href={asset.url} download={asset.name}>
            <span className="documentation-media__preview">{forPrint
              ? <ReportPrintImage asset={asset} alt={asset.name} sizes="(max-width: 720px) 50vw, 25vw" language={language} />
              : <PrivateMediaImage asset={asset} alt={asset.name} sizes="(max-width: 720px) 50vw, 25vw" role="thumbnail" />}</span>
          </a>
        ))}
      </div>
    </section>
  </>;
}

function Report({ mainPhoto, documentationAssets }: { mainPhoto: Asset; documentationAssets: Asset[] }) {
  const report = useReportPreparation('print-blocks');
  return <><button onClick={report.prepare}>Préparer</button><p role="status">{report.phase}</p>
    <div className="reading-view"><PublishedBlocks mainPhoto={mainPhoto} documentationAssets={documentationAssets} forPrint={false} /></div>
    {report.active && <div className="report-print-view"><PublishedBlocks mainPhoto={mainPhoto} documentationAssets={documentationAssets} forPrint /></div>}</>;
}

beforeEach(() => {
  api.blob.mockReset(); api.downloadUrl.mockReset(); api.getDoc.mockReset(); api.fetch.mockReset();
  api.getDoc.mockImplementation(async (path: string) => {
    const binaryId = /\/binaries\/([^/]+)$/.exec(path)?.[1];
    return binaryId ? { exists: () => true, data: () => manifestOf(binaryId) } : { exists: () => false, data: () => undefined };
  });
  api.blob.mockImplementation(async (path: string) => {
    const binaryId = /private-derivatives\/[^/]+\/[^/]+\/([^/]+)\//.exec(path)?.[1];
    if (!binaryId?.startsWith('bin_ready')) throw Object.assign(new Error('not found'), { code: 'storage/object-not-found' });
    return blobOf(`v768-${binaryId}`);
  });
  api.downloadUrl.mockImplementation(async (path: string) => `https://storage.test/${path}`);
  api.fetch.mockImplementation(async (url: string) => ({ ok: true, blob: async () => blobOf(`original-${url.split('/').at(-3)}`, 'image/jpeg') }));
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', api.fetch);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob: Blob) => `blob:${blob.type}:${blob.size}` });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  vi.stubGlobal('IntersectionObserver', class { observe() { return undefined; } disconnect() { return undefined; } unobserve() { return undefined; } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('couverture, hero et documentation imprimés : original à la préparation seulement', () => {
  it('en lecture (forPrint = false), une couverture sans variante reste « en préparation » et l’original n’est jamais demandé', async () => {
    const cover = photo('cover', 'pending', ['slideshow']);
    const { container } = render(<Report mainPhoto={cover} documentationAssets={[photo('papers', 'failed', ['documentation'])]} />);
    expect(container.querySelector('.report-print-view')).toBeNull();
    const reading = container.querySelector('.reading-view')!;
    await waitFor(() => expect(reading.querySelectorAll('.cover-sheet__photo [data-media-state="pending"], .watch-website__hero [data-media-state="pending"]')).toHaveLength(2));
    expect(reading.querySelector('.cover-sheet__photo .media-load-error')).not.toBeNull();
    expect(api.downloadUrl).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(api.blob).not.toHaveBeenCalled();
  });

  it('à la préparation, la couverture et le hero sans variante chargent l’original ; la documentation mêle variante (prête) et originaux (pending, failed) ; le rapport devient imprimable', async () => {
    const cover = photo('cover', 'pending', ['slideshow']);
    const documentation = [photo('warranty', 'ready', ['documentation']), photo('box', 'pending', ['documentation']), photo('invoice', 'failed', ['documentation'])];
    const { container } = render(<Report mainPhoto={cover} documentationAssets={documentation} />);
    fireEvent.click(screen.getByRole('button', { name: 'Préparer' }));
    const root = container.querySelector('.report-print-view')!;
    await waitFor(() => expect(originalUrls()).toEqual([originalPath('bin_failed_invoice'), originalPath('bin_pending_box'), originalPath('bin_pending_cover')]));
    await waitFor(() => expect([...root.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
      originalUrl('bin_pending_cover'), // couverture
      originalUrl('bin_pending_cover'), // hero (même binaire : l'original est demandé une fois par binaire et par image)
      variantUrl('bin_ready_warranty'),
      originalUrl('bin_pending_box'),
      originalUrl('bin_failed_invoice'),
    ]));
    expect(api.blob.mock.calls.map(([path]) => String(path))).toEqual([variantPath('bin_ready_warranty')], 'la photo prête n’a demandé que sa variante');
    expect(root.querySelector('.media-load-error')).toBeNull();
    expect(root.querySelector('[data-media-state="pending"], [data-media-state="unavailable"], [data-media-state="error"]')).toBeNull();
    expect(root.querySelector('.cover-sheet__photo img')).not.toBeNull();
    expect(root.querySelector('.watch-website__hero img')).not.toBeNull();
    expect(root.querySelectorAll('.documentation-media__preview img')).toHaveLength(3);
    for (const image of root.querySelectorAll('img')) {
      Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 400 } });
      fireEvent.load(image);
    }
    await waitFor(() => expect(inspectReportMedia(root)).toBe('ready'));
    // La page de lecture montée à côté n'a rien demandé de plus : ses états restent « en préparation » / « non produite ».
    const reading = container.querySelector('.reading-view')!;
    expect(reading.querySelectorAll('[data-media-state="pending"]').length).toBeGreaterThan(0);
    expect(originalUrls()).toHaveLength(3);
    expect(api.downloadUrl.mock.calls.length).toBeLessThanOrEqual(4, 'jamais plus d’une demande par image imprimée');
  });
});
