/**
 * @fileoverview Tests for SyncStatusBadge.
 *
 * The badge shows two different things and the *order of precedence* between
 * them is the whole design, so that is what these pin. A head count is what a
 * person wants while editing a trip with someone else, and it now takes the
 * default slot that "Syncing…" used to occupy — but never at the cost of hiding
 * the one sync state nobody may miss, which is that their changes have not been
 * sent. A cheerful "3 people online" sitting above unsent edits would be worse
 * than the spinner it replaced.
 *
 * @module components/shared/__tests__/SyncStatusBadge.test
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SyncStatusBadge } from '../SyncStatusBadge';
import { statusVariants } from '@/components/ui/status.variants';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';

// ============================================================================
// Test doubles
// ============================================================================

/**
 * Mirrors i18next closely enough to assert the number *and* the plural form it
 * is wrapped in, and records the key it was asked for. A counted string
 * carries one default per CLDR category, so a mock that only reads
 * `defaultValue` would happily let "1 changes not sent yet" through.
 */
const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string | Record<string, unknown>) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    const options = fallback ?? {};
    const count = options.count;
    const suffix =
      typeof count === 'number' ? `_${new Intl.PluralRules('en').select(count)}` : '';
    const candidate = options[`defaultValue${suffix}`] ?? options.defaultValue;
    const template = typeof candidate === 'string' ? candidate : key;
    return template.replace('{{count}}', String(count ?? ''));
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('@/lib/sync/SupabaseTripSync', () => ({
  useSyncStatus: vi.fn(),
}));

const mockedUseSyncStatus = vi.mocked(useSyncStatus);

function withState(state: SyncState): void {
  mockedUseSyncStatus.mockReturnValue({ state, syncNow: vi.fn() });
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncStatusBadge', () => {
  it('shows the head count instead of a syncing spinner', () => {
    withState({ status: 'syncing', pendingCount: 0, onlineCount: 3 });

    render(<SyncStatusBadge />);

    expect(screen.getByText('3 people online')).toBeInTheDocument();
    expect(screen.queryByText(/syncing/i)).not.toBeInTheDocument();
  });

  it('says nothing about the head count when you are the only one connected', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 1 });

    render(<SyncStatusBadge />);

    // One connection is you on your own. A chip for that reports the absence
    // of other people, so the plain sync state shows through instead.
    expect(screen.getByText('Everyone is up to date')).toBeInTheDocument();
    expect(screen.queryByText(/online|just you/i)).not.toBeInTheDocument();
  });

  it('keeps quiet about a head count of one while syncing', () => {
    withState({ status: 'syncing', pendingCount: 0, onlineCount: 1 });

    render(<SyncStatusBadge />);

    // The count only outranks the sync state once there is somebody to count.
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.queryByText(/online|just you/i)).not.toBeInTheDocument();
  });

  it('shows the head count as soon as a second guest joins the trip', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 2 });

    render(<SyncStatusBadge />);

    expect(screen.getByText('2 people online')).toBeInTheDocument();
  });

  it('puts unsent changes ahead of the head count', () => {
    withState({ status: 'offline', pendingCount: 2, onlineCount: 4 });

    render(<SyncStatusBadge />);

    // The one state a person must not miss while closing the tab.
    expect(screen.getByText('2 changes not sent yet')).toBeInTheDocument();
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
  });

  it('says "1 change", not "1 changes"', () => {
    withState({ status: 'offline', pendingCount: 1, onlineCount: null });

    render(<SyncStatusBadge />);

    // The badge used to pass a single inline default — '{{count}} not sent yet'
    // — that contradicted the shipped `nav.syncPending_one`. Whichever of the
    // two won, the other was dead, and neither could be right at every count.
    expect(screen.getByText('1 change not sent yet')).toBeInTheDocument();
  });

  it('does not claim the trip is empty when the count is unknown', () => {
    // Realtime is not connected — which is not the same as nobody being there.
    withState({ status: 'synced', pendingCount: 0, onlineCount: null });

    render(<SyncStatusBadge />);

    expect(screen.getByText('Everyone is up to date')).toBeInTheDocument();
    expect(screen.queryByText(/online|just you/i)).not.toBeInTheDocument();
  });

  it('renders nothing for a trip that does not sync', () => {
    withState({ status: 'local', pendingCount: 0, onlineCount: null });

    const { container } = render(<SyncStatusBadge />);

    // Most trips are never shared; a permanent chip on all of them is noise.
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the count out of the collapsed rail but keeps it announced', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 2 });

    render(<SyncStatusBadge collapsed />);

    // Icon-only rail: the label is for screen readers and the tooltip.
    expect(screen.getByText('2 people online')).toHaveClass('sr-only');
  });
});

describe('SyncStatusBadge — a viewer trip', () => {
  it('says the copy is read-only rather than that everyone is up to date', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: null, readOnly: true });

    render(<SyncStatusBadge />);

    // "Everyone is up to date" promises a two-way sync. A trip read through an
    // invite link has one direction, and the badge says so.
    expect(screen.getByText('Read-only copy')).toBeInTheDocument();
    expect(screen.queryByText('Everyone is up to date')).not.toBeInTheDocument();
  });

  it('keeps the connection wording when the copy cannot be refreshed', () => {
    withState({ status: 'offline', pendingCount: 0, onlineCount: null, readOnly: true });

    render(<SyncStatusBadge />);

    // Offline describes the connection, not the copy: unchanged for a viewer.
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });
});

