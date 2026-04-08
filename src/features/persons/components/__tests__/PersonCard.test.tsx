import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { enUS } from 'date-fns/locale';
import { PersonCard } from '../PersonCard';
import type { Person } from '@/types';
import type { TransportSummary } from '../PersonCard';

const mockPerson: Person = {
  id: 'p1' as Person['id'],
  tripId: 't1' as Person['tripId'],
  name: 'Alice Dupont',
  color: '#3b82f6' as Person['color'],
};

const emptyTransport: TransportSummary = { arrival: null, departure: null };

describe('PersonCard', () => {
  it('renders person name and initials', () => {
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice Dupont')).toBeInTheDocument();
    expect(screen.getByText('AD')).toBeInTheDocument();
  });

  it('shows "no transport info" when no transports', () => {
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.empty')).toBeInTheDocument();
  });

  it('shows arrival and departure info', () => {
    const transport: TransportSummary = {
      arrival: { datetime: '2026-07-15T10:30:00Z', location: 'CDG Airport', transportMode: 'plane' },
      departure: { datetime: '2026-07-22T16:00:00Z', location: 'Gare du Nord', transportMode: 'train' },
    };
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={transport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('CDG Airport')).toBeInTheDocument();
    expect(screen.getByText('Gare du Nord')).toBeInTheDocument();
  });

  it('calls onEdit when edit menu item is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    // Open the menu
    await user.click(screen.getByLabelText('common.openMenu'));
    await user.click(screen.getByText('common.edit'));
    expect(onEdit).toHaveBeenCalledWith(mockPerson);
  });

  it('calls onClick when card is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: /Alice Dupont/ }));
    expect(onClick).toHaveBeenCalledWith(mockPerson);
  });

  it('does not call onClick when disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled
      />,
      { withProviders: false },
    );
    await user.click(screen.getByText('Alice Dupont'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders single letter initial for single word name', () => {
    const singleNamePerson = { ...mockPerson, name: 'Alice' };
    render(
      <PersonCard
        person={singleNamePerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
