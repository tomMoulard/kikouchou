/**
 * @fileoverview The badge's counted strings, resolved through the shipped
 * catalogues rather than through anybody's mock.
 *
 * The sibling `SyncStatusBadge.test.tsx` covers the *precedence* between the
 * head count and the sync state, and it asserts the component's inline
 * `defaultValue_one` / `defaultValue_other` through a local `t` double. Both
 * files are worth keeping; they have different subjects. That one never reads
 * `src/locales`, so the shipped strings could be wrong at every count and it
 * would stay green.
 *
 * Worth being precise about what this file can and cannot catch, because the
 * component's inline defaults repeat the English catalogue word for word: with
 * a key deleted from *both* bundles, the English assertions below still pass on
 * the default. The **French** assertions are the ones that can only come from
 * the catalogue — and French is the app's fallback language, the one every user
 * gets for a key `en` happens to be missing. They also exercise the only
 * language the suite-wide mock, which hardcodes `language: 'en'`, cannot reach.
 * What both languages catch is a *wrong* shipped string, which is the shape a
 * real translation regression takes and which no static check can see.
 *
 * @module components/shared/__tests__/SyncStatusBadge.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';
import { useSyncStatus } from '@/lib/sync/SupabaseTripSync';
import type { SyncState } from '@/lib/sync/SupabaseYjsProvider';

import { SyncStatusBadge } from '../SyncStatusBadge';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/lib/sync/SupabaseTripSync', () => ({
  useSyncStatus: vi.fn(),
}));

// ============================================================================
// Test doubles
// ============================================================================

const mockedUseSyncStatus = vi.mocked(useSyncStatus);

function withState(state: SyncState): void {
  mockedUseSyncStatus.mockReturnValue({ state, syncNow: vi.fn() });
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncStatusBadge counted strings', () => {
  it('says "2 people online", not the plural key', async () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 2 });

    await renderWithRealI18n(<SyncStatusBadge />, { withProviders: false });

    expect(screen.getByText('2 people online')).toBeInTheDocument();
  });

  it('says "1 change not sent yet", never "1 changes"', async () => {
    withState({ status: 'offline', pendingCount: 1, onlineCount: null });

    await renderWithRealI18n(<SyncStatusBadge />, { withProviders: false });

    // The suite-wide mock strips `count` before interpolating, so no component
    // test other than this one can tell the two forms apart.
    expect(screen.getByText('1 change not sent yet')).toBeInTheDocument();
  });

  it('says "3 changes not sent yet" at three', async () => {
    withState({ status: 'offline', pendingCount: 3, onlineCount: null });

    await renderWithRealI18n(<SyncStatusBadge />, { withProviders: false });

    expect(screen.getByText('3 changes not sent yet')).toBeInTheDocument();
  });

  it('counts people in French', async () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 2 });

    await renderWithRealI18n(<SyncStatusBadge />, {
      language: 'fr',
      withProviders: false,
    });

    expect(screen.getByText('2 personnes en ligne')).toBeInTheDocument();
  });

  it('agrees the French participle in the singular', async () => {
    withState({ status: 'offline', pendingCount: 1, onlineCount: null });

    await renderWithRealI18n(<SyncStatusBadge />, {
      language: 'fr',
      withProviders: false,
    });

    // "envoyée", not "envoyées": a form English has no equivalent for, and one
    // a catalogue copied from the English file gets wrong.
    expect(screen.getByText('1 modification pas encore envoyée')).toBeInTheDocument();
  });

  it('agrees the French participle in the plural', async () => {
    withState({ status: 'offline', pendingCount: 3, onlineCount: null });

    await renderWithRealI18n(<SyncStatusBadge />, {
      language: 'fr',
      withProviders: false,
    });

    expect(screen.getByText('3 modifications pas encore envoyées')).toBeInTheDocument();
  });

  it('names the status region so the badge is not an anonymous live region', async () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 2 });

    await renderWithRealI18n(<SyncStatusBadge />, { withProviders: false });

    // The accessible name of the whole `role="status"`. Asserted as prose, not
    // as `nav.syncPresenceRegion`, because prose is what gets announced.
    expect(
      screen.getByRole('status', { name: 'Collaboration status' }),
    ).toBeInTheDocument();
  });

  it('offers a retry with a real word on it while offline', async () => {
    withState({ status: 'offline', pendingCount: 1, onlineCount: null });

    await renderWithRealI18n(<SyncStatusBadge />, {
      language: 'fr',
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('never reaches the singular head-count form, which is dead in the bundle', async () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 1 });

    await renderWithRealI18n(<SyncStatusBadge />, { withProviders: false });

    // The component routes every count of 1 or fewer to `nav.syncOnlineJustYou`,
    // so `nav.syncOnlineCount_one` and the matching `defaultValue_one` are
    // unreachable from any screen. Pinned rather than left implicit: the guard
    // is a design decision, and if it ever moves, the singular form starts
    // shipping and wants a test of its own.
    expect(screen.getByText('Just you right now')).toBeInTheDocument();
    expect(screen.queryByText(/1 person online/)).not.toBeInTheDocument();
  });
});
