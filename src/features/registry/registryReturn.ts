import { DEMO_ACCOUNT } from '../../data/demoCartularies.ts';
import { isRegistryReturnPath } from './registryCatalog.ts';
import { parseRegistryRoute, registryHref } from './registryRouting.ts';

/**
 * Règle unique du retour d'un Cartulaire vers le Registre (V2, constats V-A4 / V-A5).
 *
 * Un seul module pur décide où renvoie « Retour au Registre » : App.tsx, BarreDossier
 * (logo), GenericCartularyPage et les écrans « sans Registre » (Cercle, Collection,
 * connexion du Registre) l'utilisent au lieu de recalculer chacun le repli `/registry`.
 * Le mode démonstration ne change pas la structure (ADR-026) : il ne change que la cible
 * et le libellé du repli quand aucun `returnTo` valide n'est fourni.
 */

/** Registre démo, section Catalogue — cible d'AccountAccessPage après connexion démo. */
export const DEMO_REGISTRY_RETURN_HREF = registryHref(DEMO_ACCOUNT.registryId, 'items');

/** Page compte avec la section démo surlignée ; seule entrée qui connecte le compte démo. */
export const DEMO_REGISTRY_ENTRY_HREF = '/account/sign-in?demo=1';

const demoDirectEntryHref = (returnTo: string) => `/account/sign-in?demo=1&open=1&returnTo=${encodeURIComponent(returnTo)}`;

/** Connexion automatique du compte partagé, puis ouverture directe du Catalogue. */
export const DEMO_REGISTRY_DIRECT_HREF = demoDirectEntryHref(DEMO_REGISTRY_RETURN_HREF);

/** Connexion automatique du compte partagé, puis ouverture directe de sa Collection. */
export const DEMO_COLLECTION_DIRECT_HREF = demoDirectEntryHref(registryHref(DEMO_ACCOUNT.registryId, 'collections'));

/** Accueil public ; issue proposée à tout visiteur sans session. */
export const PUBLIC_HOME_HREF = '/';

export interface RegistryReturn {
  href: string;
  label: { FR: string; EN: string };
}

const REGISTRY_RETURN_LABEL = { FR: 'Retour au Registre', EN: 'Back to Registry' } as const;
const DEMO_REGISTRY_RETURN_LABEL = { FR: 'Retour au Registre démo', EN: 'Back to demo Registry' } as const;

export const resolveRegistryReturn = (
  requestedReturnTo: string | null | undefined,
  options: { demo: boolean },
): RegistryReturn => {
  const candidate = requestedReturnTo ?? null;
  if (isRegistryReturnPath(candidate)) {
    if (options.demo && parseRegistryRoute(candidate.split('?')[0]).registryId === DEMO_ACCOUNT.registryId) {
      return { href: demoDirectEntryHref(candidate), label: DEMO_REGISTRY_RETURN_LABEL };
    }
    return { href: candidate, label: REGISTRY_RETURN_LABEL };
  }
  if (options.demo) {
    return { href: DEMO_REGISTRY_DIRECT_HREF, label: DEMO_REGISTRY_RETURN_LABEL };
  }
  return { href: '/registry', label: REGISTRY_RETURN_LABEL };
};

/** Vrai quand un écran « sans session » vise le Registre démo : il doit proposer l'entrée démo. */
export const shouldOfferDemoRegistryEntry = (registryId: string | null | undefined) => (
  registryId === DEMO_ACCOUNT.registryId
);

export type SignedOutRegistryLink = { href: string; label: string; kind: 'demo' | 'home' };

/**
 * Issues d'un écran « sans Registre » pour un visiteur sans session : jamais un
 * « Retour au Registre » vers un formulaire de connexion sans issue.
 */
export const signedOutRegistryLinks = (registryId: string | null | undefined): SignedOutRegistryLink[] => [
  ...(registryId === null || registryId === undefined || shouldOfferDemoRegistryEntry(registryId)
    ? [{ href: DEMO_REGISTRY_ENTRY_HREF, label: 'Ouvrir le Registre démo', kind: 'demo' as const }]
    : []),
  { href: PUBLIC_HOME_HREF, label: 'Retour à l’accueil', kind: 'home' as const },
];

/** Section Collections d'un Registre — retour de la page Collection pour un lecteur connecté. */
export const registryCollectionsHref = (registryId: string) => registryHref(registryId, 'collections');
