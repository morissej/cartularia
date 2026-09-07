import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectReportMedia, useReportPreparation } from '../../src/hooks/useReportPreparation';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
describe('préparation impression', () => {
  it('distingue un chargement, une image cassée et un rapport prêt', () => {
    const root = document.createElement('div');
    expect(inspectReportMedia(null)).toBe('loading');
    expect(inspectReportMedia(root)).toBe('ready');
    const image = document.createElement('img'); root.append(image);
    image.dataset.mediaState = 'loading'; expect(inspectReportMedia(root)).toBe('loading');
    image.dataset.mediaState = 'ready'; image.src = '/test.png';
    Object.defineProperty(image, 'complete', { value: true });
    expect(inspectReportMedia(root)).toBe('error');
    Object.defineProperty(image, 'naturalWidth', { value: 300 });
    expect(inspectReportMedia(root)).toBe('ready');
    root.innerHTML = '<span data-media-state="error">Réessayer</span>';
    expect(inspectReportMedia(root)).toBe('error');
  });
  it('ne lance jamais print automatiquement, attend et invalide la préparation quand le contenu change', () => {
    vi.useFakeTimers(); const print = vi.spyOn(window, 'print');
    document.body.innerHTML = '<div class="report-print-view"><span data-media-state="loading"></span></div>';
    const { result, rerender } = renderHook(({ content }) => useReportPreparation(content), { initialProps: { content: 'revision1' } });
    act(() => result.current.prepare());
    act(() => vi.advanceTimersByTime(500)); expect(result.current.phase).toBe('loading');
    document.querySelector('span')!.remove();
    act(() => vi.advanceTimersByTime(100)); expect(result.current.phase).toBe('ready');
    expect(print).not.toHaveBeenCalled();
    rerender({ content: 'revision2' }); expect(result.current.phase).toBe('idle');
    expect(result.current.active).toBe(false); print.mockRestore();
  });
  it('échoue explicitement après30s, puis permet une nouvelle tentative', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="report-print-view"><span data-media-state="loading"></span></div>';
    const { result } = renderHook(() => useReportPreparation('revision1'));
    act(() => result.current.prepare()); act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.phase).toBe('error');
    document.querySelector('span')!.remove();
    act(() => result.current.prepare()); act(() => vi.advanceTimersByTime(100));
    expect(result.current.phase).toBe('ready'); expect(result.current.attempt).toBe(2);
  });
});
