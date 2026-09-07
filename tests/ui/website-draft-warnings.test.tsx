import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebsiteDraftWarnings } from '../../src/components/WebsiteDraftWarnings';
import { buildWebsiteDraft } from '../../src/domain/websiteDraft';

describe('explication des omissions publiques', () => {
  it('précise les rubriques affectées, sans reproduire les données écartées', () => {
    const blocks = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [], description: ['Adresse confidentielle : valeur privée'], history: ['Histoire publiable'] }, ['condition-description', 'reference-history']);
    const { container } = render(<WebsiteDraftWarnings blocks={blocks} />);
    expect(screen.getByRole('status').textContent).toContain('Certains textes ne seront pas publiés');
    expect(container.textContent).toContain(blocks.find((block) => block.excludedTextCount)!.title);
    expect(container.textContent).not.toContain('valeur privée');
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });
  it('n’affiche pas d’alerte pour le mot original dans une description publique', () => {
    const blocks = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [], description: ['Cadran original bleu, sans restauration.'] }, ['condition-description']);
    const { container } = render(<WebsiteDraftWarnings blocks={blocks} />);
    expect(container.textContent).toBe('');
  });
});
