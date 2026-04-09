/**
 * @fileoverview Tests for the TransportIndicator component.
 * @module features/calendar/components/__tests__/TransportIndicator.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { TransportIndicator } from '../TransportIndicator';
import type { CalendarTransport } from '../../types';
import type { HexColor, ISODateTimeString, PersonId, TransportId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function makeTransport(overrides: Partial<CalendarTransport & { type: 'arrival' | 'departure' }> = {}): {
  transport: CalendarTransport;
  type: 'arrival' | 'departure';
} {
  const transport: CalendarTransport = {
    transport: {
      id: 'transport-1' as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'person-1' as PersonId,
      type: overrides.type ?? 'arrival',
      datetime: '2026-07-15T14:30:00' as ISODateTimeString,
      location: 'Paris Gare du Nord',
      needsPickup: false,
      transportMode: 'train',
    },
    person: undefined,
    personName: overrides.personName ?? 'Alice',
    color: (overrides.color ?? '#3b82f6') as HexColor,
    ...overrides,
  };

  return {
    transport,
    type: transport.transport.type,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportIndicator', () => {
  it('renders arrival indicator with down arrow', () => {
    const { transport, type } = makeTransport({ type: 'arrival' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('↓')).toBeInTheDocument();
  });

  it('renders departure indicator with up arrow', () => {
    const { transport, type } = makeTransport({ type: 'departure' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('↑')).toBeInTheDocument();
  });

  it('displays person name', () => {
    const { transport, type } = makeTransport({ personName: 'Bob' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('displays time', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText('14:30')).toBeInTheDocument();
  });

  it('displays location', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.getByText(/Paris Gare du Nord/)).toBeInTheDocument();
  });

  it('renders as a div when no onClick is provided', () => {
    const { transport, type } = makeTransport();
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders as a button when onClick is provided', () => {
    const { transport, type } = makeTransport();
    const onClick = vi.fn();
    render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onClick with transport data when clicked', async () => {
    const { transport, type } = makeTransport();
    const onClick = vi.fn();
    const { user } = render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith(transport);
  });

  it('has proper aria-label for interactive arrival', () => {
    const { transport, type } = makeTransport({ type: 'arrival' });
    const onClick = vi.fn();
    render(
      <TransportIndicator transport={transport} type={type} onClick={onClick} />,
      { withProviders: false },
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('calendar.viewTransportDetails'));
  });

  it('has title attribute with transport details', () => {
    const { transport, type } = makeTransport({ personName: 'Charlie' });
    render(<TransportIndicator transport={transport} type={type} />, { withProviders: false });
    const indicator = screen.getByTitle(/14:30 Charlie/);
    expect(indicator).toBeInTheDocument();
  });
});
