import { useEffect } from 'react';

/**
 * V6 (V-D3, D4 (b)) : amène l'onglet actif de la piste `.page-tabs__inner` (coque et mini-site) dans la zone visible
 * à chaque changement de page — clic, tourne-page, lien profond, historique. `block: 'nearest'` laisse la fenêtre en place
 * (mesuré : scrollY inchangé, retour lisse en haut de page non interrompu) ; `inline: 'center'` montre les voisins.
 * `scrollIntoView?.` : jsdom ne l'implémente pas ; défilement immédiat (sans `behavior`), neutre pour prefers-reduced-motion.
 */
export function useRevealActiveTab(activeId: string | null | undefined) {
  useEffect(() => {
    const tab = document.querySelector<HTMLElement>('.page-tabs__inner [aria-current="page"]');
    tab?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [activeId]);
}
