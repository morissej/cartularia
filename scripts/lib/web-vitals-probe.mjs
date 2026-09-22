/**
 * Sonde d'audit Core Web Vitals (LCP, CLS, INP) pour un navigateur piloté
 * (console, javascript_tool, Playwright). Hors bundle applicatif : rien dans
 * `src/` n'importe ce module.
 *
 * Règles issues de la requalification du constat V-B6 (audit du 2026-09-08) :
 * - un `PerformanceObserver` par type, `observe({ type, buffered: true })`,
 *   jamais `observe({ entryTypes })` ;
 * - jamais `performance.getEntriesByType()` pour ces types : Chromium renvoie
 *   un tableau vide et avertit « Deprecated API for given entry type. » ;
 * - un type absent de `PerformanceObserver.supportedEntryTypes` est ignoré ;
 *   sans `supportedEntryTypes` (moteur ancien), rien n'est observé, car un
 *   `observe()` sur un type inconnu produit lui aussi un avertissement console.
 */

export const WEB_VITALS_ENTRY_TYPES = Object.freeze(['largest-contentful-paint', 'layout-shift', 'event']);

/** Seuil de durée (ms) sous lequel les entrées `event` ne sont pas livrées ; 40 ms est la valeur usuelle pour INP. */
export const INP_DURATION_THRESHOLD_MS = 40;

const supportedEntryTypesOf = (PerformanceObserverCtor) => {
  const supported = PerformanceObserverCtor.supportedEntryTypes;
  return Array.isArray(supported) ? supported : [];
};

const observeInitFor = (type) => (
  type === 'event'
    ? { type, buffered: true, durationThreshold: INP_DURATION_THRESHOLD_MS }
    : { type, buffered: true }
);

/**
 * Observe les types demandés et appelle `onEntry(type, entry)` pour chaque entrée.
 * Retourne une fonction d'arrêt qui déconnecte tous les observateurs créés.
 */
export function observeWebVitals(onEntry, types = WEB_VITALS_ENTRY_TYPES) {
  if (typeof onEntry !== 'function') throw new TypeError('observeWebVitals attend une fonction onEntry.');
  const PerformanceObserverCtor = globalThis.PerformanceObserver;
  if (typeof PerformanceObserverCtor !== 'function') return () => {};

  const supported = supportedEntryTypesOf(PerformanceObserverCtor);
  const observers = [];
  for (const type of new Set(types)) {
    if (!supported.includes(type)) continue;
    const observer = new PerformanceObserverCtor((list) => {
      for (const entry of list.getEntries()) onEntry(type, entry);
    });
    try {
      observer.observe(observeInitFor(type));
      observers.push(observer);
    } catch {
      // Type annoncé mais refusé par ce moteur : ignoré, sans avertissement.
    }
  }
  return () => {
    for (const observer of observers.splice(0)) observer.disconnect();
  };
}

/**
 * Agrège les trois métriques de laboratoire :
 * - `lcp` : dernière entrée `largest-contentful-paint` (renderTime, sinon loadTime, sinon startTime) ;
 * - `cls` : somme des `layout-shift` sans `hadRecentInput` (cumul simple, sans fenêtres de session) ;
 * - `inp` : durée maximale observée sur les entrées `event` (approximation d'INP).
 * `lcp` et `inp` valent `null` tant qu'aucune entrée n'a été reçue.
 */
export function createWebVitalsCollector() {
  const metrics = { lcp: null, cls: 0, inp: null };
  const stop = observeWebVitals((type, entry) => {
    if (type === 'largest-contentful-paint') {
      metrics.lcp = entry.renderTime || entry.loadTime || entry.startTime || 0;
    } else if (type === 'layout-shift') {
      if (!entry.hadRecentInput) metrics.cls += entry.value;
    } else if (type === 'event') {
      metrics.inp = Math.max(metrics.inp ?? 0, entry.duration);
    }
  });
  return { stop, snapshot: () => ({ ...metrics }) };
}
