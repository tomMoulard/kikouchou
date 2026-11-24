/**
 * @fileoverview The layout tells the repositories who this device is.
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PersonId, TripId } from '@/types';

import { ChangeAuthorBinding } from '../ChangeAuthorBinding';
import { changeAuthor } from '../guest-change';

const identity = vi.hoisted(() => ({
  myPersonId: undefined as string | undefined,
  isResolved: false,
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: { id: 'trip-1' } }),
}));
vi.mock('@/hooks/useTripIdentity', () => ({
  useTripIdentity: () => identity,
}));

const TRIP = 'trip-1' as TripId;

describe('ChangeAuthorBinding', () => {
  it('records the guest once the identity is known, and forgets it when cleared', () => {
    identity.myPersonId = 'alice';
    const { rerender } = render(<ChangeAuthorBinding />);
    // Not resolved yet: nothing is said.
    expect(changeAuthor(TRIP)).toBeUndefined();

    identity.isResolved = true;
    rerender(<ChangeAuthorBinding key="resolved" />);
    expect(changeAuthor(TRIP)).toBe('alice' as PersonId);

    identity.myPersonId = undefined;
    rerender(<ChangeAuthorBinding key="cleared" />);
    expect(changeAuthor(TRIP)).toBeUndefined();
  });
});
