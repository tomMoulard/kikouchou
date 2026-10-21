/**
 * @fileoverview Tests for the empty calendar's trip-setup checklist.
 *
 * @module features/calendar/components/__tests__/TripSetupChecklist.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripSetupChecklist } from '../TripSetupChecklist';
import type { TripSetupChecklist as TripSetupChecklistModel } from '../../utils/setup-checklist';

// ============================================================================
// Mocks
// ============================================================================

/*
  The fallback text, with `{{placeholders}}` filled in. The counts are the whole
  point of this component, so a mock that echoed keys or left the placeholders
  in place would let every count assertion pass on the wrong number.
*/
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      if (typeof fallback !== 'string') {
        return key;
      }
      const values = options ?? {};
      return fallback.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
        name in values ? String(values[name]) : whole,
      );
    },
  }),
}));

// ============================================================================
// Test Data
// ============================================================================

/** A checklist where only the guest step is done — a freshly saved trip. */
function makeFreshChecklist(): TripSetupChecklistModel {
  return {
    steps: [
      { key: 'guests', count: 4, isDone: true },
      { key: 'rooms', count: 0, isDone: false },
      { key: 'assignments', count: 0, total: 4, isDone: false },
      { key: 'arrivals', count: 0, isDone: false },
    ],
    doneCount: 1,
    stepCount: 4,
    isComplete: false,
  };
}

