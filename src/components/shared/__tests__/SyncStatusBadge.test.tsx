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
import { render, screen } from '@testing-library/react';

import { SyncStatusBadge } from '../SyncStatusBadge';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      // Mirrors i18next closely enough to assert the number *and* the plural
      // form it is wrapped in. A counted string carries one default per CLDR
      // category, so a mock that only reads `defaultValue` would happily let
      // "1 changes not sent yet" through.
      const options = fallback ?? {};
      const count = options.count;
      const suffix =
        typeof count === 'number' ? `_${new Intl.PluralRules('en').select(count)}` : '';
      const candidate = options[`defaultValue${suffix}`] ?? options.defaultValue;
      const template = typeof candidate === 'string' ? candidate : key;
      return template.replace('{{count}}', String(count ?? ''));
    },
  }),
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

  it('names a lone occupant rather than saying "1 online"', () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 1 });

    render(<SyncStatusBadge />);

    // "1 online" invites the question "online with whom?".
    expect(screen.getByText('Just you right now')).toBeInTheDocument();
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
