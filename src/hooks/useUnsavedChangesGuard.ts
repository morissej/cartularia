import { useCallback, useEffect, useRef } from 'react';

export function confirmUnsavedNavigation() {
  return window.dispatchEvent(new Event('cartularia:before-navigation', { cancelable: true }));
}

/** Guard native exits as well as the app's delegated links. Nothing private is cached. */
export function useUnsavedChangesGuard(dirty: boolean, options: { busy?: boolean; onDiscard?: () => void; message?: string } = {}) {
  const latest = useRef({ dirty, ...options });
  latest.current = { dirty, ...options };
  const released = useRef(false);
  const confirmDiscard = useCallback(() => {
    if (released.current || !latest.current.dirty) return true;
    if (latest.current.busy) { window.alert('Une opération est en cours. Attendez son résultat avant de quitter.'); return false; }
    if (!window.confirm(latest.current.message || 'Quitter sans enregistrer vos modifications ? Votre saisie sera perdue.')) return false;
    latest.current.onDiscard?.();
    latest.current.dirty = false;
    return true;
  }, []);
  useEffect(() => {
    let acceptedUrl = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (released.current || !latest.current.dirty) return;
      event.preventDefault(); event.returnValue = '';
    };
    const appNavigation = (event: Event) => { if (!event.defaultPrevented && !confirmDiscard()) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.href === window.location.href) return;
      if (!confirmDiscard()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const historyChange = (event: Event) => {
      if (window.location.href === acceptedUrl) return;
      if (!confirmDiscard()) {
        window.history.pushState(window.history.state, '', acceptedUrl);
        event.stopImmediatePropagation();
      } else acceptedUrl = window.location.href;
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('cartularia:before-navigation', appNavigation);
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', historyChange, true);
    window.addEventListener('hashchange', historyChange, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('cartularia:before-navigation', appNavigation);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', historyChange, true);
      window.removeEventListener('hashchange', historyChange, true);
    };
  }, [confirmDiscard]);
  return { confirmDiscard, release: () => { released.current = true; }, resetRelease: () => { released.current = false; } };
}
