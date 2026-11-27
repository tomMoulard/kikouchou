/**
 * @fileoverview The expense form's placeholders, rendered through the real
 * bundles.
 *
 * A tester took "Courses du samedi" and "84,20" for text already typed in the
 * form. The rest of the app marks an example as one ("Ex : Gare Montparnasse"),
 * so these tests hold the money form to the same spelling in both languages.
 *
 * @module features/money/components/__tests__/ExpenseForm.placeholders.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n } from '@/test/utils';

import { ExpenseForm } from '@/features/money/components/ExpenseForm';
import type { Person, PersonId, TripId } from '@/types';

vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-a' as TripId;
const ALICE = 'alice' as PersonId;

const PERSONS: Person[] = [
  { id: ALICE, tripId: TRIP, name: 'Alice', color: '#ef4444' },
] as unknown as Person[];

const NIGHTS = new Map<PersonId, number>([[ALICE, 2]]);

/** The form's three typed fields, by the id each input carries. */
const FIELDS = ['#expense-title', '#expense-amount', '#expense-description'] as const;

async function placeholdersIn(language: 'en' | 'fr'): Promise<string[]> {
  const { container } = await renderWithRealI18n(
    <ExpenseForm
      persons={PERSONS}
      personNights={NIGHTS}
      currency="EUR"
      defaultDate={'2026-07-16' as never}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
    { language, withProviders: false },
  );

  return FIELDS.map(
    (selector) => container.querySelector(selector)?.getAttribute('placeholder') ?? '',
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpenseForm placeholders', () => {
  it('marks every French example with "Ex : "', async () => {
    const placeholders = await placeholdersIn('fr');

    expect(placeholders).toEqual([
      'Ex\u00a0: Courses du samedi',
      'Ex\u00a0: 84,20',
      'Ex\u00a0: Deux caddies, le vin compris',
    ]);
  });

  it('marks every English example with "e.g. "', async () => {
    const placeholders = await placeholdersIn('en');

    expect(placeholders).toEqual([
      'e.g. Saturday shopping',
      'e.g. 84.20',
      'e.g. Two trolleys, the wine included',
    ]);
  });
});
