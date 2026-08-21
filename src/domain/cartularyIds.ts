export const IWC_CARTULARY_ID = 'cart_iwc_flieger_utc_2002';
export const ROLEX_CARTULARY_ID = 'cart_rolex_gmt_master_mark_i_long_e_1675_642cf3adba60';

const SAFE_CARTULARY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,159}$/;

export const cartularyIdFromLocation = (location: Pick<Location, 'pathname' | 'search'> | null | undefined) => {
  if (!location) return IWC_CARTULARY_ID;
  const normalizedPath = location.pathname.replace(/\/$/, '');
  const parameters = new URLSearchParams(location.search);
  const isLocalPublicationPreview = normalizedPath === '/watch-website' && parameters.get('preview') === 'local';
  const supportsCartularySelection = normalizedPath === '/cartulary' || isLocalPublicationPreview;
  if (!supportsCartularySelection) return IWC_CARTULARY_ID;
  const requested = parameters.get('cartularyId');
  return requested && SAFE_CARTULARY_ID.test(requested) ? requested : IWC_CARTULARY_ID;
};

export const ACTIVE_CARTULARY_ID = typeof window === 'undefined'
  ? IWC_CARTULARY_ID
  : cartularyIdFromLocation(window.location);
