/**
 * @fileoverview The badge's counted strings, resolved through the shipped
 * catalogues rather than through anybody's mock.
 *
 * The sibling `SyncStatusBadge.test.tsx` covers the *precedence* between the
 * head count and the sync state, and it asserts the inline `defaultValue_one` /
 * `defaultValue_other` fallbacks through a local `t` double. Both are worth
 * keeping. Neither touches `src/locales`: the local double reproduces plural
 * selection over the component's own inline defaults, so the shipped
 * `nav.syncOnlineCount_one` could vanish from both bundles and it would stay
 * green — while a real user read "1 people online".
 *
 * This file closes that gap. It is also the only place the French forms are
 * exercised: the suite-wide mock hardcodes `language: 'en'`, so French is
 * unreachable everywhere else, and French is the app's fallback language — the
 * one every user gets for a key `en` happens to be missing.
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

    // The suite-wide mock strips `count` before interpolating, so no test in
    // this repo other than this one can tell the two forms apart.
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

  it('leaks no nav.sync key into the rendered badge', async () => {
    withState({ status: 'synced', pendingCount: 0, onlineCount: 4 });

    const { container } = await renderWithRealI18n(<SyncStatusBadge />, {
      withProviders: false,
    });

    expect(container.innerHTML).not.toContain('nav.sync');
  });
});
