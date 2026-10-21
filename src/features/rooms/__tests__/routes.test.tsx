/**
 * @fileoverview The rooms route loads its page.
 *
 * The page is a lazy chunk, so the route's element is a promise until the
 * chunk resolves. A wrong mapping from the module to its default export only
 * shows when the route is actually rendered.
 *
 * @module features/rooms/__tests__/routes.test
 */

import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useRoutes } from 'react-router-dom';

import { render, screen } from '@/test/utils';

vi.mock('../pages/RoomListPage', () => ({
  RoomListPage: () => <p>the rooms page</p>,
}));

import { roomRoutes } from '../routes';

/** The feature's routes, mounted under the harness's own router. */
function RoomRoutes(): ReactElement | null {
  return useRoutes(roomRoutes);
}

describe('roomRoutes', () => {
  it('serves the rooms page under a trip', async () => {
    render(<RoomRoutes />, { initialRoute: '/trips/trip-1/rooms', withProviders: false });

    expect(await screen.findByText('the rooms page')).toBeInTheDocument();
    expect(roomRoutes.map((route) => route.path)).toEqual(['trips/:tripId/rooms']);
  });
});
