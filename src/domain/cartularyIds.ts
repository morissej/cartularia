import { DEMO_SUBMARINER_CARTULARY_ID, isDemoCartularyId } from '../data/demoCartularies.ts';

export const IWC_CARTULARY_ID = 'cart_iwc_flieger_utc_2002';
export const ROLEX_CARTULARY_ID = 'cart_rolex_gmt_master_mark_i_long_e_1675_642cf3adba60';

const SAFE_CARTULARY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,159}$/;

export const cartularyIdFromLocation = (location: Pick<Location, 'pathname' | 'search'> | null | undefined) => {
  if (!location) return IWC_CARTULARY_ID;
  const normalizedPath = location.pathname.replace(/\/$/, '');
  const parameters = new URLSearchParams(location.search);
  const isWatchWebsite = normalizedPath === '/watch-website';
  const isLocalPublicationPreview = isWatchWebsite && parameters.get('preview') === 'local';
  const isDemoRoute = normalizedPath === '/cartulary-demo';
  const supportsCartularySelection = normalizedPath === '/cartulary'
    || normalizedPath === '/cartulary-view'
    || isDemoRoute
    || isWatchWebsite
    || isLocalPublicationPreview;
  if (!supportsCartularySelection) return IWC_CARTULARY_ID;
  const requested = parameters.get('cartularyId');
  // Route de démonstration : jamais de repli vers un Cartulaire privé (qui exigerait une session).
  // Sans identifiant, ou avec un identifiant hors démonstration, la Submariner est chargée.
  if (isDemoRoute) return requested && isDemoCartularyId(requested) ? requested : DEMO_SUBMARINER_CARTULARY_ID;
  if (requested && SAFE_CARTULARY_ID.test(requested)) return requested;
  // ADR-029 (V7) : plus aucune correspondance code public → Cartulaire côté client ; la projection
  // publique (`publications/{code}.cartularyId`) est la seule source sur `/watch-website`.
  return IWC_CARTULARY_ID;
};

export const ACTIVE_CARTULARY_ID = typeof window === 'undefined'
  ? IWC_CARTULARY_ID
  : cartularyIdFromLocation(window.location);
