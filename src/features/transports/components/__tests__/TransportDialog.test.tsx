import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Person, Transport, TransportId } from '@/types';

const mockTransports: Transport[] = [
  {
    id: 't1' as TransportId,
    tripId: 'trip1' as Transport['tripId'],
    personId: 'p1' as Transport['personId'],
    type: 'arrival',
    datetime: '2026-07-15T10:00:00Z',
    location: 'Airport',
    needsPickup: false,
  },
];

const mockPersons: Person[] = [
  {
    id: 'p1' as Person['id'],
    tripId: 'trip1' as Person['tripId'],
    name: 'Alice',
    color: '#3b82f6' as Person['color'],
  },
];

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    transports: mockTransports,
    createTransport: vi.fn().mockResolvedValue(undefined),
    updateTransport: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: mockPersons,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/transports/components/TransportForm', () => ({
  TransportForm: ({ transport, onCancel }: { transport?: Transport; onCancel: () => void }) => (
    <div data-testid="transport-form">
      {transport ? <span data-testid="edit-mode">{transport.location}</span> : <span data-testid="create-mode">New</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { TransportDialog } from '../TransportDialog';

describe('TransportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode when transportId is undefined', () => {
    render(
      <TransportDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.new')).toBeInTheDocument();
    expect(screen.getByTestId('create-mode')).toBeInTheDocument();
  });

  it('renders edit mode when transportId is provided', () => {
    render(
      <TransportDialog transportId={'t1' as TransportId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.edit')).toBeInTheDocument();
    expect(screen.getByTestId('edit-mode')).toBeInTheDocument();
  });

  it('shows error state when transport is not found in edit mode', () => {
    render(
      <TransportDialog transportId={'nonexistent' as TransportId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.edit')).toBeInTheDocument();
    expect(screen.getByText('errors.transportNotFound')).toBeInTheDocument();
  });

  it('calls onOpenChange when cancel is clicked (not dirty)', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TransportDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('cancel-btn'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when not open', () => {
    render(
      <TransportDialog open={false} onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.queryByText('transports.new')).not.toBeInTheDocument();
  });
});
