import { readFileSync } from 'node:fs';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoResizeTextarea } from '../../src/components/AutoResizeTextarea.tsx';

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');

describe('AutoResizeTextarea PF2', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        const lines = Math.max(1, this.value.split('\n').length);
        return lines * 24;
      },
    });
  });

  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', originalScrollHeight);
    } else {
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight');
    }
  });

  it('réserve la hauteur du contenu déjà présent dès le montage', () => {
    const { container } = render(
      <AutoResizeTextarea value={'Ligne 1\nLigne 2\nLigne 3'} readOnly />,
    );

    expect(container.querySelector('textarea')?.style.height).toBe('72px');
  });

  it('se recalcule lorsqu’une valeur contrôlée est chargée ou modifiée', () => {
    const { container, rerender } = render(
      <AutoResizeTextarea value="Une ligne" readOnly />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea?.style.height).toBe('44px');

    rerender(<AutoResizeTextarea value={'Une\nDeux\nTrois\nQuatre'} readOnly />);
    expect(textarea?.style.height).toBe('96px');
  });

  it('s’ajuste à la saisie tout en conservant les gestionnaires existants', () => {
    const onInput = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <AutoResizeTextarea defaultValue="Départ" onInput={onInput} onChange={onChange} />,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    fireEvent.input(textarea!, { target: { value: 'Une\nDeux\nTrois' } });

    expect(textarea?.style.height).toBe('72px');
    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('n’effectue aucun balayage global du document pendant une mise à jour', () => {
    const { container, rerender } = render(
      <AutoResizeTextarea value="Départ" readOnly />,
    );
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll');

    rerender(<AutoResizeTextarea value={'Une\nDeux'} readOnly />);
    fireEvent.input(container.querySelector('textarea')!, { target: { value: 'Une\nDeux\nTrois' } });

    expect(querySelectorAll).not.toHaveBeenCalled();
  });

  it('verrouille la suppression de l’ancien effet global dans App', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    expect(appSource).not.toContain("querySelectorAll('textarea')");
    expect(appSource).not.toContain("document.addEventListener('input'");
    expect(appSource).toContain('<AutoResizeTextarea');
  });
});
