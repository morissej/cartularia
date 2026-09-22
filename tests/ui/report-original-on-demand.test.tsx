import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Blob as NodeBlob } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportMediaItem, ReportPrintImage } from '../../src/components/ReportMediaItem';
import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import { inspectReportMedia, useReportPreparation } from '../../src/hooks/useReportPreparation';
import type { Asset } from '../../src/types';

/**
 * Impression du rapport (tour 4, point 3, compatible K4) : la préparation est une action explicite ; une image sans
 * copie de présentation (variantes en attente ou définitivement non produites) charge son ORIGINAL pendant cette
 * préparation seulement — jamais avant prepare(), jamais hors du rapport — et le rapport reste imprimable.
 * Le service réel `privateMedia.ts` tourne sur des doublures Firebase (plusieurs images montées en même temps).
 */
const api = vi.hoisted(() => ({ blob: vi.fn(), downloadUrl: vi.fn(), getDoc: vi.fn(), fetch: vi.fn() }));
const UID = 'owner_report_v3';
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {}, auth: { authStateReady: async () => undefined, currentUser: { uid: 'owner_report_v3' } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, observer: (user: unknown) => void) => { observer((_auth as { currentUser: unknown }).currentUser); return () => {}; } }));
vi.mock('../../src/persistence/localVault.ts', () => ({ cartulariaLocalVault: null }));
vi.mock('firebase/storage', () => ({ getBlob: api.blob, getDownloadURL: api.downloadUrl, ref: (_storage: unknown, path: string) => path }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: api.getDoc }));

const CARTULARY = 'cart_report_original_v3';
type Kind = 'ready' | 'pending' | 'failed';
const digestOf = (text: string) => `sha256:${createHash('sha256').update(Buffer.from(text)).digest('hex')}`;
const blobOf = (text: string, type = 'image/webp') => new NodeBlob([Buffer.from(text)], { type }) as unknown as Blob;
const binaryOf = (kind: Kind, index: number) => `bin_${kind}_${index}`;
const variantPath = (binaryId: string) => `private-derivatives/${UID}/${CARTULARY}/${binaryId}/presentation-v3-768.webp`;
const originalPath = (binaryId: string) => `private-drafts/${UID}/${CARTULARY}/${binaryId}/${'a'.repeat(64)}/original`;
const photo = (index: number, kind: Kind): Asset => ({
  id: `photo_${kind}_${index}`, cartularyId: CARTULARY, binaryId: binaryOf(kind, index), name: `Photographie ${kind} ${index}`,
  url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', type: 'image', mimeType: 'image/jpeg', hash: `hash_${index}`,
  status: 'Archived', visibility: 'Secret', tags: ['slideshow'],
});
/** Manifeste du binaire (propriétaire) : variantes seulement pour « ready » ; « failed » consigne un échec définitif. */
const manifestOf = (binaryId: string) => ({
  deleted: false, fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 10, sha256: '', storagePath: originalPath(binaryId), clientUpdatedAt: 1,
  uploadStatus: 'ready', verificationStatus: 'accepted',
  presentationDerivative: binaryId.startsWith('bin_ready')
    ? { variantsVersion: 'presentation-v3', variants: [{ width: 768, height: 512, storagePath: variantPath(binaryId), sha256: digestOf(`v768-${binaryId}`), size: 12, mimeType: 'image/webp' }], thumbnail: null, variantsFailure: null }
    : binaryId.startsWith('bin_failed') ? { variantsVersion: null, variants: [], thumbnail: null, variantsFailure: 'invalid_dimensions' } : null,
});
const originalUrls = () => api.downloadUrl.mock.calls.map(([path]) => String(path));
/** Object URL rendu par la doublure : `blob:<type>:<taille>` (variante 768 : WebP ; original : JPEG). */
const variantUrl = (binaryId: string) => `blob:image/webp:${Buffer.byteLength(`v768-${binaryId}`)}`;
const originalUrl = (binaryId: string) => `blob:image/jpeg:${Buffer.byteLength(`original-${binaryId}`)}`;

