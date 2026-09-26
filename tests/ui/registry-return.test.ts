import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNT } from '../../src/data/demoCartularies.ts';
import { registryHref } from '../../src/features/registry/registryRouting.ts';
import {
  DEMO_REGISTRY_ENTRY_HREF,
  DEMO_REGISTRY_DIRECT_HREF,
  DEMO_REGISTRY_RETURN_HREF,
  PUBLIC_HOME_HREF,
  registryCollectionsHref,
  resolveRegistryReturn,
  shouldOfferDemoRegistryEntry,
  signedOutRegistryLinks,
} from '../../src/features/registry/registryReturn.ts';

describe('resolveRegistryReturn — règle unique du retour d’un Cartulaire (V-A4)', () => {
  it('conserve un returnTo valide, démo ou non, avec le libellé neutre', () => {
    for (const demo of [true, false]) {
      const result = resolveRegistryReturn('/registry/reg_x/items?q=a', { demo });
      expect(result.href).toBe('/registry/reg_x/items?q=a');
      expect(result.label).toEqual({ FR: 'Retour au Registre', EN: 'Back to Registry' });
    }
  });

  it('renvoie un Cartulaire démo sans returnTo vers le Registre démo, libellé « démo »', () => {
    const result = resolveRegistryReturn(null, { demo: true });
    expect(new URL(result.href, 'https://example.test').searchParams.get('returnTo')).toBe('/registry/reg_cartularia_demo/items');
    expect(result.href).toBe(DEMO_REGISTRY_DIRECT_HREF);
    expect(result.label).toEqual({ FR: 'Retour au Registre démo', EN: 'Back to demo Registry' });
  });

  it('renvoie un Cartulaire réel sans returnTo vers /registry', () => {
    const result = resolveRegistryReturn(null, { demo: false });
    expect(result.href).toBe('/registry');
    expect(result.label.FR).toBe('Retour au Registre');
    expect(resolveRegistryReturn(undefined, { demo: false }).href).toBe('/registry');
  });

  it.each(['//evil', '/community', '/registry\\x', 'https://example.test/registry/x', '', 'registry/reg_x'])(
    'rejette « %s » en démo comme hors démo',
    (candidate) => {
      expect(resolveRegistryReturn(candidate, { demo: true }).href).toBe(DEMO_REGISTRY_DIRECT_HREF);
      expect(resolveRegistryReturn(candidate, { demo: false }).href).toBe('/registry');
    },
  );

  it('aligne la cible démo sur la route d’atterrissage d’AccountAccessPage', () => {
    expect(DEMO_REGISTRY_RETURN_HREF).toBe(registryHref(DEMO_ACCOUNT.registryId, 'items'));
    expect(DEMO_REGISTRY_ENTRY_HREF).toBe('/account/sign-in?demo=1');
    expect(PUBLIC_HOME_HREF).toBe('/');
  });
});

describe('écrans « sans Registre » — issues proposées sans session (V-A5)', () => {
  it('propose l’entrée démo seulement pour le Registre démo ou sans contexte', () => {
    expect(shouldOfferDemoRegistryEntry(DEMO_ACCOUNT.registryId)).toBe(true);
    expect(shouldOfferDemoRegistryEntry('reg_prive')).toBe(false);
    expect(shouldOfferDemoRegistryEntry(null)).toBe(false);
  });

  it('sans contexte : entrée démo puis accueil, jamais /registry', () => {
    const links = signedOutRegistryLinks(null);
    expect(links.map((link) => link.href)).toEqual([DEMO_REGISTRY_ENTRY_HREF, PUBLIC_HOME_HREF]);
    expect(links.map((link) => link.label)).toEqual(['Ouvrir le Registre démo', 'Retour à l’accueil']);
    expect(links.some((link) => link.href.startsWith('/registry'))).toBe(false);
  });

  it('Registre démo : entrée démo et accueil ; Registre privé : accueil seul', () => {
    expect(signedOutRegistryLinks(DEMO_ACCOUNT.registryId).map((link) => link.kind)).toEqual(['demo', 'home']);
    expect(signedOutRegistryLinks('reg_prive').map((link) => link.kind)).toEqual(['home']);
  });

  it('le retour connecté de la page Collection vise la section Collections du Registre', () => {
    expect(registryCollectionsHref('reg_prive')).toBe('/registry/reg_prive/collections');
    expect(registryCollectionsHref('reg/évadé')).toBe(`/registry/${encodeURIComponent('reg/évadé')}/collections`);
  });
});
