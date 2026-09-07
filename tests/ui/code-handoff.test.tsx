import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_TTL, HANDOFF_VERSION, neutralCodeOptions, parseCodeSnapshot, trustedOrigin, parseHandoffReturn } from '../../src/personalVault/codeHandoffProtocol';
import { captureHandoffFragment } from '../../src/personalVault/codeHandoffCapture';
import { applicationRouteFromPathname } from '../../src/utils/interfaceState';
import { useVaultCodeHandoff } from '../../src/personalVault/useVaultCodeHandoff';

const user = { uid: 'registry-owner', email: `${'a'.repeat(64)}@registry.cartularia.invalid` };
const valid = { locations: [{ code: 'LIE-ABCDEF12', genericLabel: 'Lieu 1' }], people: [{ code: 'CLI-12345678', genericLabel: 'Personne 1' }] };
class TestChannel {
  static current: TestChannel;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn(); close = vi.fn();
  constructor(readonly name: string) { TestChannel.current = this; }
}
beforeEach(() => { vi.stubEnv('VITE_PERSONAL_VAULT_URL', 'https://vault.example.test/'); vi.stubGlobal('BroadcastChannel', TestChannel); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('protocole codes-only', () => {
  it('refuse tout texte personnel, champ supplémentaire, doublon et code mal formé', () => {
    expect(parseCodeSnapshot(valid)).toEqual(valid);
    expect(parseCodeSnapshot({ ...valid, password: 'not-allowed' })).toBeNull();
    expect(parseCodeSnapshot({ ...valid, people: [{ code: 'CLI-12345678', genericLabel: 'Jean Dupont' }] })).toBeNull();
    expect(parseCodeSnapshot({ ...valid, locations: [...valid.locations, ...valid.locations] })).toBeNull();
    expect(parseCodeSnapshot({ ...valid, locations: [{ code: 'Paris', genericLabel: 'Lieu 1' }] })).toBeNull();
    expect(neutralCodeOptions([{ code: 'LIE-ABCDEF12', genericLabel: 'Paris privé' }], 'locations')).toEqual([{ code: 'LIE-ABCDEF12', genericLabel: 'LIE-ABCDEF12' }]);
  });
  it('n’accepte que HTTPS ou un émulateur local expressément autorisé', () => {
    expect(trustedOrigin('https://registry.example.test/')).toBe('https://registry.example.test');
    expect(trustedOrigin('https://user:secret@registry.example.test/')).toBeNull();
    expect(trustedOrigin('http://registry.example.test/', true)).toBeNull();
    expect(trustedOrigin('http://localhost:4173/')).toBeNull();
    expect(trustedOrigin('http://localhost:4173/', true)).toBe('http://localhost:4173');
  });
  it('lie capability, destinataire et session puis oublie à la déconnexion sans dépendre de window.opener', () => {
    const popup = { postMessage: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { result, rerender } = renderHook(({ session }) => useVaultCodeHandoff(session), { initialProps: { session: user as typeof user | null } });
    act(() => result.current.connect());
    const params = new URLSearchParams(new URL(String(open.mock.calls[0][0])).hash.slice(1));
    const nonce = params.get('codeHandoff'); const expiresAt = Number(params.get('expiresAt'));
    const deliver = (extra = {}) => act(() => TestChannel.current.onmessage?.({ data: { version: HANDOFF_VERSION, outcome: 'codes', nonce, expiresAt, recipient: user, snapshot: valid, ...extra } }));
    deliver({ nonce: crypto.randomUUID() }); expect(result.current.locations).toEqual([]);
    deliver({ recipient: { ...user, uid: 'other-owner' } }); expect(result.current.locations).toEqual([]);
    deliver({ recipient: { ...user, email: `${'b'.repeat(64)}@registry.cartularia.invalid` } }); expect(result.current.locations).toEqual([]);
    deliver({ expiresAt: Date.now() - 1 }); expect(result.current.locations).toEqual([]);
    deliver(); expect(result.current.locations).toEqual(valid.locations); expect(result.current.status).toBe('ready');
    deliver({ snapshot: { locations: [], people: [] } }); expect(result.current.locations).toEqual(valid.locations);
    rerender({ session: null }); expect(result.current.locations).toEqual([]);
    expect(localStorage.getItem('cartularia-code-handoff')).toBeNull();
  });
  it('refuse un compte inattendu et expire les snapshots même déjà reçus', () => {
    vi.useFakeTimers();
    const popup = { postMessage: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { result } = renderHook(() => useVaultCodeHandoff(user));
    act(() => result.current.connect());
    const params = new URLSearchParams(new URL(String(open.mock.calls[0][0])).hash.slice(1));
    act(() => TestChannel.current.onmessage?.({ data: { version: HANDOFF_VERSION, outcome: 'codes', nonce: params.get('codeHandoff'), expiresAt: Number(params.get('expiresAt')), recipient: user, snapshot: valid } }));
    expect(result.current.locations).toEqual(valid.locations);
    act(() => vi.advanceTimersByTime(HANDOFF_TTL + 1));
    expect(result.current.locations).toEqual([]); expect(result.current.status).toBe('error');
  });
  it('explique un blocage de fenêtre et refuse les comptes sans alias compatible', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result, rerender } = renderHook(({ session }) => useVaultCodeHandoff(session), { initialProps: { session: user } });
    act(() => result.current.connect()); expect(result.current.message).toContain('fenêtre du Coffre a été bloquée');
    rerender({ session: { ...user, email: 'historic@example.test' } });
    act(() => result.current.connect()); expect(result.current.message).toContain('pseudonyme');
  });
  it('retire le fragment avant parsing et rend le retour public sans hydratation privée', () => {
    const history = { state: null, replaceState: vi.fn() };
    const result = captureHandoffFragment({ pathname: '/code-handoff-return', search: '', hash: '#malformed-private-capability' }, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/code-handoff-return');
    expect(result.response).toBe('malformed-private-capability');
    expect(applicationRouteFromPathname('/code-handoff-return')).toBe('code-handoff-return');
    expect(parseHandoffReturn({ version: HANDOFF_VERSION, nonce: crypto.randomUUID(), recipient: user, expiresAt: Date.now() + HANDOFF_TTL + 10, outcome: 'cancelled' })).toBeNull();
    expect(parseHandoffReturn({ version: HANDOFF_VERSION, nonce: crypto.randomUUID(), recipient: user, expiresAt: NaN, outcome: 'cancelled' })).toBeNull();
  });
  it('annule explicitement et refuse les navigateurs dépourvus de BroadcastChannel', () => {
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { result } = renderHook(() => useVaultCodeHandoff(user));
    act(() => result.current.connect()); expect(result.current.message).toContain('fermé cette fenêtre');
    const close = TestChannel.current.close;
    act(() => result.current.clear()); expect(close).toHaveBeenCalled(); expect(result.current.status).toBe('inactive');
    vi.stubGlobal('BroadcastChannel', undefined);
    act(() => result.current.connect()); expect(result.current.message).toContain('canal de retour sécurisé');
  });
  it('préserve le libellé neutre associé au code même si l’ordre change', () => {
    const original = [{ code: 'LIE-FFFFFFFF', genericLabel: 'Lieu 1' }, { code: 'LIE-00000000', genericLabel: 'Lieu 2' }];
    const output = neutralCodeOptions(original, 'locations');
    expect(output[0]).toEqual(original[1]); expect(output[1]).toEqual(original[0]);
    expect(parseCodeSnapshot({ locations: output, people: [] })?.locations).toEqual(output);
  });
});
