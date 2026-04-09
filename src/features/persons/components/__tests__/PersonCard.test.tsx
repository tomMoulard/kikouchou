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

  it('renders ? for empty name', () => {
    const emptyNamePerson = { ...mockPerson, name: '' };
    render(
      <PersonCard
        person={emptyNamePerson}
        transportSummary={emptyTransport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('handles invalid transport datetime gracefully', () => {
    const badTransport: TransportSummary = {
      arrival: { datetime: 'not-a-date', location: 'Somewhere' },
      departure: null,
    };
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={badTransport}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Somewhere')).toBeInTheDocument();
  });

  it('does not render as interactive button when no onClick', () => {
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
    // Should not have an interactive card button (only menu button)
    const cardBtn = screen.queryByRole('button', { name: /Alice Dupont/ });
    expect(cardBtn).not.toBeInTheDocument();
  });

  it('calls onClick on Enter key', async () => {
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
    const card = screen.getByRole('button', { name: /Alice Dupont/ });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledWith(mockPerson);
  });

  it('opens delete confirmation dialog', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
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
    await user.click(screen.getByLabelText('common.openMenu'));
    await user.click(screen.getByText('common.delete'));
    // ConfirmDialog should open
    expect(screen.getByText('confirm.deletePerson')).toBeInTheDocument();
  });

  it('renders only departure transport info', () => {
    const departureOnly: TransportSummary = {
      arrival: null,
      departure: { datetime: '2026-07-22T16:00:00Z', location: 'Airport', transportMode: 'bus' },
    };
    render(
      <PersonCard
        person={mockPerson}
        transportSummary={departureOnly}
        dateLocale={enUS}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Airport')).toBeInTheDocument();
  });
});
