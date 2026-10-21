/**
 * @fileoverview The location field's own wording across a language switch.
 *
 * The suite-wide mock returns the same key in every language, so only a real
 * i18next that changes language under a mounted field shows that the default
 * placeholder and name follow it.
 *
 * @module components/shared/__tests__/LocationPicker.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderSwitchingLanguage, screen } from '@/test/utils';

import { LocationPicker } from '../LocationPicker';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

describe('LocationPicker across a language switch', () => {
  it('renames and re-prompts the field in the new language', async () => {
    const { switchTo } = await renderSwitchingLanguage(<LocationPicker value="" onChange={vi.fn()} />, {
      withProviders: false,
    });
    expect(screen.getByRole('combobox', { name: 'Location search' })).toHaveAttribute(
      'placeholder',
      'Search for a location...',
    );

    await switchTo('fr');

    expect(screen.getByRole('combobox', { name: 'Recherche de lieu' })).toHaveAttribute(
      'placeholder',
      'Rechercher un lieu...',
    );
  });
});