// ============================================================================
// Each face of the badge
// ============================================================================

/** The classes `statusVariants` gives a tone, split for `toHaveClass`. */
function toneClasses(tone: 'success' | 'warning'): string[] {
  return statusVariants({ tone, emphasis: 'text' }).split(/\s+/).filter(Boolean);
}

/** The text row of the inline badge. */
function bodyOf(): HTMLElement {
  return screen.getByRole('status').firstElementChild as HTMLElement;
}

/** The dot of the collapsed rail. */
function dotOf(): HTMLElement {
  return screen.getByRole('status').querySelector('span[aria-hidden="true"]') as HTMLElement;
}

describe('SyncStatusBadge faces', () => {
  it('says the connection is down, ahead of a head count, and offers a retry', () => {
    const syncNow = vi.fn();
    mockedUseSyncStatus.mockReturnValue({
      state: { status: 'offline', pendingCount: 0, onlineCount: 3 },
      syncNow,
    });

    render(<SyncStatusBadge />);

    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
    expect(bodyOf()).toHaveClass(...toneClasses('warning'));
    expect(screen.getByRole('status', { name: 'Sync status' })).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('nav.syncOffline', 'Not connected');
    expect(translate).toHaveBeenCalledWith('nav.syncStatusRegion', 'Sync status');

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveClass('shrink-0', 'underline', 'underline-offset-2', 'hover:no-underline');
    expect(translate).toHaveBeenCalledWith('common.retry', 'Retry');
    fireEvent.click(retry);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('keeps syncing ahead of a head count while changes are still going out', () => {
    withState({ status: 'syncing', pendingCount: 2, onlineCount: 3 });

    render(<SyncStatusBadge />);

    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.queryByText(/online/i)).not.toBeInTheDocument();
  });

  it('draws syncing muted, with a spinner and no retry', () => {
    withState({ status: 'syncing', pendingCount: 0, onlineCount: null });

    render(<SyncStatusBadge />);

    expect(screen.getByText('Syncing…')).toHaveClass('truncate');
    expect(bodyOf()).toHaveClass('flex', 'min-w-0', 'items-center', 'gap-1.5', 'text-xs', 'font-medium', 'text-muted-foreground');
    expect(bodyOf().querySelector('svg')).toHaveClass('size-3.5', 'shrink-0', 'animate-spin');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('nav.syncSyncing', 'Syncing…');
  });

  it('draws the head count in the success tone, under its own region name', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 3 });

    render(<SyncStatusBadge />);

    expect(bodyOf()).toHaveClass(...toneClasses('success'));
    expect(screen.getByRole('status', { name: 'Collaboration status' })).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('nav.syncPresenceRegion', 'Collaboration status');
    expect(translate).toHaveBeenCalledWith('nav.syncOnlineCount', expect.objectContaining({ count: 3 }));
  });

  it('draws an up-to-date trip in the success tone, with no retry', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: null });

    render(<SyncStatusBadge />);

    expect(bodyOf()).toHaveClass(...toneClasses('success'));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('nav.syncSynced', 'Everyone is up to date');
  });

  it('draws a read-only copy muted', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 3, readOnly: true });

    render(<SyncStatusBadge />);

    expect(bodyOf()).toHaveClass('text-muted-foreground');
    expect(translate).toHaveBeenCalledWith('nav.syncReadOnly', 'Read-only copy');
  });

  it('asks for the pending count under its own key', () => {
    withState({ status: 'offline', pendingCount: 2, onlineCount: null });

    render(<SyncStatusBadge />);

    expect(translate).toHaveBeenCalledWith('nav.syncPending', expect.objectContaining({ count: 2 }));
  });

  it.each([
    [{ status: 'synced', pendingCount: 0, onlineCount: 3 }, 'bg-success'],
    [{ status: 'synced', pendingCount: 0, onlineCount: null }, 'bg-success'],
    [{ status: 'offline', pendingCount: 0, onlineCount: null }, 'bg-warning'],
    [{ status: 'syncing', pendingCount: 0, onlineCount: null }, 'bg-muted-foreground'],
    [{ status: 'synced', pendingCount: 0, onlineCount: null, readOnly: true }, 'bg-muted-foreground'],
  ] as const)('colours the collapsed dot for %o as %s', (state, dot) => {
    withState(state as SyncState);

    render(<SyncStatusBadge collapsed />);

    expect(dotOf()).toHaveClass('size-2', 'rounded-full', dot);
  });

  it('adds the section chrome in the sidebar, and only there', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: null });

    const { unmount } = render(<SyncStatusBadge layout="sidebar" />);
    expect(screen.getByRole('status')).toHaveClass('border-t', 'border-border', 'px-3', 'py-2');
    unmount();

    render(<SyncStatusBadge />);
    expect(screen.getByRole('status')).not.toHaveClass('border-t');
  });
});
