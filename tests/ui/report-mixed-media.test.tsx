import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportMediaItem } from '../../src/components/ReportMediaItem';
import { inspectReportMedia, useReportPreparation } from '../../src/hooks/useReportPreparation';
import type { Asset } from '../../src/types';

const assets: Asset[] = [
  { id: 'photo', name: 'Photographie', type: 'image', url: '/assets/test.jpg', tags: ['slideshow'], status: 'Archived', visibility: 'Secret', hash: 'sha256:fixture' },
  { id: 'video', name: 'Mouvement.mp4', type: 'video', url: '', binaryId: 'video-binary', tags: ['slideshow'], status: 'Archived', visibility: 'Secret', hash: 'sha256:fixture' },
  { id: 'pdf', name: 'Contrôle.pdf', type: 'document', url: '', binaryId: 'pdf-binary', tags: ['slideshow'], status: 'Archived', visibility: 'Secret', hash: 'sha256:fixture' },
];
function Report() {
  const report = useReportPreparation('mixed-fixture');
  return <><button onClick={report.prepare}>Préparer</button><p role="status">{report.phase}</p>
    {report.active && <div className="report-print-view">{assets.map((asset) => <ReportMediaItem asset={asset} key={asset.id} />)}</div>}</>;
}
afterEach(() => vi.useRealTimers());
describe('rapport contenant photos, vidéos et PDF sans poster', () => {
  it('attend uniquement la photo, indexe les deux pièces et devient prêt sans charger leur binaire', () => {
    vi.useFakeTimers();
    const { container } = render(<Report />);
    fireEvent.click(screen.getByRole('button', { name: 'Préparer' }));
    const root = container.querySelector('.report-print-view')!;
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelectorAll('video,iframe,object')).toHaveLength(0);
    expect(screen.getByText('Mouvement.mp4')).not.toBeNull();
    expect(screen.getByText('Contrôle.pdf')).not.toBeNull();
    expect(screen.getByText(/Vidéo jointe/)).not.toBeNull();
    expect(screen.getByText(/Document joint/)).not.toBeNull();
    expect(inspectReportMedia(root)).toBe('loading');
    const image = root.querySelector('img')!;
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 400 } });
    fireEvent.load(image);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole('status').textContent).toBe('ready');
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('status').textContent).toBe('ready');
  });
  it('une photo cassée reste une erreur et ne donne pas un faux rapport complet', () => {
    vi.useFakeTimers();
    const { container } = render(<Report />);
    fireEvent.click(screen.getByRole('button', { name: 'Préparer' }));
    fireEvent.error(container.querySelector('.report-print-view img')!);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByText('error')).not.toBeNull();
    expect(inspectReportMedia(container.querySelector('.report-print-view'))).toBe('error');
    expect(screen.queryByText('ready')).toBeNull();
  });
});