function Report({ assets }: { assets: Asset[] }) {
  const report = useReportPreparation('original-on-demand');
  return <><button onClick={report.prepare}>Préparer</button><p role="status">{report.phase}</p>
    {report.active && <div className="report-print-view">{assets.map((asset) => <ReportMediaItem asset={asset} key={asset.id} />)}</div>}</>;
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
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('rapport : original à la préparation seulement', () => {
  it('aucun chargement avant prepare() ; à la préparation, la variante sert la photo prête et l’original remplace les copies absentes', async () => {
    const assets = [photo(1, 'ready'), photo(2, 'pending'), photo(3, 'failed')];
    const { container } = render(<Report assets={assets} />);
    expect(container.querySelector('.report-print-view')).toBeNull();
    expect(api.getDoc).not.toHaveBeenCalled();
    expect(api.blob).not.toHaveBeenCalled();
    expect(api.downloadUrl).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Préparer' }));
    const root = container.querySelector('.report-print-view')!;
    await waitFor(() => expect(originalUrls().sort()).toEqual([originalPath('bin_failed_3'), originalPath('bin_pending_2')]));
    await waitFor(() => expect([...root.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([variantUrl('bin_ready_1'), originalUrl('bin_pending_2'), originalUrl('bin_failed_3')]));
    expect(api.blob.mock.calls.map(([path]) => String(path))).toEqual([variantPath('bin_ready_1')], 'la photo prête n’a demandé que sa variante de scène, jamais son original');
    expect(root.querySelector('.media-load-error')).toBeNull();
    expect(root.querySelector('[data-media-state="pending"], [data-media-state="unavailable"], [data-media-state="error"]')).toBeNull();
    // Le rapport devient imprimable une fois les images décodées.
    for (const image of root.querySelectorAll('img')) {
      Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 400 } });
      fireEvent.load(image);
    }
    await waitFor(() => expect(inspectReportMedia(root)).toBe('ready'));
    expect(originalUrls()).toHaveLength(2);
  });

  it('phase du rapport : « ready » avec une photo sans variante ; « error » honnête quand même l’original manque', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<Report assets={[photo(4, 'pending')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Préparer' }));
    const root = container.querySelector('.report-print-view')!;
    await waitFor(() => expect(root.querySelector('img')!.getAttribute('src')).toBe(originalUrl('bin_pending_4')));
    const image = root.querySelector('img')!;
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 400 } });
    fireEvent.load(image);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('status').textContent).toBe('ready');
    vi.useRealTimers();

    api.fetch.mockImplementation(async () => ({ ok: false, status: 404 }));
    const failing = render(<Report assets={[photo(5, 'failed')]} />);
    fireEvent.click(failing.getAllByRole('button', { name: 'Préparer' }).at(-1)!);
    const failingRoot = failing.container.querySelector('.report-print-view')!;
    await waitFor(() => expect(failingRoot.querySelector('[data-media-state="error"]')).not.toBeNull());
    expect(inspectReportMedia(failingRoot)).toBe('error');
  });

  it('ReportPrintImage revient à la scène quand l’actif change ; PrivateMediaImage seul ne charge jamais l’original', async () => {
    const { rerender } = render(<ReportPrintImage asset={photo(6, 'pending')} alt="Six" />);
    await waitFor(() => expect(originalUrls()).toEqual([originalPath('bin_pending_6')]));
    rerender(<ReportPrintImage asset={photo(7, 'ready')} alt="Sept" />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Sept' }).getAttribute('src')).toBe(variantUrl('bin_ready_7')));
    expect(originalUrls()).toEqual([originalPath('bin_pending_6')]);

    render(<PrivateMediaImage asset={photo(8, 'pending')} alt="Huit" eager />);
    const status = await screen.findByRole('status');
    expect(status.getAttribute('data-media-state')).toBe('pending');
    render(<PrivateMediaImage asset={photo(9, 'failed')} alt="Neuf" eager />);
    await waitFor(() => expect(screen.getAllByRole('status').some((node) => node.getAttribute('data-media-state') === 'unavailable')).toBe(true));
    expect(originalUrls()).toEqual([originalPath('bin_pending_6')]);
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});