function renderChecklist(
  checklist: TripSetupChecklistModel = makeFreshChecklist(),
): {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly onAddGuests: ReturnType<typeof vi.fn>;
  readonly onAddRooms: ReturnType<typeof vi.fn>;
  readonly onAssignRooms: ReturnType<typeof vi.fn>;
  readonly onAddArrivals: ReturnType<typeof vi.fn>;
} {
  const onAddGuests = vi.fn(),
    onAddRooms = vi.fn(),
    onAssignRooms = vi.fn(),
    onAddArrivals = vi.fn();

  render(
    <TripSetupChecklist
      checklist={checklist}
      onAddGuests={onAddGuests}
      onAddRooms={onAddRooms}
      onAssignRooms={onAssignRooms}
      onAddArrivals={onAddArrivals}
    />,
  );

  return {
    user: userEvent.setup(),
    onAddGuests,
    onAddRooms,
    onAssignRooms,
    onAddArrivals,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TripSetupChecklist', () => {
  it('names every step', () => {
    renderChecklist();

    expect(screen.getByText('Add guests')).toBeInTheDocument();
    expect(screen.getByText('Add rooms')).toBeInTheDocument();
    expect(screen.getByText('Put guests in rooms')).toBeInTheDocument();
    expect(screen.getByText('Add arrivals')).toBeInTheDocument();
  });

  it('shows each step its own count, including the ones still at zero', () => {
    renderChecklist();

    expect(screen.getByText('4 people on the list')).toBeInTheDocument();
    expect(screen.getByText('No rooms yet')).toBeInTheDocument();
    expect(screen.getByText('Nobody has a room yet')).toBeInTheDocument();
    expect(screen.getByText('No arrivals yet')).toBeInTheDocument();
  });

  it('reports progress as text and on a progress bar', () => {
    renderChecklist();

    expect(screen.getByText('1 of 4 done')).toBeInTheDocument();

    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '4');
    expect(progress).toHaveAttribute('aria-valuetext', '1 of 4 done');
  });

  it('drops the button of a finished step and says "done" for a screen reader', () => {
    renderChecklist();

    // The guest step is done, so its row offers nothing to click.
    expect(screen.queryByRole('button', { name: 'New guest' })).not.toBeInTheDocument();
    // Colour alone never carries meaning — see AGENTS.md.
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('offers a button on every unfinished step', () => {
    renderChecklist();

    expect(screen.getByRole('button', { name: 'New room' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign rooms' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New arrival' })).toBeInTheDocument();
  });

  it('hands the buttons to their own callbacks', async () => {
    const { user, onAddRooms, onAssignRooms, onAddArrivals } = renderChecklist();

    await user.click(screen.getByRole('button', { name: 'New room' }));
    expect(onAddRooms).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Assign rooms' }));
    expect(onAssignRooms).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'New arrival' }));
    expect(onAddArrivals).toHaveBeenCalledTimes(1);
  });

  it('shows part-way progress on the steps that have some of it', () => {
    renderChecklist({
      steps: [
        { key: 'guests', count: 4, isDone: true },
        { key: 'rooms', count: 2, isDone: true },
        { key: 'assignments', count: 3, total: 4, isDone: false },
        { key: 'arrivals', count: 2, isDone: true },
      ],
      doneCount: 3,
      stepCount: 4,
      isComplete: false,
    });

    expect(screen.getByText('2 rooms')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 with a room')).toBeInTheDocument();
    expect(screen.getByText('2 arrivals')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 done')).toBeInTheDocument();

    // Only the unfinished step still asks for anything.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Assign rooms' })).toBeInTheDocument();
  });

  it('offers the guest step when the trip has no guests at all', async () => {
    const { user, onAddGuests } = renderChecklist({
      steps: [
        { key: 'guests', count: 0, isDone: false },
        { key: 'rooms', count: 0, isDone: false },
        { key: 'assignments', count: 0, total: 0, isDone: false },
        { key: 'arrivals', count: 0, isDone: false },
      ],
      doneCount: 0,
      stepCount: 4,
      isComplete: false,
    });

    expect(screen.getByText('Nobody on the list yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New guest' }));
    expect(onAddGuests).toHaveBeenCalledTimes(1);
  });

  it('fills the bar to the share of steps done', () => {
    renderChecklist();

    const fill = screen.getByRole('progressbar').firstElementChild;
    expect(fill).toHaveStyle({ width: '25%' });
    expect(fill).toHaveClass('h-full', 'rounded-full', 'bg-success');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemin', '0');
  });

  it('leaves the bar empty for a checklist with no steps', () => {
    renderChecklist({ steps: [], doneCount: 0, stepCount: 0, isComplete: true });

    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '0%' });
  });

  it('greys a finished step and ticks it, and keeps an open one readable', () => {
    renderChecklist();

    const done = screen.getByText('Add guests');
    expect(done).toHaveClass('text-sm', 'font-medium', 'text-muted-foreground');
    const doneIcon = done.closest('li')!.firstElementChild;
    expect(doneIcon).toHaveClass('bg-success-surface', 'text-success-on-surface', 'rounded-full');

    const open = screen.getByText('Add rooms');
    expect(open).toHaveClass('text-foreground');
    expect(open).not.toHaveClass('text-muted-foreground');
    expect(open.closest('li')!.firstElementChild).toHaveClass('bg-muted', 'text-muted-foreground');
  });

  it('points at the first unfinished step and keeps the others quiet', () => {
    renderChecklist();

    expect(screen.getByRole('button', { name: 'New room' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'New room' })).toHaveAttribute('data-variant', 'default');
    expect(screen.getByRole('button', { name: 'Assign rooms' })).not.toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Assign rooms' })).toHaveAttribute(
      'data-variant',
      'outline',
    );
    expect(screen.getByRole('button', { name: 'New arrival' })).not.toHaveClass('bg-primary');
  });

  it('names the progress bar and reads a finished step as one phrase', () => {
    renderChecklist();

    expect(screen.getByRole('progressbar', { name: 'Trip setup progress' })).toBeInTheDocument();
    expect(screen.getByText('Add guests')).toHaveTextContent(/^Add guests done$/);
  });

  it('takes the class its caller gives it', () => {
    render(
      <TripSetupChecklist
        className="mt-6"
        checklist={makeFreshChecklist()}
        onAddGuests={vi.fn()}
        onAddRooms={vi.fn()}
        onAssignRooms={vi.fn()}
        onAddArrivals={vi.fn()}
      />,
    );

    const card = screen.getByRole('heading', { name: 'Set this trip up' }).closest('.mt-6');
    expect(card).toHaveClass('mx-auto', 'w-full', 'max-w-lg');
    expect(screen.getByText('The calendar fills in as you work through these steps.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 done');
  });

  it('counts a step with a total of nothing as zero of zero', () => {
    renderChecklist({
      steps: [{ key: 'assignments', count: 1, isDone: false }],
      doneCount: 0,
      stepCount: 1,
      isComplete: false,
    });

    expect(screen.getByText('1 of 0 with a room')).toBeInTheDocument();
  });
});
