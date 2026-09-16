// V7 (V-B2, décision D10) : préchauffage du cache HTTP du Registre depuis la page de connexion. Les mêmes modules que RootPage.tsx
// (RegistryApp) et RegistryApp.tsx (RegistryItems, première section ouverte après la connexion) : Vite résout les mêmes morceaux
// (RegistryApp-*.js, RegistryItems-*.js, leurs dépendances statiques et registry-*.css), si bien que l'étape /registry/<id>/items qui
// suit la connexion ne demande plus aucun JS au réseau (mesuré : parcours à chaud de scripts/measure-surfaces.mjs, seuil registre-items).
// Aucun appel Firebase : ce module ne fait qu'importer, et RegistryApp / RegistryItems n'ont pas d'effet à l'import (leurs écoutes vivent
// dans des useEffect) ; firebase.ts est déjà chargé par la page de connexion (services/foundations). Une importation qui échoue (fichier
// disparu après un déploiement) est absorbée par allSettled ; l'événement vite:preloadError reste traité par main.tsx (un rechargement
// par minute au plus). Verrous : tests/ui/registry-preload.test.tsx, tests/performance-v7.test.mjs.

/** Inactivité laissée au visiteur après le premier rendu (lecture, saisie) avant de solliciter le réseau. */
export const REGISTRY_PRELOAD_DELAY_MS = 1500;
/** Au-delà de ce délai supplémentaire, la période d'inactivité n'est plus attendue : déclenchement au plus tard 2 500 ms après le rendu. */
export const REGISTRY_PRELOAD_IDLE_TIMEOUT_MS = 1000;

/** Tire les morceaux du Registre dans le cache HTTP ; ne rejette jamais. */
export const loadRegistrySurface = () => Promise.allSettled([
  import('../registry/RegistryApp.tsx'),
  import('../registry/RegistryItems.tsx'),
]);

/**
 * Planifie le préchargement à l'inactivité, entre 1,5 et 2,5 s après l'appel (1,5 s sans requestIdleCallback : Safari, jsdom).
 * La fonction rendue annule ce qui n'est pas encore parti (démontage de la page de connexion avant l'échéance).
 */
export const scheduleRegistryPreload = (load: () => unknown = loadRegistrySurface): (() => void) => {
  let idle: number | undefined;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => { void load(); }, { timeout: REGISTRY_PRELOAD_IDLE_TIMEOUT_MS });
    else void load();
  }, REGISTRY_PRELOAD_DELAY_MS);
  return () => {
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
};
