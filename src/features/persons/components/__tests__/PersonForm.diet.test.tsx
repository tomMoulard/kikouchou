/**
 * @fileoverview The guest form's diet fields, which belong to the meal
 * planner: shown and submitted only where its flag is on.
 *
 * @module features/persons/components/__tests__/PersonForm.diet.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils';
import type { Person, Trip } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  startDate: '2026-06-01' as Trip['startDate'],
  endDate: '2026-06-10' as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const nora: Person = {
  id: 'person-1' as Person['id'],
  tripId: mockTrip.id,
  name: 'Nora',
  color: '#3b82f6' as Person['color'],
  dietaryTags: ['vegetarian'],
  dietaryNote: 'No mushrooms',
};

const flag = { mealPlanner: true };

vi.mock('@/hooks/useMealPlannerEnabled', () => ({
  useMealPlannerEnabled: () => flag.mealPlanner,
}));

// One object per context, handed back on every render: a fresh `persons` array
// each time changes `usedColors` and re-runs the form's sync effect forever.
const tripContext = { currentTrip: mockTrip };
const personContext = { persons: [] as Person[] };

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => tripContext,
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => personContext,
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));

vi.mock('@/lib/contacts', () => ({
  isContactSearchAvailable: vi.fn(() => false),
  ensureContactsAccess: vi.fn(),
  searchContacts: vi.fn(),
}));

import { PersonForm } from '../PersonForm';

// ============================================================================
// Tests
// ============================================================================

describe('PersonForm: diet', () => {
  beforeEach(() => {
    flag.mealPlanner = true;
  });

  it('submits the diet tags in the order offered, and the food note', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(<PersonForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.type(screen.getByLabelText(/persons\.name/), 'Lila');
    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));
    await user.click(screen.getByRole('button', { name: 'diets.vegan' }));
    await user.click(screen.getByRole('button', { name: 'diets.vegetarian' }));
    await user.type(screen.getByLabelText('diets.noteLabel'), ' Peanuts ');
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Lila',
        dietaryTags: ['vegetarian', 'vegan'],
        dietaryNote: 'Peanuts',
      }),
    );
  });

  it('opens the details on a guest who has a diet, and clears it when emptied', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(<PersonForm person={nora} onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    const vegetarian = screen.getByRole('button', { name: 'diets.vegetarian' });
    expect(vegetarian).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('diets.noteLabel')).toHaveValue('No mushrooms');

    await user.click(vegetarian);
    await user.clear(screen.getByLabelText('diets.noteLabel'));
    await user.click(screen.getByText('common.save'));

    const submitted = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted).toHaveProperty('dietaryTags', undefined);
    expect(submitted).toHaveProperty('dietaryNote', undefined);
  });

  it('neither shows nor submits the diet while the flag is off', async () => {
    flag.mealPlanner = false;
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { user } = render(<PersonForm person={nora} onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', { name: /persons\.moreDetails/ }));
    expect(screen.queryByText('diets.label')).not.toBeInTheDocument();
    await user.click(screen.getByText('common.save'));

    const submitted = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted).not.toHaveProperty('dietaryTags');
    expect(submitted).not.toHaveProperty('dietaryNote');
  });
});
