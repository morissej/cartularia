import { describe, expect, it } from 'vitest';
import { allocateGenericCodeLabels } from '../../src/personalVault/codeLabels';

describe('libellés de correspondance génériques', () => {
  it.each(['Lieu', 'Personne'] as const)('répare aussi les doublons historiques et noms libres pour %s', (prefix) => {
    const existing = new Map([['a', { genericLabel: `${prefix} 2` }], ['b', { genericLabel: `${prefix} 2` }], ['c', { genericLabel: 'Nom personnel interdit' }]]);
    const labels = allocateGenericCodeLabels(['new', 'a', 'b', 'c'], existing, prefix);
    expect(labels.get('a')).toBe(`${prefix} 2`);
    expect(labels.get('new')).toBe(`${prefix} 1`);
    expect(new Set(labels.values()).size).toBe(4);
    expect([...labels.values()].every(label => new RegExp(`^${prefix} [1-9][0-9]*$`).test(label))).toBe(true);
    expect(allocateGenericCodeLabels(['c', 'b', 'a', 'new'], new Map([...labels].map(([code, genericLabel]) => [code, { genericLabel }])), prefix)).toEqual(new Map([...labels].reverse()));
  });
});
