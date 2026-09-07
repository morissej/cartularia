import { describe, expect, it, vi } from 'vitest';
import { ObjectUrlLeaseCache } from '../../src/utils/objectUrlLeaseCache.ts';

describe('cache borné des Object URLs', () => {
  it('mutualise les chargements concurrents et libère une URL une seule fois', async () => {
    const revoke = vi.fn();
    const create = vi.fn().mockResolvedValue('blob:shared');
    const cache = new ObjectUrlLeaseCache(2, revoke);

    const [first, second] = await Promise.all([
      cache.acquire('media-1', create),
      cache.acquire('media-1', create),
    ]);
    expect(create).toHaveBeenCalledOnce();
    expect(cache.snapshot()).toEqual({ entries: 1, activeLeases: 2, idleEntries: 0 });

    first.release();
    first.release();
    second.release();
    expect(cache.snapshot()).toEqual({ entries: 1, activeLeases: 0, idleEntries: 1 });
    expect(revoke).not.toHaveBeenCalled();
  });

  it('évince en LRU les URL inactives au-delà du budget', async () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlLeaseCache(2, revoke);
    const first = await cache.acquire('media-1', async () => 'blob:1');
    first.release();
    const second = await cache.acquire('media-2', async () => 'blob:2');
    second.release();
    const third = await cache.acquire('media-3', async () => 'blob:3');
    third.release();

    expect(cache.snapshot()).toEqual({ entries: 2, activeLeases: 0, idleEntries: 2 });
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:1');
    expect(cache.releaseByUrl('blob:1')).toBe(false);
  });

  it('ne révoque jamais une URL encore affichée', async () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlLeaseCache(1, revoke);
    const visible = await cache.acquire('visible', async () => 'blob:visible');
    const other = await cache.acquire('other', async () => 'blob:other');

    expect(cache.snapshot().entries).toBe(2);
    expect(revoke).not.toHaveBeenCalled();
    other.release();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:other');
    visible.release();
  });

  it('évince une vidéo inactive qui dépasse le budget mémoire sans révoquer une image active', async () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlLeaseCache(8, revoke, 20);
    const visible = await cache.acquire('visible', async () => ({ url: 'blob:visible', byteSize: 10 }));
    const large = await cache.acquire('large', async () => ({ url: 'blob:large', byteSize: 30 }));
    expect(revoke).not.toHaveBeenCalled();
    large.release();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:large');
    expect(cache.snapshot().activeLeases).toBe(1);
    visible.release();
  });

  it('révoque aussi une réponse arrivée après destruction du cache', async () => {
    const revoke = vi.fn();
    let complete!: (url: string) => void;
    const cache = new ObjectUrlLeaseCache(8, revoke);
    const request = cache.acquire('late', () => new Promise<string>((resolve) => { complete = resolve; }));
    cache.clear(); complete('blob:late');
    await expect(request).rejects.toThrow('annulé');
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:late');
    expect(cache.snapshot().entries).toBe(0);
  });
});
