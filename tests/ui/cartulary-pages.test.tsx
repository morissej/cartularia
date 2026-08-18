import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ConditionPage,
  CoverPage,
  MediaPage,
  ReferencePage,
  ValuePage,
} from '../../src/features/cartulary/pages/CartularyPages.tsx';

describe('frontières des pages Cartulaire', () => {
  it('ne rend que la page active sans changer son contenu', () => {
    render(<>
      <CoverPage active={false}><h1>Cover</h1></CoverPage>
      <MediaPage active><h1>Media</h1></MediaPage>
      <ReferencePage active={false}><h1>Reference</h1></ReferencePage>
      <ConditionPage active={false}><h1>Condition</h1></ConditionPage>
      <ValuePage active={false}><h1>Value</h1></ValuePage>
    </>);

    expect(screen.queryByRole('heading', { name: 'Cover' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Media' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Value' })).toBeNull();
  });
});
