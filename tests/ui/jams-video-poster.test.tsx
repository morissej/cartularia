import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVideoPoster } from '../../src/hooks/useVideoPoster.ts';
afterEach(() => vi.restoreAllMocks());
describe('Jam 15 : vignette vidéo locale', () => {
  it('ne lit jamais un original distant pour fabriquer une vignette', () => {
    const create = vi.spyOn(document, 'createElement');
    const view = renderHook(() => useVideoPoster({ url: 'https://private.example/video.mov' }));
    expect(view.result.current).toBeUndefined();
    expect(create.mock.calls.some(([tag]) => tag === 'video')).toBe(false);
  });
  it('utilise une vignette fournie et évite de décoder le binaire local', () => {
    const create = vi.spyOn(document, 'createElement');
    const view = renderHook(() => useVideoPoster({ url: 'blob:local', posterUrl: '/poster.jpg' }));
    expect(view.result.current).toBe('/poster.jpg');
    expect(create.mock.calls.some(([tag]) => tag === 'video')).toBe(false);
  });
  it('extrait une image locale, libère le lecteur et ne réutilise pas le résultat pour une autre source', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const originalCreate = document.createElement.bind(document);
    let video: HTMLVideoElement | undefined;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'video') video = element as HTMLVideoElement;
      return element;
    }) as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,poster');
    const view = renderHook(({ url }) => useVideoPoster({ url }), { initialProps: { url: 'blob:one' } });
    Object.defineProperties(video!, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    await act(async () => video!.dispatchEvent(new Event('seeked')));
    expect(view.result.current).toBe('data:image/jpeg;base64,poster');
    expect(video!.getAttribute('src')).toBeNull();
    view.rerender({ url: 'https://private.example/two.mov' });
    expect(view.result.current).toBeUndefined();
  });
});
