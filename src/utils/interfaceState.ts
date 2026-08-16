import type { VisibilityLevel } from '../types';

export const CARTULARY_PAGE_IDS = ['cover', 'media', 'reference', 'condition', 'value'] as const;
export type CartularyPage = (typeof CARTULARY_PAGE_IDS)[number];
export type InterfaceLanguage = 'FR' | 'EN';
export type ApplicationRoute = 'cartulary' | 'watch-website' | 'cartulary-view' | 'community' | 'registry' | 'not-found';

export const INTERFACE_LANGUAGE_STORAGE_KEY = 'cartularia-interface-language';
export const AUDIENCE_STORAGE_KEY = 'cartularia-audience';

export const normalizeInterfaceLanguage = (value: unknown): InterfaceLanguage => value === 'EN' ? 'EN' : 'FR';

export const normalizeAudience = (value: unknown): VisibilityLevel => (
  value === 'Communauté' || value === 'Tous' ? value : 'Secret'
);

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
  if (normalized === '') return 'cartulary';
  if (normalized === '/watch-website') return 'watch-website';
  if (normalized === '/cartulary-view') return 'cartulary-view';
  if (normalized === '/community') return 'community';
  if (normalized === '/registry' || normalized.startsWith('/registry/')) return 'registry';
  return 'not-found';
};
