/**
 * @fileoverview Tests for the hook that remembers the trip page on screen.
 *
 * @module hooks/__tests__/useRememberTripPage.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { readLastTripPage } from '@/lib/navigation/last-trip-page';

import { useRememberTripPage } from '../useRememberTripPage';

function at(path: string) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('useRememberTripPage', () => {
  it('stores the page of the trip on screen', () => {
    renderHook(() => {
      useRememberTripPage();
    }, { wrapper: at('/trips/abc/transports') });

    expect(readLastTripPage('abc')).toBe('transports');
  });

  it('stores nothing outside a trip', () => {
    renderHook(() => {
      useRememberTripPage();
    }, { wrapper: at('/trips') });

    expect(window.localStorage.length).toBe(0);
  });
});
