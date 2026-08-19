export interface BoundedPreloadQueueOptions<T> {
  items: readonly T[];
  concurrency: number;
  load: (item: T, index: number, signal?: AbortSignal) => Promise<void>;
  onSettled?: (item: T, index: number) => void;
  signal?: AbortSignal;
}

export const alternatingFrameOrder = (total: number): number[] => {
  if (total <= 0) return [];
  const order = [0];
  for (let offset = 1; offset <= Math.floor(total / 2); offset += 1) {
    if (offset < total) order.push(offset);
    const mirrored = total - offset;
    if (mirrored > 0 && mirrored !== offset) order.push(mirrored);
  }
  return order;
};

export const runBoundedPreloadQueue = async <T>({
  items,
  concurrency,
  load,
  onSettled,
  signal,
}: BoundedPreloadQueueOptions<T>): Promise<void> => {
  if (items.length === 0 || signal?.aborted) return;
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
  let cursor = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      try {
        await load(item, index, signal);
      } finally {
        if (!signal?.aborted) onSettled?.(item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
};
