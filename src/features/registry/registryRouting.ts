export const REGISTRY_SECTIONS = [
  'overview',
  'items',
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
