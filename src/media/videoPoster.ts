/** Decode an original already held locally. A remote URL never starts a transfer here. */
export function createLocalVideoPoster(url: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!url.startsWith('blob:') || signal?.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let finished = false;
    const finish = (poster?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      resolve(poster);
    };
    const abort = () => finish();
    const capture = () => {
      if (finished || !video.videoWidth || !video.videoHeight) return;
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 768 / video.videoWidth, 768 / video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return finish();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.8));
      } catch { finish(); }
    };
    const timeout = window.setTimeout(abort, 8000);
    signal?.addEventListener('abort', abort, { once: true });
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0.1) video.currentTime = Math.min(0.5, video.duration / 2);
    };
    video.onloadeddata = () => { if (!video.seeking) capture(); };
    video.onseeked = capture;
    video.onerror = abort;
    video.src = url;
    video.load();
  });
}
