import { MAX_HANDOFF_FRAGMENT } from './codeHandoffProtocol';

/** Imported first by both entrypoints: remove capabilities before rendering or logging. */
export function captureHandoffFragment(location: Pick<Location, 'pathname' | 'search' | 'hash'>, history: Pick<History, 'replaceState' | 'state'>) {
  const isReturn = location.pathname.replace(/\/$/, '') === '/code-handoff-return';
  const isRequest = ['/personal-vault', '/personal-vault.html', '/'].includes(location.pathname) && location.hash.startsWith('#codeHandoff=');
  if (!isReturn && !isRequest) return { request: null, response: null };
  const fragment = location.hash.slice(1);
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  const valid = fragment.length > 0 && fragment.length <= (isReturn ? MAX_HANDOFF_FRAGMENT : 4096);
  return { request: isRequest && valid ? fragment : null, response: isReturn && valid ? fragment : null };
}
export const capturedHandoff = typeof window === 'undefined' ? { request: null, response: null } : captureHandoffFragment(window.location, window.history);
