/**
 * Tests for the screen shown when the browser cannot open IndexedDB at all.
 *
 * Rendered through the real locale files: this screen replaces the whole app,
 * so a missing key would leave the user with nothing readable at all.
 *
 * @module components/shared/__tests__/StorageUnavailableScreen.test
 */
import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';

import { StorageUnavailableScreen } from '../StorageUnavailableScreen';

vi.unmock('i18next');
vi.unmock('react-i18next');

describe('StorageUnavailableScreen', () => {
  it('says the browser cannot store data and how to get out of it', async () => {
    await renderWithRealI18n(<StorageUnavailableScreen onRetry={vi.fn()} />, {
      withProviders: false,
    });

    expect(
      screen.getByRole('heading', { name: 'This browser cannot store data here' }),
    ).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/another browser/i);
    expect(alert).toHaveTextContent(/private or secret mode/i);
  });

  it('says it in French', async () => {
    await renderWithRealI18n(<StorageUnavailableScreen onRetry={vi.fn()} />, {
      language: 'fr',
      withProviders: false,
    });

    expect(
      screen.getByRole('heading', {
        name: 'Ce navigateur ne peut pas enregistrer de données ici',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/autre navigateur/i);
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('retries when asked', async () => {
    const onRetry = vi.fn();
    const { user } = await renderWithRealI18n(<StorageUnavailableScreen onRetry={onRetry} />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
