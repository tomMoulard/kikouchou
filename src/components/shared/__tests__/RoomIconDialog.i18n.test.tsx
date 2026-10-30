/**
 * @fileoverview The room icon button's accessible name, through the shipped
 * catalogues.
 *
 * The button shows only a glyph, so its name is the only thing that says
 * which icon the room has; the suite-wide mock echoes the key instead.
 *
 * @module components/shared/__tests__/RoomIconDialog.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';

import { RoomIconDialog } from '../RoomIconDialog';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

describe('RoomIconDialog names', () => {
  it('names the button after the icon the room has', async () => {
    await renderWithRealI18n(<RoomIconDialog value="tent" onChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: 'Change the room icon: Tent' })).toBeInTheDocument();
  });
});
