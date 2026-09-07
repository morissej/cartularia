import { useEffect, useState } from 'react';

export function inspectReportMedia(root: Element | null): 'loading' | 'error' | 'ready' {
  if (!root) return 'loading';
  if (root.querySelector('[data-media-state="error"], .media-load-error')) return 'error';
  if (root.querySelector('[data-media-state="loading"]')) return 'loading';
  const images = [...root.querySelectorAll('img')];
  if (images.some((image) => !image.getAttribute('src') || !image.complete)) return 'loading';
  if (images.some((image) => image.naturalWidth === 0)) return 'error';
  return 'ready';
}

// The second, explicit click preserves the browser's print user gesture. A
// timeout never silently turns a partially loaded report into a valid export.
export function useReportPreparation(contentKey: string) {
  const [attempt, setAttempt] = useState(0);
  const [preparedKey, setPreparedKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const active = preparedKey === contentKey;
  useEffect(() => {
    if (!active || !attempt) return;
    setPhase('loading');
    const started = Date.now();
    const timer = window.setInterval(() => {
      const result = inspectReportMedia(document.querySelector('.report-print-view'));
      if (result === 'ready' || result === 'error' || Date.now() - started >= 30_000) {
        setPhase(result === 'ready' ? 'ready' : 'error');
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [active, contentKey, attempt]);
  return { active, attempt, phase: active ? phase : 'idle', prepare: () => { setPreparedKey(contentKey); setPhase('loading'); setAttempt((value) => value + 1); } };
}
