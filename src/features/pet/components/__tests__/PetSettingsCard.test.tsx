/**
 * @fileoverview Tests for the pet's settings card.
 *
 * Rendered through a real i18next: the option names come from computed keys
 * (`pet.items.${item}`).
 *
 * @module features/pet/components/__tests__/PetSettingsCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import { installLocalStorageDouble } from '@/test/local-storage';

import { PET_STORAGE_KEY, getPetPreferences } from '../../lib/pet-preferences';
import { PetSettingsCard } from '../PetSettingsCard';

vi.unmock('i18next');
vi.unmock('react-i18next');

const captureEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent,
}));

const storage = installLocalStorageDouble();

function eventsNamed(name: string): unknown[][] {
  return captureEvent.mock.calls.filter(([event]) => event === name);
}

describe('PetSettingsCard', () => {
  beforeEach(() => {
    storage.clear();
    captureEvent.mockClear();
  });

  it('is off by default and shows the mascot anyway', async () => {
    await renderWithRealI18n(<PetSettingsCard />, { withProviders: false });

    expect(screen.getByRole('switch', { name: 'Show my pet' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pomeranian' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Beret' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Scarf' })).toHaveAttribute('aria-checked', 'true');
  });

  it('turns the pet on, stores it and reports it', async () => {
    const { user } = await renderWithRealI18n(<PetSettingsCard />, { withProviders: false });
    const toggle = screen.getByRole('switch', { name: 'Show my pet' });

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(getPetPreferences().enabled).toBe(true);
    expect(storage.entries.has(PET_STORAGE_KEY)).toBe(true);
    expect(eventsNamed('pet_toggled')).toEqual([['pet_toggled', { enabled: true }]]);
  });

  it('picks the animal and each item of the outfit', async () => {
    const { user } = await renderWithRealI18n(<PetSettingsCard />, { withProviders: false });

    await user.click(screen.getByRole('radio', { name: 'Continental Toy Spaniel' }));
    await user.click(screen.getByRole('radio', { name: 'Crown' }));
    await user.click(screen.getByRole('radio', { name: 'Raincoat' }));
    await user.click(screen.getByRole('radio', { name: 'Tutu' }));
    await user.click(screen.getByRole('radio', { name: 'Rain boots' }));

    expect(getPetPreferences()).toMatchObject({
      species: 'papillon',
      outfit: { hat: 'crown', coat: 'raincoat', pants: 'tutu', shoes: 'boots' },
    });
    expect(screen.getByRole('radio', { name: 'Crown' })).toHaveAttribute('aria-checked', 'true');
    expect(eventsNamed('pet_customized')).toContainEqual(['pet_customized', { slot: 'species', value: 'papillon' }]);
    expect(eventsNamed('pet_customized')).toContainEqual(['pet_customized', { slot: 'shoes', value: 'boots' }]);
  });

  it('moves through a group with the arrow keys', async () => {
    const { user } = await renderWithRealI18n(<PetSettingsCard />, { withProviders: false });

    screen.getByRole('radio', { name: 'Pomeranian' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(getPetPreferences().species).toBe('papillon');
    expect(screen.getByRole('radio', { name: 'Continental Toy Spaniel' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(getPetPreferences().species).toBe('cat');
  });

  it('dresses the pet at random', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { user } = await renderWithRealI18n(<PetSettingsCard />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'Surprise me' }));

    expect(getPetPreferences().outfit).toEqual({ hat: 'bow', coat: 'sweater', pants: 'tutu', shoes: 'socks' });
    expect(eventsNamed('pet_customized')).toEqual([['pet_customized', { slot: 'random' }]]);
    random.mockRestore();
  });

  it('speaks French', async () => {
    await renderWithRealI18n(<PetSettingsCard />, { language: 'fr', withProviders: false });

    expect(screen.getByRole('switch', { name: 'Afficher mon compagnon' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Castor' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Chaussures' })).toBeInTheDocument();
  });
});
