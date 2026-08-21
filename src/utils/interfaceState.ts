export const CARTULARY_PAGE_IDS = ['cover', 'media', 'reference', 'condition', 'value', 'publication'] as const;
export type CartularyPage = (typeof CARTULARY_PAGE_IDS)[number];
export type InterfaceLanguage = 'FR' | 'EN';
export type ApplicationRoute = 'home' | 'account-create' | 'account-sign-in' | 'cartulary' | 'watch-website' | 'collection-website' | 'cartulary-view' | 'community' | 'registry' | 'invitation' | 'not-found';

export const INTERFACE_LANGUAGE_STORAGE_KEY = 'cartularia-interface-language';

export const normalizeInterfaceLanguage = (value: unknown): InterfaceLanguage => value === 'EN' ? 'EN' : 'FR';

export const cartularyPageFromHash = (hash: string): CartularyPage => {
  const candidate = hash.replace(/^#/, '');
  return CARTULARY_PAGE_IDS.includes(candidate as CartularyPage) ? candidate as CartularyPage : 'cover';
};

export const adjacentCartularyPage = (
  page: CartularyPage,
  direction: 'previous' | 'next',
): CartularyPage | null => {
  const offset = direction === 'previous' ? -1 : 1;
  return CARTULARY_PAGE_IDS[CARTULARY_PAGE_IDS.indexOf(page) + offset] ?? null;
};

export const applicationRouteFromPathname = (pathname: string): ApplicationRoute => {
  const normalized = pathname === '/' ? '' : pathname.replace(/\/$/, '');
  if (normalized === '') return 'home';
  if (normalized === '/account/create') return 'account-create';
  if (normalized === '/account/sign-in') return 'account-sign-in';
  if (normalized === '/cartulary') return 'cartulary';
  if (normalized === '/watch-website') return 'watch-website';
  if (normalized === '/collection-website') return 'collection-website';
  if (normalized === '/cartulary-view') return 'cartulary-view';
  if (normalized === '/community') return 'community';
  if (normalized === '/registry' || normalized.startsWith('/registry/')) return 'registry';
  if (normalized === '/invitation/accept') return 'invitation';
  return 'not-found';
};
