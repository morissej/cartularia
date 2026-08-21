export const personalVaultHref = (mode: 'create' | 'sign-in') => {
  const configured = import.meta.env.VITE_PERSONAL_VAULT_URL?.trim();
  const base = configured || '/personal-vault.html';
  const url = new URL(base, window.location.origin);
  url.searchParams.set('mode', mode);
  return configured ? url.toString() : `${url.pathname}${url.search}`;
};

