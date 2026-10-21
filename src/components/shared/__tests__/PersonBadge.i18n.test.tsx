/**
 * @fileoverview A clickable guest badge's accessible name, through the shipped
 * catalogues.
 *
 * The suite-wide mock echoes the key, so it cannot show that the guest's name
 * reaches the sentence a screen reader hears.
 *
 * @module components/shared/__tests__/PersonBadge.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';

import { PersonBadge } from '../PersonBadge';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

describe('PersonBadge names', () => {
  it('names a clickable badge after the guest it selects', async () => {
    await renderWithRealI18n(<PersonBadge name="Ana" color="#3b82f6" onClick={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: 'Select Ana' })).toBeInTheDocument();
  });
});
