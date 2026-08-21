export const REGISTRY_SECTIONS = [
  'overview',
  'items',
  'collections',
  'new',
  'gallery',
  'compare',
  'follow-up',
  'access',
  'integrity',
  'admin',
] as const;

export type RegistrySection = typeof REGISTRY_SECTIONS[number];

export interface RegistryRoute {
  registryId: string | null;
  section: RegistrySection;
}

const REGISTRY_SECTION_SET = new Set<string>(REGISTRY_SECTIONS);

export const parseRegistryRoute = (pathname: string): RegistryRoute => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'registry' || !segments[1]) {
    return { registryId: null, section: 'overview' };
  }
  const candidateSection = segments[2];
  return {
    registryId: decodeURIComponent(segments[1]),
    section: candidateSection && REGISTRY_SECTION_SET.has(candidateSection)
      ? candidateSection as RegistrySection
      : 'overview',
  };
};

export const registryHref = (
  registryId: string,
  section: RegistrySection = 'overview',
) => `/registry/${encodeURIComponent(registryId)}/${section}`;

export interface RegistryNavigationGesture {
  defaultPrevented: boolean;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: string | null;
  download: boolean;
}

export const shouldInterceptRegistryNavigation = (gesture: RegistryNavigationGesture) => (
  !gesture.defaultPrevented
  && gesture.button === 0
  && !gesture.altKey
  && !gesture.ctrlKey
  && !gesture.metaKey
  && !gesture.shiftKey
  && (!gesture.target || gesture.target === '_self')
  && !gesture.download
);

export const registryNavigationTarget = (href: string, currentUrl: string) => {
  if (!href || href.startsWith('#')) return null;
  try {
    const current = new URL(currentUrl);
    const target = new URL(href, current);
    if (target.origin !== current.origin) return null;
    if (target.pathname !== '/registry' && !target.pathname.startsWith('/registry/')) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
};
