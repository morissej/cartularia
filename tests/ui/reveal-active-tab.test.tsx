// V6 — point « cartulaire-mobile » (V-D3, D4 (b)) : le crochet useRevealActiveTab amène l'onglet courant dans la piste
// à chaque changement de page. jsdom ne mesure ni ne défile : on vérifie l'appel (cible, options, fréquence) et la tolérance.
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRevealActiveTab } from '../../src/hooks/useRevealActiveTab.ts';

const mountTabs = (activeId: string) => {
  document.body.innerHTML = `<nav class="page-tabs"><div class="page-tabs__inner">
    <button type="button" id="tab-cover" ${activeId === 'cover' ? 'aria-current="page"' : ''}>00 Accueil</button>
    <button type="button" id="tab-value" ${activeId === 'value' ? 'aria-current="page"' : ''}>04 Valorisation</button>
  </div></nav>`;
};

afterEach(() => {
  document.body.innerHTML = '';
  // @ts-expect-error jsdom n'implémente pas scrollIntoView : on retire l'espion posé par le test pour rendre l'état initial.
  delete Element.prototype.scrollIntoView;
});

describe('useRevealActiveTab (V6 V-D3)', () => {
  it('amène l’onglet courant dans la piste sans toucher la fenêtre (block: nearest), à chaque changement de page seulement', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mountTabs('value');
    const { rerender } = renderHook(({ page }) => useRevealActiveTab(page), { initialProps: { page: 'value' } });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(document.getElementById('tab-value'));
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'center', block: 'nearest' });
    mountTabs('cover');
    rerender({ page: 'cover' });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.instances[1]).toBe(document.getElementById('tab-cover'));
    // Rendu sans changement de page (clic sur l’onglet déjà actif, édition) : aucun défilement supplémentaire.
    rerender({ page: 'cover' });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('ne vise que l’onglet courant de la piste, jamais un aria-current hors piste', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    document.body.innerHTML = '<a href="#" id="elsewhere" aria-current="page">Ailleurs</a><nav class="page-tabs"><div class="page-tabs__inner"><button type="button" id="tab-cover">00 Accueil</button></div></nav>';
    renderHook(() => useRevealActiveTab('cover'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reste inerte sans piste (chargement) et sans scrollIntoView (jsdom nu)', () => {
    expect(Element.prototype.scrollIntoView).toBeUndefined();
    expect(() => renderHook(() => useRevealActiveTab('value'))).not.toThrow();
    mountTabs('value');
    expect(() => renderHook(() => useRevealActiveTab('value'))).not.toThrow();
  });
});
