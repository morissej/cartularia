export const IWC_CARTULARY_ID = 'cart_iwc_flieger_utc_2002';
export const ROLEX_CARTULARY_ID = 'cart_rolex_gmt_master_mark_i_long_e_1675_642cf3adba60';

const SAFE_CARTULARY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,159}$/;

export const cartularyIdFromLocation = (location: Pick<Location, 'pathname' | 'search'> | null | undefined) => {
  if (!location) return IWC_CARTULARY_ID;
  const normalizedPath = location.pathname.replace(/\/$/, '');
  const parameters = new URLSearchParams(location.search);
  const isWatchWebsite = normalizedPath === '/watch-website';
  const isLocalPublicationPreview = isWatchWebsite && parameters.get('preview') === 'local';
  const supportsCartularySelection = normalizedPath === '/cartulary' || normalizedPath === '/cartulary-view' || isWatchWebsite || isLocalPublicationPreview;
  if (!supportsCartularySelection) return IWC_CARTULARY_ID;
  const requested = parameters.get('cartularyId');
  if (requested && SAFE_CARTULARY_ID.test(requested)) return requested;
  const publicCode = parameters.get('publicCode');
  if (publicCode === 'ROL-487D9CAD' || publicCode === 'ROLEX-1675-01') return ROLEX_CARTULARY_ID;
  if (publicCode === 'OP-4892-XZ9') return IWC_CARTULARY_ID;
  return IWC_CARTULARY_ID;
};

export const ACTIVE_CARTULARY_ID = typeof window === 'undefined'
  ? IWC_CARTULARY_ID
  : cartularyIdFromLocation(window.location);
