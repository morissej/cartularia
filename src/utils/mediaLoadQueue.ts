/** One queue shared by visible previews and explicit downloads. */
export function createMediaLoadQueue(concurrency = 2) {
  let active = 0;
  const pending: Array<() => void> = [];
  return <T>(task: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      void Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        pending.shift()?.();
      });
    };
    if (active < concurrency) run(); else pending.push(run);
  });
}
