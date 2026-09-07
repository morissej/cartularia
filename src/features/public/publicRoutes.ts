export const personalVaultHref = (mode: 'create' | 'sign-in' | 'recover') => {
  const configured = import.meta.env.VITE_PERSONAL_VAULT_URL?.trim();
  const base = configured || '/personal-vault';
  const url = new URL(base, window.location.origin);
  url.searchParams.set('mode', mode);
  return configured ? url.toString() : `${url.pathname}${url.search}`;
};

export const safeAccountReturnPath = (value: string | null) => {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')
    || Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return '/registry';
  try {
    const target = new URL(value, window.location.origin);
    return target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : '/registry';
  } catch { return '/registry'; }
};
