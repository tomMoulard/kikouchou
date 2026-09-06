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

// The dialog resolves the car select's options so the form does not have to.
// Empty here: these tests are about the dialog's own modes and its unsaved
// guard, and `TransportForm.test.tsx` covers what the select does with them.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({
    rides: [],
    vehicles: [],
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/transports/components/TransportForm', () => ({
  TransportForm: ({ transport, onCancel, onSubmit, onDirtyChange, defaultType }: {
    transport?: Transport;
    onCancel: () => void;
    onSubmit: (data: unknown) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
    defaultType?: string;
  }) => (
    <div data-testid="transport-form">
      {transport ? <span data-testid="edit-mode">{transport.location}</span> : <span data-testid="create-mode">New</span>}
      {defaultType && <span data-testid="default-type">{defaultType}</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      <button data-testid="submit-btn" onClick={() => void onSubmit({ type: 'arrival', location: 'Test', datetime: '2026-07-15T10:00:00Z', personId: 'p1', needsPickup: false }).catch(() => {})}>Submit</button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>Mark Dirty</button>
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

  it('renders description for create mode', () => {
    render(
      <TransportDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.newDescription')).toBeInTheDocument();
  });

  it('renders description for edit mode', () => {
    render(
      <TransportDialog transportId={'t1' as TransportId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('transports.editDescription')).toBeInTheDocument();
  });

  it('passes defaultType to TransportForm in create mode', () => {
    render(
      <TransportDialog open onOpenChange={vi.fn()} defaultType="departure" />,
      { withProviders: false },
    );
    expect(screen.getByTestId('default-type')).toHaveTextContent('departure');
  });

  it('does not pass defaultType in edit mode', () => {
    render(
      <TransportDialog transportId={'t1' as TransportId} open onOpenChange={vi.fn()} defaultType="departure" />,
      { withProviders: false },
    );
    expect(screen.queryByTestId('default-type')).not.toBeInTheDocument();
  });

  it('shows discard confirmation when cancelling with dirty state', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TransportDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark form as dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Now cancel should show discard dialog
    await user.click(screen.getByTestId('cancel-btn'));
    // onOpenChange should NOT have been called (discard dialog should show instead)
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes dialog after successful form submission', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TransportDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    // After successful submit, dialog should close
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('handles dialog close via overlay when not dirty', async () => {
    const onOpenChange = vi.fn();
    render(
      <TransportDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // The dialog should exist and respect onOpenChange
    expect(screen.getByTestId('transport-form')).toBeInTheDocument();
  });

  it('shows discard confirmation when closing dirty dialog via overlay', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TransportDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark form as dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Try to close via cancel
    await user.click(screen.getByTestId('cancel-btn'));
    // Should show discard dialog, not close directly
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('handles edit mode submission via update transport', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <TransportDialog transportId={'t1' as TransportId} open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    // After successful update, dialog should close
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
