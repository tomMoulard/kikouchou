/**
 * @fileoverview The room form's bed-count errors, rendered through a real i18next.
 *
 * The suite-wide mock returns the key, so it cannot tell "Minimum 1 bed" from
 * "Minimum {{min}} bed": a message that lost its number stayed green. These
 * read the words off the DOM.
 *
 * @module features/rooms/components/__tests__/RoomForm.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { act, renderWithRealI18n, screen } from '@/test/utils';
import { MAX_ROOM_CAPACITY } from '@/types';
import type { Room } from '@/types';

import { RoomForm } from '../RoomForm';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

function roomWithBeds(capacity: number): Room {
  return {
    id: 'r1' as Room['id'],
    tripId: 't1' as Room['tripId'],
    name: 'Dormitory',
    capacity,
    order: 0,
  };
}

describe('RoomForm bed-count errors', () => {
  it('names the smallest bed count it accepts', async () => {
    await renderWithRealI18n(
      <RoomForm room={roomWithBeds(0)} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Minimum 1 bed');
  });

  it('names the largest bed count it accepts', async () => {
    await renderWithRealI18n(
      <RoomForm
        room={roomWithBeds(MAX_ROOM_CAPACITY + 1)}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { withProviders: false },
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent(`Maximum ${MAX_ROOM_CAPACITY} beds`);
  });
});

describe('RoomForm errors after a language change', () => {
  it('says what is wrong in the language the reader switched to', async () => {
    const { i18n } = await renderWithRealI18n(
      <RoomForm room={roomWithBeds(0)} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    try {
      await act(async () => {
        await i18n.changeLanguage('fr');
      });
      const user = userEvent.setup();
      await user.clear(screen.getByRole('textbox', { name: /Nom|Name/ }));
      await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

      const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
      expect(alerts).toContain('Requis');
      expect(alerts).toContain('Minimum 1 lit');
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    }
  });
});
