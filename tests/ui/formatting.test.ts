import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatPercent,
} from '../../src/utils/formatting.ts';

describe('formatage partagé compatible avec l’interface historique', () => {
  it('conserve les replis explicites pour les dates invalides', () => {
    expect(formatDate('invalide')).toBe('Date à vérifier');
    expect(formatDateTime('invalide')).toBe('Horodatage à vérifier');
  });

  it('conserve les unités et arrondis des fichiers', () => {
    expect(formatFileSize(1025)).toBe('2 ko');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 Mo');
  });

  it('centralise montants et pourcentages sans modifier leur sens', () => {
    expect(formatMoney(1200, 'EUR')).toContain('1 200');
    expect(formatPercent(null)).toBe('N/A');
    expect(formatPercent(0.125)).toContain('12,5');
  });
});
